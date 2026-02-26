# AI BRAIN CODE MAP

## OVERVIEW
`ai-brain/src` owns strategy and intent generation; it proposes trades but does not execute broker operations.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API bootstrap + runtime config | `ai-brain/src/index.ts` | Exposes health, LLM endpoints, and manual cycle trigger |
| Strategy registry + signal logic | `ai-brain/src/strategies/index.ts` | `createStrategy`, strategy IDs, signal contract |
| Signal -> intent conversion | `ai-brain/src/intent/IntentGenerator.ts` | Builds intent payload and posts to Trading Core |
| Local LLM integration | `ai-brain/src/llm/OllamaClient.ts` | Ollama availability, analysis/report helpers |
| Strategy tests | `ai-brain/src/strategies/index.test.ts` | Jest tests colocated with strategy module |

## CONVENTIONS
- Keep AI Brain output as proposal-only intent data; execution decisions belong to Trading Core.
- Strategy modules should emit normalized `Signal` objects (`BUY`/`SELL`/`HOLD`) with explicit reasons.
- Intent transport format should stay aligned with Trading Core `/api/intents` contract.
- Keep LLM features optional and degradable when Ollama is unavailable.
- Preserve deterministic strategy IDs (`mom_v1`, `trend_v1`, `rebalance_weekly_v1`) for downstream compatibility.

## ANTI-PATTERNS
- Never embed broker order execution logic in AI Brain modules.
- Never skip intent idempotency generation before POST to Trading Core.
- Never couple strategy logic to dashboard/UI concerns.
- Never assume Ollama availability; handle offline mode gracefully.
- Never invent strategy IDs that are not registered in `STRATEGY_REGISTRY`.
