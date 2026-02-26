# TRADING CORE CODE MAP

## OVERVIEW
`trading-core/src` is the execution boundary: validate intents, enforce policy/budget, and perform broker-side order actions.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API routes + orchestration | `trading-core/src/index.ts` | `/api/intents` path wires idempotency -> risk -> order submit |
| Risk gating and rejection codes | `trading-core/src/policy/PolicyRiskEngine.ts` | Central source for `RISK_*` blocks |
| Risk/budget preset definitions | `trading-core/src/policy/PolicyConfig.ts` | Preset factories used by engine |
| Budget counters + kill switch | `trading-core/src/policy/BudgetManager.ts` | AI/order/KIS counters and stop-trading switch |
| Broker integration | `trading-core/src/kis/KisGateway.ts` | Token lifecycle, rate limiter, order APIs |
| Domain entities + state machine | `trading-core/src/domain/*.ts` | `OrderStateTransitions`, `TradeIntent`, `OrderEvent` |
| Core tests | `trading-core/src/**/*.test.ts` | Domain and policy tests are colocated |

## CONVENTIONS
- Keep execution flow in order: kill switch -> idempotency -> intent persist -> budget -> risk -> order create/submit.
- Preserve explicit rejection reason codes (`RISK_*`) for every policy deny decision.
- Keep broker calls behind `KisGateway`; API route handlers should not duplicate KIS protocol logic.
- Use domain enums for state/side/order type values instead of string literals when mutating entities.
- Log order lifecycle via `OrderEvent` for every significant transition.

## ANTI-PATTERNS
- Never submit a broker order before policy and budget checks pass.
- Never bypass `idempotencyKey` duplicate protection in `/api/intents`.
- Never call KIS API directly from policy/domain modules.
- Never treat rejected intents as approvable fallbacks.
- Never create new orders when kill switch is active.
