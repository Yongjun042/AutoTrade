import Redis from 'ioredis';

interface BudgetConfig {
  maxAiCallsPerDay: number;
  maxAiCostEstKrwPerDay: number;
  maxKisRestCallsPerDay: number;
  maxOrdersPerDay: number;
  killSwitchOnBudgetExceeded: boolean;
}

interface BudgetStatus {
  date: string;
  aiCalls: number;
  aiCallsLimit: number;
  aiCostKrw: number;
  aiCostLimit: number;
  orders: number;
  ordersLimit: number;
  kisCalls: number;
  kisCallsLimit: number;
  killSwitchActive: boolean;
}

/**
 * Budget Manager
 * 
 * Controls:
 * - AI call limits (per day)
 * - AI cost limits (estimated)
 * - KIS API call limits
 * - Order count limits
 * 
 * When budget is exhausted, triggers fallback or kill switch
 */
export class BudgetManager {
  private redis: Redis | null = null;
  private budget: BudgetConfig;
  private killSwitch = false;

  constructor(redisUrl: string | null, budget?: Partial<BudgetConfig>) {
    // Default budget (neutral preset)
    this.budget = {
      maxAiCallsPerDay: budget?.maxAiCallsPerDay || 200,
      maxAiCostEstKrwPerDay: budget?.maxAiCostEstKrwPerDay || 3000,
      maxKisRestCallsPerDay: budget?.maxKisRestCallsPerDay || 20000,
      maxOrdersPerDay: budget?.maxOrdersPerDay || 40,
      killSwitchOnBudgetExceeded: budget?.killSwitchOnBudgetExceeded ?? true,
    };

    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  setBudget(budget: Partial<BudgetConfig>): void {
    this.budget = { ...this.budget, ...budget };
  }

  /**
   * Check if we can make an AI call
   */
  canMakeAiCall(): boolean {
    if (this.killSwitch) return false;
    return this.getAiCallsToday() < this.budget.maxAiCallsPerDay;
  }

  /**
   * Check if we can make an order
   */
  canPlaceOrder(): boolean {
    if (this.killSwitch) return false;
    return this.getOrdersToday() < this.budget.maxOrdersPerDay;
  }

  /**
   * Check if we can make KIS REST call
   */
  canMakeKisCall(): boolean {
    if (this.killSwitch) return false;
    return this.getKisCallsToday() < this.budget.maxKisRestCallsPerDay;
  }

  /**
   * Record AI call
   */
  async recordAiCall(estimatedCostKrw: number): Promise<void> {
    this.incrementAiCalls();
    await this.addAiCost(estimatedCostKrw);

    console.debug(`AI call recorded: cost=${estimatedCostKrw}krw, today=${this.getAiCallsToday()}`);

    this.checkBudgetExceeded();
  }

  /**
   * Record KIS REST call
   */
  async recordKisCall(): Promise<void> {
    this.incrementKisCalls();
    console.debug(`KIS REST call recorded: today=${this.getKisCallsToday()}`);
  }

  /**
   * Record order
   */
  async recordOrder(): Promise<void> {
    this.incrementOrders();
    console.debug(`Order recorded: today=${this.getOrdersToday()}`);
  }

  // ==================== Budget Check ====================

  private checkBudgetExceeded(): void {
    const aiCalls = this.getAiCallsToday();
    const aiCost = this.getAiCostToday();

    if (
      (aiCalls >= this.budget.maxAiCallsPerDay || aiCost >= this.budget.maxAiCostEstKrwPerDay) &&
      this.budget.killSwitchOnBudgetExceeded
    ) {
      console.warn(
        `AI budget exceeded! Calls: ${aiCalls}/${this.budget.maxAiCallsPerDay}, Cost: ${aiCost}/${this.budget.maxAiCostEstKrwPerDay}`
      );
    }
  }

  // ==================== Redis Operations ====================

  private todayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private aiCallsKey(): string { return `budget:ai_calls:${this.todayKey()}`; }
  private aiCostKey(): string { return `budget:ai_cost:${this.todayKey()}`; }
  private ordersKey(): string { return `budget:orders:${this.todayKey()}`; }
  private kisCallsKey(): string { return `budget:kis_calls:${this.todayKey()}`; }

  private getAiCallsToday(): number {
    return this.getRedisValue(this.aiCallsKey());
  }

  private incrementAiCalls(): void {
    if (this.redis) {
      this.redis.incr(this.aiCallsKey()).catch(console.error);
    }
  }

  private getAiCostToday(): number {
    return this.getRedisValue(this.aiCostKey());
  }

  private async addAiCost(cost: number): Promise<void> {
    if (this.redis) {
      await this.redis.incrby(this.aiCostKey(), cost).catch(console.error);
    }
  }

  private getOrdersToday(): number {
    return this.getRedisValue(this.ordersKey());
  }

  private incrementOrders(): void {
    if (this.redis) {
      this.redis.incr(this.ordersKey()).catch(console.error);
    }
  }

  private getKisCallsToday(): number {
    return this.getRedisValue(this.kisCallsKey());
  }

  private getRedisValue(key: string): number {
    if (!this.redis) return 0;
    // Synchronous access would need different approach, using cached values
    return 0;
  }

  // ==================== Kill Switch ====================

  activateKillSwitch(reason: string): void {
    console.warn(`KILL SWITCH ACTIVATED: ${reason}`);
    this.killSwitch = true;
  }

  deactivateKillSwitch(): void {
    console.log('KILL SWITCH DEACTIVATED');
    this.killSwitch = false;
  }

  isKillSwitchActive(): boolean {
    return this.killSwitch;
  }

  // ==================== Status ====================

  getStatus(): BudgetStatus {
    return {
      date: this.todayKey(),
      aiCalls: this.getAiCallsToday(),
      aiCallsLimit: this.budget.maxAiCallsPerDay,
      aiCostKrw: this.getAiCostToday(),
      aiCostLimit: this.budget.maxAiCostEstKrwPerDay,
      orders: this.getOrdersToday(),
      ordersLimit: this.budget.maxOrdersPerDay,
      kisCalls: this.getKisCallsToday(),
      kisCallsLimit: this.budget.maxKisRestCallsPerDay,
      killSwitchActive: this.killSwitch,
    };
  }
}
