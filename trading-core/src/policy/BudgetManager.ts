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

interface BudgetCounters {
  date: string;
  aiCalls: number;
  aiCostKrw: number;
  orders: number;
  kisCalls: number;
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
  private counters: BudgetCounters;

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
      this.redis.on('error', (err) => {
        console.error('Redis error in BudgetManager:', err);
      });
    }

    this.counters = {
      date: this.todayKey(),
      aiCalls: 0,
      aiCostKrw: 0,
      orders: 0,
      kisCalls: 0,
    };

    if (this.redis) {
      void this.hydrateFromRedis();
    }
  }

  setBudget(budget: Partial<BudgetConfig>): void {
    this.budget = { ...this.budget, ...budget };
    this.checkBudgetExceeded();
  }

  /**
   * Check if we can make an AI call
   */
  canMakeAiCall(): boolean {
    this.ensureCurrentDate();
    if (this.killSwitch) return false;
    return this.counters.aiCalls < this.budget.maxAiCallsPerDay;
  }

  /**
   * Check if we can make an order
   */
  canPlaceOrder(): boolean {
    this.ensureCurrentDate();
    if (this.killSwitch) return false;
    return this.counters.orders < this.budget.maxOrdersPerDay;
  }

  /**
   * Check if we can make KIS REST call
   */
  canMakeKisCall(): boolean {
    this.ensureCurrentDate();
    if (this.killSwitch) return false;
    return this.counters.kisCalls < this.budget.maxKisRestCallsPerDay;
  }

  /**
   * Record AI call
   */
  async recordAiCall(estimatedCostKrw: number): Promise<void> {
    this.ensureCurrentDate();
    this.counters.aiCalls += 1;
    this.counters.aiCostKrw += estimatedCostKrw;

    await Promise.all([
      this.incrementRedisCounter(this.aiCallsKey(), 1),
      this.incrementRedisCounter(this.aiCostKey(), estimatedCostKrw),
    ]);

    console.debug(`AI call recorded: cost=${estimatedCostKrw}krw, today=${this.counters.aiCalls}`);

    this.checkBudgetExceeded();
  }

  /**
   * Record KIS REST call
   */
  async recordKisCall(): Promise<void> {
    this.ensureCurrentDate();
    this.counters.kisCalls += 1;
    await this.incrementRedisCounter(this.kisCallsKey(), 1);
    console.debug(`KIS REST call recorded: today=${this.counters.kisCalls}`);
    this.checkBudgetExceeded();
  }

  /**
   * Record order
   */
  async recordOrder(): Promise<void> {
    this.ensureCurrentDate();
    this.counters.orders += 1;
    await this.incrementRedisCounter(this.ordersKey(), 1);
    console.debug(`Order recorded: today=${this.counters.orders}`);
    this.checkBudgetExceeded();
  }

  // ==================== Budget Check ====================

  private checkBudgetExceeded(): void {
    this.ensureCurrentDate();

    const aiCalls = this.counters.aiCalls;
    const aiCost = this.counters.aiCostKrw;
    const orders = this.counters.orders;
    const kisCalls = this.counters.kisCalls;

    const exceeded: string[] = [];

    if (aiCalls >= this.budget.maxAiCallsPerDay) {
      exceeded.push(`AI_CALLS ${aiCalls}/${this.budget.maxAiCallsPerDay}`);
    }

    if (aiCost >= this.budget.maxAiCostEstKrwPerDay) {
      exceeded.push(`AI_COST ${aiCost}/${this.budget.maxAiCostEstKrwPerDay}`);
    }

    if (orders >= this.budget.maxOrdersPerDay) {
      exceeded.push(`ORDERS ${orders}/${this.budget.maxOrdersPerDay}`);
    }

    if (kisCalls >= this.budget.maxKisRestCallsPerDay) {
      exceeded.push(`KIS_CALLS ${kisCalls}/${this.budget.maxKisRestCallsPerDay}`);
    }

    if (exceeded.length === 0) {
      return;
    }

    const message = `Budget exceeded! ${exceeded.join(', ')}`;
    console.warn(message);

    if (this.budget.killSwitchOnBudgetExceeded && !this.killSwitch) {
      this.activateKillSwitch(message);
    }
  }

  // ==================== Redis Operations ====================

  private todayKey(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private aiCallsKey(): string { return `budget:ai_calls:${this.todayKey()}`; }
  private aiCostKey(): string { return `budget:ai_cost:${this.todayKey()}`; }
  private ordersKey(): string { return `budget:orders:${this.todayKey()}`; }
  private kisCallsKey(): string { return `budget:kis_calls:${this.todayKey()}`; }

  private ensureCurrentDate(): void {
    const today = this.todayKey();
    if (this.counters.date === today) {
      return;
    }

    this.counters = {
      date: today,
      aiCalls: 0,
      aiCostKrw: 0,
      orders: 0,
      kisCalls: 0,
    };

    if (this.redis) {
      void this.hydrateFromRedis();
    }
  }

  private secondsUntilTomorrow(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    return Math.max(1, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));
  }

  private async incrementRedisCounter(key: string, amount: number): Promise<void> {
    if (!this.redis) {
      return;
    }

    const ttl = this.secondsUntilTomorrow();
    await this.redis
      .multi()
      .incrby(key, amount)
      .expire(key, ttl)
      .exec()
      .catch((err) => {
        console.error('Failed to update budget counter in Redis:', err);
      });
  }

  private parseCounter(value: string | null): number {
    if (!value) {
      return 0;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private async hydrateFromRedis(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const [aiCalls, aiCost, orders, kisCalls] = await this.redis.mget(
        this.aiCallsKey(),
        this.aiCostKey(),
        this.ordersKey(),
        this.kisCallsKey()
      );

      this.counters.aiCalls = this.parseCounter(aiCalls);
      this.counters.aiCostKrw = this.parseCounter(aiCost);
      this.counters.orders = this.parseCounter(orders);
      this.counters.kisCalls = this.parseCounter(kisCalls);
    } catch (err) {
      console.error('Failed to hydrate budget counters from Redis:', err);
    }
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
    this.ensureCurrentDate();

    return {
      date: this.counters.date,
      aiCalls: this.counters.aiCalls,
      aiCallsLimit: this.budget.maxAiCallsPerDay,
      aiCostKrw: this.counters.aiCostKrw,
      aiCostLimit: this.budget.maxAiCostEstKrwPerDay,
      orders: this.counters.orders,
      ordersLimit: this.budget.maxOrdersPerDay,
      kisCalls: this.counters.kisCalls,
      kisCallsLimit: this.budget.maxKisRestCallsPerDay,
      killSwitchActive: this.killSwitch,
    };
  }
}
