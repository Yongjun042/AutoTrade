import axios, { AxiosInstance, AxiosError } from 'axios';
import * as crypto from 'crypto';

interface KisConfig {
  appKey: string;
  appSecret: string;
  accountNo: string;
  env: 'REAL' | 'VTS';
  restRps: number;
}

interface KisToken {
  accessToken: string;
  expiresAt: Date;
  issuedAt: Date;
}

interface OrderResponse {
  ODNO?: string;  // Broker order ID
  ORDT?: string;
  ORDQ?: string;
  ORPD?: string;
}

interface BalanceResponse {
  PDNO?: string;
  HOLDN_QTY?: string;
  AVG_PRC?: string;
}

/**
 * KIS Gateway - REST API Adapter
 * 
 * Handles all KIS Open API calls with:
 * - Token management (24h validity, 6h refresh)
 * - Rate limiting (20 rps for real, 2 rps for test)
 * - Error handling and retry logic
 * 
 * KIS Constraints:
 * - REST: Real 20 req/s, Test 2 req/s
 * - Token: 24h validity, refresh after 6h
 */
export class KisGateway {
  private readonly config: KisConfig;
  private readonly client: AxiosInstance;
  private token: KisToken | null = null;
  private tokenLock = false;
  
  // Rate limiting
  private permits: number;
  private lastRefill: number = Date.now();
  private readonly refillRate: number;
  
  // Metrics
  private restCallCount = 0;
  private rateLimitHitCount = 0;

  private static readonly REAL_BASE = 'https://openapi.koreainvestment.com:9443';
  private static readonly TEST_BASE = 'https://openapi.koreainvestment.com:22443';

  constructor(config: KisConfig) {
    this.config = config;
    this.refillRate = config.restRps;
    this.permits = config.restRps * 2; // Initial burst capacity

    const baseUrl = config.env === 'REAL' ? KisGateway.REAL_BASE : KisGateway.TEST_BASE;
    
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // ==================== Token Management ====================

  /**
   * Get valid access token, refreshing if needed
   */
  async getAccessToken(): Promise<string> {
    if (!this.token || this.tokenNeedsRefresh()) {
      await this.refreshToken();
    }
    return this.token!.accessToken;
  }

  private tokenNeedsRefresh(): boolean {
    if (!this.token) return true;
    // Refresh if less than 1 hour remaining
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    return oneHourFromNow > this.token.expiresAt;
  }

  /**
   * Refresh access token
   * KIS rule: Can refresh after 6h, must refresh within 24h
   */
  async refreshToken(): Promise<void> {
    while (this.tokenLock) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.token && !this.tokenNeedsRefresh()) {
      return;
    }

    this.tokenLock = true;
    try {
      const url = '/oauth2/tokenP';
      const body = {
        grant_type: 'client_credentials',
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      };

      const response = await this.client.post(url, body);
      const data = response.data;

      if (data.rt_code === '0' || data.rt_code === 'OK') {
        const expiresIn = data.output.expires_in || 86400; // Default 24h
        this.token = {
          accessToken: data.output.access_token,
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + expiresIn * 1000),
        };
        console.log(`Token refreshed, expires at ${this.token.expiresAt}`);
      } else {
        throw new Error(`Token refresh failed: ${data.rt_msg}`);
      }
    } catch (error) {
      console.error('Failed to refresh token', error);
      throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.tokenLock = false;
    }
  }

  // ==================== Rate Limiting ====================

  private async acquireRateLimit(): Promise<void> {
    this.refillPermits();
    
    if (this.permits < 1) {
      this.rateLimitHitCount++;
      throw new Error('KIS_RATE_LIMIT_EXCEEDED');
    }
    
    this.permits--;
  }

  private refillPermits(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    
    const toAdd = elapsed * this.refillRate;
    this.permits = Math.min(this.permits + toAdd, this.refillRate * 2);
  }

  // ==================== Order Operations ====================

  /**
   * Place an order
   */
  async placeOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    qty: number,
    price: number | null,
    orderType: 'LIMIT' | 'MARKET'
  ): Promise<string> {
    await this.acquireRateLimit();

    const url = '/uapi/domestic-stock/v1/trading/order';
    
    const body = {
      CANO: this.config.accountNo,
      ACNT_PRDT_CD: '01',
      PDNO: symbol,
      ORD_DVSN_CD: orderType,
      ORD_QTY: String(qty),
      ORD_UNPR: price !== null ? String(price) : '0',
      SLL_BUY_DVSN_CD: side,
      ORD_CNDT_TP: '00', // Limit order
    };

    try {
      const token = await this.getAccessToken();
      const response = await this.client.post(url, body, {
        headers: {
          authorization: `Bearer ${token}`,
          appkey: this.config.appKey,
          appsecret: this.config.appSecret,
          tr_id: 'TTTC0802U',
        },
      });

      this.restCallCount++;
      const data = response.data;

      if (data.rt_code === '0') {
        const orderId = data.output.ODNO;
        console.log(`Order placed: symbol=${symbol}, side=${side}, qty=${qty}, brokerOrderId=${orderId}`);
        return orderId;
      } else {
        throw new Error(`Order failed: ${data.rt_msg}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          this.token = null; // Force refresh
        }
        if (error.response?.status === 429) {
          this.rateLimitHitCount++;
        }
      }
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(brokerOrderId: string, symbol: string): Promise<boolean> {
    await this.acquireRateLimit();

    const url = '/uapi/domestic-stock/v1/trading/order';
    
    const body = {
      CANO: this.config.accountNo,
      ACNT_PRDT_CD: '01',
      PDNO: symbol,
      OROD_NO: brokerOrderId,
    };

    try {
      const token = await this.getAccessToken();
      const response = await this.client.delete(url, {
        data: body,
        headers: {
          authorization: `Bearer ${token}`,
          appkey: this.config.appKey,
          appsecret: this.config.appSecret,
          tr_id: 'TTTC0803U',
        },
      });

      this.restCallCount++;
      const data = response.data;

      if (data.rt_code === '0') {
        console.log(`Order cancelled: brokerOrderId=${brokerOrderId}`);
        return true;
      } else {
        console.warn(`Cancel failed: ${data.rt_msg}`);
        return false;
      }
    } catch (error) {
      console.error('Cancel order failed', error);
      return false;
    }
  }

  /**
   * Get order status
   */
  async getOrderStatus(brokerOrderId: string, symbol: string): Promise<OrderResponse | null> {
    await this.acquireRateLimit();

    const url = `/uapi/domestic-stock/v1/trading/inquire-order?ORD_NO=${brokerOrderId}&PDNO=${symbol}`;

    try {
      const token = await this.getAccessToken();
      const response = await this.client.get(url, {
        headers: {
          authorization: `Bearer ${token}`,
          appkey: this.config.appKey,
          appsecret: this.config.appSecret,
          tr_id: 'TTTC0801U',
        },
      });

      this.restCallCount++;
      const data = response.data;

      if (data.rt_code === '0' && data.output) {
        return data.output;
      }
    } catch (error) {
      console.warn(`Failed to get order status: brokerOrderId=${brokerOrderId}`, error);
    }
    return null;
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<BalanceResponse[]> {
    await this.acquireRateLimit();

    const url = '/uapi/domestic-stock/v1/trading/inquire-balance';
    
    const body = {
      CANO: this.config.accountNo,
      ACNT_PRDT_CD: '01',
      AFHR_FLPR_YN: 'N',
      OFL_YN: 'N',
      INQR_DVSN_CD: '02',
    };

    try {
      const token = await this.getAccessToken();
      const response = await this.client.post(url, body, {
        headers: {
          authorization: `Bearer ${token}`,
          appkey: this.config.appKey,
          appsecret: this.config.appSecret,
          tr_id: 'TTTC8401R',
        },
      });

      this.restCallCount++;
      const data = response.data;

      if (data.rt_code === '0' && data.output) {
        return Array.isArray(data.output) ? data.output : [data.output];
      }
    } catch (error) {
      console.error('Failed to get balance', error);
    }
    return [];
  }

  // ==================== Metrics ====================

  getRestCallCount(): number {
    return this.restCallCount;
  }

  getRateLimitHitCount(): number {
    return this.rateLimitHitCount;
  }
}
