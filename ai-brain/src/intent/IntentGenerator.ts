import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy, Signal, createStrategy, MarketData, Position } from './strategies';

interface IntentRequest {
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  intentQty: number;
  orderType?: 'LIMIT' | 'MARKET';
  limitPrice?: number;
  timeInForceSec?: number;
  confidence: number;
  reasons: string;
  expiresAt?: string;
}

/**
 * Intent Generator
 * 
 * Converts strategy signals into TradeIntent format
 * and sends to Trading Core API
 */
export class IntentGenerator {
  private tradingCoreUrl: string;
  private strategy: BaseStrategy;
  private enabled = true;

  constructor(tradingCoreUrl: string, strategyId: string, strategyConfig?: any) {
    this.tradingCoreUrl = tradingCoreUrl;
    this.strategy = createStrategy(strategyId, strategyConfig);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`Intent generator ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Generate intent from market data
   */
  async generateIntent(marketData: MarketData, positions: Position[]): Promise<IntentRequest | null> {
    if (!this.enabled) {
      return null;
    }

    const signal = this.strategy.analyze(marketData, positions);
    if (!signal || signal.action === 'HOLD') {
      return null;
    }

    // Convert signal to intent request
    const intent: IntentRequest = {
      strategyId: signal.strategyId,
      symbol: signal.symbol,
      side: signal.action as 'BUY' | 'SELL',
      intentQty: this.calculatePositionSize(marketData, signal),
      orderType: 'LIMIT',
      limitPrice: marketData.currentPrice,
      timeInForceSec: 120,
      confidence: signal.confidence,
      reasons: JSON.stringify(signal.reasons),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min expiry
    };

    return intent;
  }

  /**
   * Calculate position size based on risk rules
   */
  private calculatePositionSize(marketData: MarketData, signal: Signal): number {
    // Simplified - in production, use proper risk management
    const maxPositionValue = 1000000; // 1M KRW max per trade
    const price = marketData.currentPrice;
    return Math.floor(maxPositionValue / price);
  }

  /**
   * Submit intent to Trading Core
   */
  async submitIntent(intent: IntentRequest): Promise<{ success: boolean; orderId?: number; message?: string }> {
    try {
      const response = await axios.post(`${this.tradingCoreUrl}/api/intents`, {
        idempotencyKey: uuidv4(),
        ...intent,
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;
      console.log(`Intent submitted: success=${data.success}, orderId=${data.orderId || 'N/A'}`);

      return {
        success: data.success,
        orderId: data.orderId,
        message: data.message,
      };
    } catch (error) {
      console.error('Failed to submit intent:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Run strategy cycle
   */
  async runCycle(marketData: MarketData, positions: Position[]): Promise<void> {
    const intent = await this.generateIntent(marketData, positions);
    if (intent) {
      await this.submitIntent(intent);
    }
  }
}
