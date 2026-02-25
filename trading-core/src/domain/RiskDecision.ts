export enum RiskDecisionType {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  DEFER = 'DEFER',
}

/**
 * Risk Decision - Result of Policy & Risk evaluation
 */
export class RiskDecision {
  constructor(
    public decision: RiskDecisionType,
    public reasonCodes: string[],
    public message: string
  ) {}

  static approve(): RiskDecision {
    return new RiskDecision(RiskDecisionType.APPROVE, [], 'Approved');
  }

  static reject(...reasons: string[]): RiskDecision {
    return new RiskDecision(RiskDecisionType.REJECT, reasons, reasons.join(', '));
  }

  static defer(message: string): RiskDecision {
    return new RiskDecision(RiskDecisionType.DEFER, [], message);
  }

  get isApproved(): boolean {
    return this.decision === RiskDecisionType.APPROVE;
  }

  get isRejected(): boolean {
    return this.decision === RiskDecisionType.REJECT;
  }
}
