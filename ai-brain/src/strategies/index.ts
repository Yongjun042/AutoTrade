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
  private entryThresholdPct = 0.8;
  private stopLossPct = -3;
  private takeProfitPct = 4;

  constructor(config: StrategyConfig = {}) {
    super('trend_v1', config);
    this.lookbackPeriod = config.lookbackPeriod ?? 20;
    this.entryThresholdPct = config.entryThresholdPct ?? 0.8;
    this.stopLossPct = config.stopLossPct ?? -3;
    this.takeProfitPct = config.takeProfitPct ?? 4;
  }

  analyze(marketData: MarketData, positions: Position[]): Signal | null {
    if (marketData.currentPrice <= 0 || marketData.volume <= 0) {
      return null;
    }

    const existing = positions.find((p) => p.symbol === marketData.symbol);
    const momentumPct = ((marketData.currentPrice - marketData.bidPrice) / marketData.currentPrice) * 100;
    const reasons = [
      `lookback=${this.lookbackPeriod}`,
      `momentum_pct=${momentumPct.toFixed(2)}`,
      `spread_bps=${marketData.spreadBps.toFixed(1)}`,
    ];

    if (existing && existing.avgPrice > 0) {
      const pnlPct = ((marketData.currentPrice - existing.avgPrice) / existing.avgPrice) * 100;

      if (pnlPct <= this.stopLossPct) {
        return {
          strategyId: this.strategyId,
          symbol: marketData.symbol,
          action: 'SELL',
          confidence: 0.85,
          reasons: ['trend_stop_loss', ...reasons],
          metadata: { pnlPct },
          timestamp: new Date(),
        };
      }

      if (pnlPct >= this.takeProfitPct) {
        return {
          strategyId: this.strategyId,
          symbol: marketData.symbol,
          action: 'SELL',
          confidence: 0.75,
          reasons: ['trend_take_profit', ...reasons],
          metadata: { pnlPct },
          timestamp: new Date(),
        };
      }

      return null;
    }

    if (marketData.spreadBps > 25) {
      return null;
    }

    if (momentumPct >= this.entryThresholdPct) {
      return {
        strategyId: this.strategyId,
        symbol: marketData.symbol,
        action: 'BUY',
        confidence: 0.55,
        reasons: ['trend_breakout', ...reasons],
        metadata: {
          lookbackPeriod: this.lookbackPeriod,
          entryThresholdPct: this.entryThresholdPct,
        },
        timestamp: new Date(),
      };
    }

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
  private imbalanceTolerance = 0.35;

  constructor(config: StrategyConfig = {}) {
    super('rebalance_weekly_v1', config);
    this.targetPositions = config.targetPositions ?? 5;
    this.imbalanceTolerance = config.imbalanceTolerance ?? 0.35;
  }

  analyze(marketData: MarketData, positions: Position[]): Signal | null {
    if (marketData.currentPrice <= 0) {
      return null;
    }

    const existing = positions.find((p) => p.symbol === marketData.symbol);
    const reasons = [`target_positions=${this.targetPositions}`, `positions=${positions.length}`];

    if (!existing && positions.length < this.targetPositions && marketData.spreadBps <= 30) {
      return {
        strategyId: this.strategyId,
        symbol: marketData.symbol,
        action: 'BUY',
        confidence: 0.5,
        reasons: ['rebalance_fill_slot', ...reasons],
        metadata: {
          targetPositions: this.targetPositions,
        },
        timestamp: new Date(),
      };
    }

    if (!existing || positions.length === 0) {
      return null;
    }

    const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const targetValue = totalMarketValue / Math.max(1, this.targetPositions);

    if (targetValue <= 0) {
      return null;
    }

    const overweightRatio = existing.marketValue / targetValue;
    if (overweightRatio >= 1 + this.imbalanceTolerance) {
      return {
        strategyId: this.strategyId,
        symbol: marketData.symbol,
        action: 'SELL',
        confidence: 0.6,
        reasons: ['rebalance_trim_overweight', ...reasons],
        metadata: {
          overweightRatio,
          targetValue,
        },
        timestamp: new Date(),
      };
    }

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
