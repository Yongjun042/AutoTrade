/**
 * Policy Configuration - Controls all trading decisions
 * 
 * Based on design document Section B.
 */
export interface PolicyConfig {
  universe: UniverseConfig;
  risk: RiskConfig;
  execution: ExecutionConfig;
  budget: BudgetConfig;
}

export interface UniverseConfig {
  allowMarkets: string[];      // KOSPI, KOSDAQ
  allowAssets: string[];        // EQUITY, ETF
  denySymbols: string[];        // Forbidden symbols
}

export interface RiskConfig {
  maxGrossExposurePct: number;     // Total exposure limit
  maxPositionPctPerSymbol: number;  // Per-symbol limit
  maxOpenPositions: number;         // Max concurrent positions
  maxOrdersPerDay: number;          // Daily order limit
  maxDailyLossPct: number;         // Daily loss limit
  maxDrawdownPct: number;          // Maximum drawdown
  requireCashBufferPct: number;   // Cash buffer requirement
}

export interface ExecutionConfig {
  preferOrderType: string;         // LIMIT or MARKET
  maxSpreadBps: number;            // Max spread in bps
  minAvgDailyValueKrw: number;     // Min daily trading value
  cooldownSecondsAfterTrade: number;
  maxSlippageBpsEst: number;
  cancelIfNotAckedSec: number;
}

export interface BudgetConfig {
  maxAiCallsPerDay: number;
  maxAiCostEstKrwPerDay: number;
  maxKisRestCallsPerDay: number;
  maxOrdersPerDay: number;
  killSwitchOnBudgetExceeded: boolean;
}

/**
 * Policy Presets
 */
export const PolicyPresets = {
  conservative(): PolicyConfig {
    return {
      universe: {
        allowMarkets: ['KOSPI', 'KOSDAQ'],
        allowAssets: ['EQUITY', 'ETF'],
        denySymbols: [],
      },
      risk: {
        maxGrossExposurePct: 30,
        maxPositionPctPerSymbol: 5,
        maxOpenPositions: 6,
        maxOrdersPerDay: 10,
        maxDailyLossPct: 0.7,
        maxDrawdownPct: 3.0,
        requireCashBufferPct: 20,
      },
      execution: {
        preferOrderType: 'LIMIT',
        maxSpreadBps: 15,
        minAvgDailyValueKrw: 2_000_000_000,
        cooldownSecondsAfterTrade: 180,
        maxSlippageBpsEst: 10,
        cancelIfNotAckedSec: 5,
      },
      budget: {
        maxAiCallsPerDay: 50,
        maxAiCostEstKrwPerDay: 1000,
        maxKisRestCallsPerDay: 8000,
        maxOrdersPerDay: 10,
        killSwitchOnBudgetExceeded: true,
      },
    };
  },

  neutral(): PolicyConfig {
    return {
      universe: {
        allowMarkets: ['KOSPI', 'KOSDAQ'],
        allowAssets: ['EQUITY', 'ETF'],
        denySymbols: [],
      },
      risk: {
        maxGrossExposurePct: 60,
        maxPositionPctPerSymbol: 10,
        maxOpenPositions: 10,
        maxOrdersPerDay: 40,
        maxDailyLossPct: 1.5,
        maxDrawdownPct: 8.0,
        requireCashBufferPct: 10,
      },
      execution: {
        preferOrderType: 'LIMIT',
        maxSpreadBps: 30,
        minAvgDailyValueKrw: 1_000_000_000,
        cooldownSecondsAfterTrade: 60,
        maxSlippageBpsEst: 20,
        cancelIfNotAckedSec: 8,
      },
      budget: {
        maxAiCallsPerDay: 200,
        maxAiCostEstKrwPerDay: 3000,
        maxKisRestCallsPerDay: 20000,
        maxOrdersPerDay: 40,
        killSwitchOnBudgetExceeded: true,
      },
    };
  },

  aggressive(): PolicyConfig {
    return {
      universe: {
        allowMarkets: ['KOSPI', 'KOSDAQ'],
        allowAssets: ['EQUITY', 'ETF'],
        denySymbols: [],
      },
      risk: {
        maxGrossExposurePct: 85,
        maxPositionPctPerSymbol: 15,
        maxOpenPositions: 15,
        maxOrdersPerDay: 120,
        maxDailyLossPct: 2.5,
        maxDrawdownPct: 12.0,
        requireCashBufferPct: 5,
      },
      execution: {
        preferOrderType: 'LIMIT',
        maxSpreadBps: 50,
        minAvgDailyValueKrw: 500_000_000,
        cooldownSecondsAfterTrade: 10,
        maxSlippageBpsEst: 35,
        cancelIfNotAckedSec: 10,
      },
      budget: {
        maxAiCallsPerDay: 800,
        maxAiCostEstKrwPerDay: 10000,
        maxKisRestCallsPerDay: 50000,
        maxOrdersPerDay: 120,
        killSwitchOnBudgetExceeded: true,
      },
    };
  },
};
