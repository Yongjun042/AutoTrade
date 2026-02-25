import { PolicyConfig, PolicyPresets } from './PolicyConfig';
import { RiskDecision, RiskDecisionType } from '../domain/RiskDecision';
import { TradeIntent } from '../domain/TradeIntent';

interface PortfolioState {
  totalEquity: number;
  cash: number;
  marketValue: number;
  dailyPnl: number;
  ordersToday: number;
  positions: PositionSnapshot[];
}

interface PositionSnapshot {
  symbol: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

/**
 * Policy & Risk Engine
 * 
 * Evaluates TradeIntent against policy rules and makes approval decisions.
 * This is the "gatekeeper" - AI can propose, but Policy decides.
 */
export class PolicyRiskEngine {
  private policy: PolicyConfig;
  private recentTradedSymbols = new Set<string>();
  private lastTradeTime = new Map<string, Date>();

  constructor(policyPreset: 'conservative' | 'neutral' | 'aggressive' = 'neutral') {
    this.policy = PolicyPresets[policyPreset]();
  }

  /**
   * Update active policy
   */
  setPolicy(policy: PolicyConfig): void {
    console.log(`Switching to policy: maxExposure=${policy.risk.maxGrossExposurePct}%`);
    this.policy = policy;
  }

  /**
   * Evaluate TradeIntent against policy rules
   */
  evaluate(intent: TradeIntent, portfolio: PortfolioState, dailyPnl: number): RiskDecision {
    const rejectReasons: string[] = [];

    // 1. Universe Check
    if (!this.isSymbolAllowed(intent.symbol)) {
      rejectReasons.push('RISK_SYMBOL_NOT_ALLOWED');
    }

    // 2. Position Limit Check
    const currentPositions = portfolio.positions.filter(p => p.qty > 0).length;
    if (currentPositions >= this.policy.risk.maxOpenPositions) {
      rejectReasons.push('RISK_MAX_POSITIONS_EXCEEDED');
    }

    // 3. Per-Symbol Position Limit
    const existingPosition = portfolio.positions.find(p => p.symbol === intent.symbol);
    const existingValue = existingPosition ? existingPosition.marketValue : 0;
    const proposedValue = intent.intentQty * (intent.limitPrice || 0);
    const totalExposure = existingValue + proposedValue;

    if (portfolio.totalEquity > 0) {
      const exposurePct = (totalExposure / portfolio.totalEquity) * 100;
      if (exposurePct > this.policy.risk.maxPositionPctPerSymbol) {
        rejectReasons.push('RISK_MAX_POSITION_PCT_EXCEEDED');
      }
    }

    // 4. Gross Exposure Check
    const currentExposurePct = (portfolio.marketValue / portfolio.totalEquity) * 100;
    const newExposurePct = currentExposurePct + (proposedValue / portfolio.totalEquity) * 100;

    if (newExposurePct > this.policy.risk.maxGrossExposurePct) {
      rejectReasons.push('RISK_MAX_GROSS_EXPOSURE_EXCEEDED');
    }

    // 5. Cash Buffer Check
    const requiredBuffer = portfolio.totalEquity * (this.policy.risk.requireCashBufferPct / 100);
    if (portfolio.cash < requiredBuffer) {
      rejectReasons.push('RISK_CASH_BUFFER_INSUFFICIENT');
    }

    // 6. Daily Loss Limit
    if (portfolio.totalEquity > 0) {
      const dailyLossPct = Math.abs(dailyPnl) / portfolio.totalEquity * 100;
      if (dailyPnl < 0 && dailyLossPct > this.policy.risk.maxDailyLossPct) {
        rejectReasons.push('RISK_DAILY_LOSS_LIMIT_EXCEEDED');
      }
    }

    // 7. Order Count Limit
    if (portfolio.ordersToday >= this.policy.risk.maxOrdersPerDay) {
      rejectReasons.push('RISK_MAX_ORDERS_PER_DAY_EXCEEDED');
    }

    // 8. Cooldown Check
    if (this.recentTradedSymbols.has(intent.symbol)) {
      const lastTrade = this.lastTradeTime.get(intent.symbol);
      if (lastTrade) {
        const secondsSince = (Date.now() - lastTrade.getTime()) / 1000;
        if (secondsSince < this.policy.execution.cooldownSecondsAfterTrade) {
          rejectReasons.push('RISK_COOLDOWN_ACTIVE');
        }
      }
    }

    // 9. Intent Expiration Check
    if (intent.expiresAt && new Date() > intent.expiresAt) {
      rejectReasons.push('RISK_INTENT_EXPIRED');
    }

    // Final decision
    if (rejectReasons.length > 0) {
      console.warn(`Intent rejected: ${rejectReasons.join(', ')}`);
      return RiskDecision.reject(...rejectReasons);
    }

    console.log(`Intent approved: symbol=${intent.symbol}, side=${intent.side}, qty=${intent.intentQty}`);

    // Update recent trades for cooldown
    this.recentTradedSymbols.add(intent.symbol);
    this.lastTradeTime.set(intent.symbol, new Date());

    return RiskDecision.approve();
  }

  private isSymbolAllowed(symbol: string): boolean {
    // Check deny list
    if (this.policy.universe.denySymbols.includes(symbol)) {
      return false;
    }
    return true;
  }

  getPolicy(): PolicyConfig {
    return this.policy;
  }
}
