export interface MarketData {
  symbol: string;
  currentPrice: number;
  volume: number;
  bidPrice: number;
  askPrice: number;
  timestamp: Date;
  
  get spread(): number;
  get spreadBps(): number;
}

export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  
  get unrealizedPnl(): number;
  get marketValue(): number;
}

export interface Signal {
  strategyId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasons: string[];
  metadata: Record<string, any>;
  timestamp: Date;
}

export interface StrategyConfig {
  [key: string]: any;
}

/**
 * Base class for all trading strategies
 */
export abstract class BaseStrategy {
  protected strategyId: string;
  protected config: StrategyConfig;
  public enabled = true;

  constructor(strategyId: string, config: StrategyConfig = {}) {
    this.strategyId = strategyId;
    this.config = config;
  }

  /**
   * Analyze market data and generate trading signal
   */
  abstract analyze(marketData: MarketData, positions: Position[]): Signal | null;

  /**
   * Return list of required market data types
   */
  abstract getRequiredData(): string[];
}

/**
 * Momentum-based intraday strategy
 */
export class MomentumStrategy extends BaseStrategy {
  private threshold = 0.02;
  private volumeThreshold = 1000000;

  constructor(config: StrategyConfig = {}) {
    super('mom_v1', config);
    this.threshold = config.threshold ?? 0.02;
    this.volumeThreshold = config.volumeThreshold ?? 1000000;
  }

  analyze(marketData: MarketData, positions: Position[]): Signal | null {
    // Check spread
    if (marketData.spreadBps > 30) {
      return null;
    }

    // Check volume
    if (marketData.volume < this.volumeThreshold) {
      return null;
    }

    // Check if already have position
    const existing = positions.find(p => p.symbol === marketData.symbol);
    const reasons = [`volume=${marketData.volume}`, `spread_bps=${marketData.spreadBps.toFixed(1)}`];
    const confidence = 0.5;

    if (existing) {
      // Check exit conditions
      const pnlPct = (existing.currentPrice - existing.avgPrice) / existing.avgPrice * 100;
      if (pnlPct < -2) {
        return {
          strategyId: this.strategyId,
          symbol: marketData.symbol,
          action: 'SELL',
          confidence: 0.9,
          reasons: ['stop_loss', ...reasons],
          metadata: { pnlPct },
          timestamp: new Date(),
        };
      }
    } else {
      // Entry signal
      return {
        strategyId: this.strategyId,
        symbol: marketData.symbol,
        action: 'BUY',
        confidence,
        reasons: ['momentum', ...reasons],
        metadata: { price: marketData.currentPrice },
        timestamp: new Date(),
      };
    }

    return null;
  }

  getRequiredData(): string[] {
    return ['price', 'volume', 'bid', 'ask'];
  }
}

/**
 * Trend-following swing strategy
 */
export class TrendStrategy extends BaseStrategy {
  private lookbackPeriod = 20;

  constructor(config: StrategyConfig = {}) {
    super('trend_v1', config);
    this.lookbackPeriod = config.lookbackPeriod ?? 20;
  }

  analyze(marketData: MarketData, positions: Position[]): Signal | null {
    // Simplified - would use moving averages in production
    return null;
  }

  getRequiredData(): string[] {
    return ['price', 'volume'];
  }
}

/**
 * Weekly rebalancing strategy
 */
export class RebalanceStrategy extends BaseStrategy {
  private targetPositions = 5;

  constructor(config: StrategyConfig = {}) {
    super('rebalance_weekly_v1', config);
    this.targetPositions = config.targetPositions ?? 5;
  }

  analyze(marketData: MarketData, positions: Position[]): Signal | null {
    return null;
  }

  getRequiredData(): string[] {
    return ['price'];
  }
}

// Strategy Registry
export const STRATEGY_REGISTRY: Record<string, new (config?: StrategyConfig) => BaseStrategy> = {
  'mom_v1': MomentumStrategy,
  'trend_v1': TrendStrategy,
  'rebalance_weekly_v1': RebalanceStrategy,
};

export function createStrategy(strategyId: string, config?: StrategyConfig): BaseStrategy {
  const StrategyClass = STRATEGY_REGISTRY[strategyId];
  if (!StrategyClass) {
    throw new Error(`Unknown strategy: ${strategyId}`);
  }
  return new StrategyClass(config);
}
