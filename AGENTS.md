# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-26T09:16:26+09:00
**Commit:** a720eb4
**Branch:** main

## OVERVIEW
AutoTrade is a two-service TypeScript system: `ai-brain` generates trade intents, `trading-core` enforces policy and executes broker calls.
Repository layout is lightweight monorepo style (no root workspace scripts): commands run per service package.

## STRUCTURE
```text
AutoTrade/
├── trading-core/      # Execution authority: API, policy, broker gateway
│   └── src/
├── ai-brain/          # Strategy, intent generation, local LLM helpers
│   └── src/
├── dashboard/         # Static UI served by trading-core root route
├── config/            # Shared env and policy preset files
├── infra/quadlet/     # Podman systemd units for runtime deployment
└── docs/              # Architecture and operational constraints
```

## AGENT FILE HIERARCHY
- Root scope: `AGENTS.md`
- Trading Core scoped rules: `trading-core/src/AGENTS.md`
- AI Brain scoped rules: `ai-brain/src/AGENTS.md`
- Precedence: nearest `AGENTS.md` to target file overrides broader rules.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Intent intake + order creation flow | `trading-core/src/index.ts` | `/api/intents` gate: idempotency, budget, policy, order creation |
| Risk and policy decisions | `trading-core/src/policy/PolicyRiskEngine.ts` | Emits `RISK_*` rejection reasons |
| Policy presets and thresholds | `trading-core/src/policy/PolicyConfig.ts`, `config/policy-*.yaml` | Conservative/Neutral/Aggressive limits |
| Budget + kill switch behavior | `trading-core/src/policy/BudgetManager.ts` | AI/order/KIS budget counters and kill-switch state |
| Broker API integration | `trading-core/src/kis/KisGateway.ts` | Token management + rate limiting + order APIs |
| Domain state model | `trading-core/src/domain/*.ts` | `TradeIntent`, `Order`, `OrderEvent`, `RiskDecision` |
| Strategy logic and registry | `ai-brain/src/strategies/index.ts` | `mom_v1`, `trend_v1`, `rebalance_weekly_v1` |
| Signal -> intent translation | `ai-brain/src/intent/IntentGenerator.ts` | Posts to Trading Core `/api/intents` |
| LLM integration surface | `ai-brain/src/llm/OllamaClient.ts` | Local Ollama APIs for analysis/reporting |
| Runtime/deploy wiring | `infra/quadlet/*.container`, `config/*.env.example` | Service dependencies and runtime env contracts |

## CONVENTIONS
- TypeScript strict mode in both services (`strict: true`).
- Service layout fixed as `src/` input -> `dist/` output.
- Tests are colocated and matched by `**/*.test.ts` under `src/`.
- Runtime target is CommonJS + ES2020 in both services.
- `trading-core` enables decorators and metadata emit (TypeORM-oriented patterns).
- No repository-level lint/format config is enforced.
- Any file change must include documentation sync: update `README.md` and relevant files under `docs/` when behavior, APIs, flows, setup, or operations change.

## ANTI-PATTERNS (THIS PROJECT)
- Do not execute broker orders from `ai-brain`; execution authority is `trading-core`.
- Do not add direct KIS API usage outside `trading-core/src/kis/KisGateway.ts`.
- Do not bypass `PolicyRiskEngine` checks before order creation.
- Do not create new orders while kill switch is active.
- Do not ignore `RISK_*` rejection codes or force-approve intents.
- Do not expose Ollama as a public internet endpoint; keep local/internal scope.

## UNIQUE STYLES
- Architectural split is strict: AI proposes, core decides and executes.
- Dashboard is a single static HTML served from Trading Core, not a separate frontend build.
- Deployment source-of-truth is Quadlet units under `infra/quadlet`, not Docker Compose.
- Policy behavior is preset-driven with YAML files in `config/`.

## COMMANDS
```bash
# Trading Core
cd trading-core && npm install
cd trading-core && npm run dev
cd trading-core && npm run build
cd trading-core && npm test

# AI Brain
cd ai-brain && npm install
cd ai-brain && npm run dev
cd ai-brain && npm run build
cd ai-brain && npx jest
```

## NOTES
- `trading-core/package.json` appears malformed (duplicated JSON object); treat scripts as unreliable until fixed.
- `ai-brain/package.json` has no `test` script even though Jest config and tests exist.
- `infra/quadlet/tradebot-redis.container` references `redisdata.volume`, which is not present beside `pgdata.volume`.
- This environment does not have `typescript-language-server`; symbol map here was derived with AST/grep fallback.
