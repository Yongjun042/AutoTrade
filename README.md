# AutoTrade - AI 자동매매 시스템

## 개요

한국투자증권(KIS) Open API를 활용한 AI 자동매매 시스템입니다.

**아키텍처:**
- Trading Core: 주문 실행, 정책/리스크 엔진, KIS API 연동
- AI Brain: 전략 실행, Intent 생성, 로컬 LLM (Ollama) 연동
- Dashboard: 실시간 모니터링 및 제어

**패키지 매니저 정책:**
- 표준은 `pnpm` (workspace 기반)

## 프로젝트 구조

```
AutoTrade/
├── trading-core/           # Trading Core (주문 실행 엔진)
│   ├── src/
│   │   ├── domain/        # Domain models (TradeIntent, Order, OrderEvent)
│   │   ├── policy/         # Policy & Risk Engine, Budget Manager
│   │   ├── kis/            # KIS Gateway (REST API)
│   │   └── index.ts        # Express API 서버 + 대시보드
│   ├── jest.config.js
│   ├── package.json
│   └── tsconfig.json
│
├── ai-brain/              # AI Brain (전략 + Intent 생성 + LLM)
│   ├── src/
│   │   ├── strategies/     # 모멘텀/트렌드/리밸런싱 전략
│   │   ├── intent/        # Intent Generator
│   │   └── llm/          # Ollama (로컬 LLM) 연동
│   ├── jest.config.js
│   ├── package.json
│   └── tsconfig.json
│
├── dashboard/             # 대시보드 (단일 HTML)
│   └── index.html
│
├── infra/quadlet/        # Podman Quadlet 배포 파일
│   ├── tradebot.network
│   ├── tradebot-postgres.container
│   ├── tradebot-redis.container
│   ├── tradebot-trading-core.container
│   └── tradebot-ai-brain.container
│
└── config/               # 설정 파일
    ├── trading-core.env.example
    ├── ai-brain.env.example
    ├── policy-conservative.yaml
    ├── policy-neutral.yaml
    └── policy-aggressive.yaml
```

## 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | Node.js + TypeScript |
| Framework | Express |
| Database | PostgreSQL + TypeORM |
| Cache | Redis |
| Testing | Jest |
| LLM | Ollama (로컬) |
| Deployment | Podman (Quadlet) |

## 주요 기능

### Trading Core
- **KIS Gateway**: 토큰 관리, 레이트리밋 (20 req/s), 주문/취소/잔고 조회
- **Policy & Risk Engine**: 3가지 프리셋 (보수/중립/공격), 투자금리/위험 제한
- **Order State Machine**: 상태전이테이블, Reconciliation, 이벤트 로깅
- **Budget Manager**: AI 호출/비용/주문 횟수 제한, Kill Switch

### AI Brain
- **Strategies**: Momentum, Trend, Rebalancing 전략
- **Intent Generator**: 전략 시그널 → TradeIntent 변환
- **Ollama Integration**: 로컬 LLM을 활용한 분석/리포트 생성

### Dashboard
- Kill Switch 제어
- Budget 모니터링
- Open Positions 모니터링
- Recent Intents/Orders 확인
- Policy 프리셋 전환 (API 연동)
- KIS 모의계좌(VTS) 연결 테스트 실행/결과 확인
- Auto-refresh (5초)

## 실행 방법

### 1. 의존성 설치

```bash
# 권장 (pnpm 전환 완료 후)
pnpm install -r

# 현재 호환 방식
cd trading-core && npm install
cd ../ai-brain && npm install
```

### 2. 환경 설정

```bash
# 설정 파일 복사
cp config/trading-core.env.example trading-core/.env
cp config/ai-brain.env.example ai-brain/.env

# .env 파일 편집 (KIS API 키 입력)
# - trading-core/.env 에 POLICY_PRESET=neutral (기본) 설정 가능
# - 모의계좌 테스트 기능 사용 시 trading-core/.env 에 KIS_ENV=VTS 설정
```

### 3. 데이터베이스

PostgreSQL 실행 (Docker):
```bash
docker run -d \
  --name tradebot-postgres \
  -e POSTGRES_USER=tradebot \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=tradebot \
  -p 5432:5432 \
  postgres:16
```

### 4. 실행

```bash
# 권장 (pnpm 전환 완료 후)
pnpm --filter trading-core dev
pnpm --filter ai-brain dev

# 현재 호환 방식
cd trading-core && npm run dev
cd ../ai-brain && npm run dev
```

### 5. 대시보드 접근

```
http://localhost:8080
```

## 테스트 실행

```bash
# Trading Core
cd trading-core
npm test

# AI Brain
cd ai-brain
npm test
```

## 배포 (Podman Quadlet)

1. Quadlet 파일 복사:
```bash
mkdir -p ~/.config/containers/systemd
cp infra/quadlet/*.container ~/.config/containers/systemd/
cp infra/quadlet/*.network ~/.config/containers/systemd/
cp infra/quadlet/*.volume ~/.config/containers/systemd/
```

2. 서비스 활성화:
```bash
systemctl --user daemon-reload
systemctl --user start tradebot-postgres
systemctl --user start tradebot-redis
systemctl --user start tradebot-trading-core
systemctl --user start tradebot-ai-brain
```

## Policy 프리셋

| 프리셋 | 일일 손실 제한 | 최대 포지션 | 특징 |
|--------|--------------|------------|------|
| Conservative | 0.7% | 6개 | 무사고/생존 우선 |
| Neutral | 1.5% | 10개 | 일반 운영 (기본값) |
| Aggressive | 2.5% | 15개 | 실험/확장 |

## API 엔드포인트

### Trading Core (`:8080`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | / | 대시보드 |
| GET | /health | 헬스체크 |
| POST | /api/intents | TradeIntent 제출 |
| GET | /api/intents | Intent 목록 |
| GET | /api/intents/:id | Intent 상세 |
| GET | /api/orders | 주문 목록 |
| GET | /api/events | 이벤트 로그 |
| GET | /api/budget | Budget 상태 |
| GET | /api/policy | 현재 정책 프리셋 |
| GET | /api/kis/mock-test/status | KIS 모의계좌 테스트 상태 |
| POST | /api/killswitch/activate | Kill Switch 활성화 |
| POST | /api/killswitch/deactivate | Kill Switch 비활성화 |
| POST | /api/policy/preset | 정책 프리셋 전환 |
| POST | /api/kis/mock-test/run | KIS 모의계좌 테스트 실행 (VTS 전용) |

추가 규약:
- Trading Core 에러 응답은 `application/problem+json` 기반 (`message` 호환 필드 포함)
- `/api/intents`는 입력 유효성 검증 후 잘못된 요청에 `400`을 반환
- Policy 프리셋 전환 시 Risk + Budget 한도가 함께 동기화됨
- 목록 조회 API(`intents/orders/events/positions`)는 `?limit=` 지원, `intents/orders/events`는 `?cursor=`/`?since=`와 `X-Next-Cursor` 지원
- `GET /api/intents` 응답에는 거절 사유 요약 필드 `riskReasonCodes`가 포함될 수 있음
- `POST /api/kis/mock-test/run`은 `KIS_ENV=VTS`에서만 실행 가능하며 토큰/잔고 조회 기반의 안전한 읽기 테스트를 수행

### AI Brain (`:3001`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /health | 헬스체크 |
| GET | /api/status | AI Brain 상태 |
| POST | /api/ideas | 거래 아이디어 생성 |
| POST | /api/analyze | 시장 분석 |
| POST | /api/report | 일일 리포트 생성 |
| POST | /api/explain | 거래 결과 설명 |
| POST | /api/cycle | 전략 사이클 실행 |

## CI

- GitHub Actions: `.github/workflows/ci.yml`
- 트리거: `main` push, pull request
- 실행 항목: `pnpm install --frozen-lockfile` -> `pnpm build` -> `pnpm test`

## 개발 로드맵

- [x] 프로젝트 구조 설계
- [x] KIS API 연동
- [x] Policy & Risk Engine
- [x] Order State Machine
- [x] Budget Manager
- [x] AI Brain (전략 + LLM)
- [x] 대시보드
- [ ] 실제 거래 테스트 (모의투자)
- [ ] 백테스트 시스템
- [ ] 포트폴리오 관리 고도화

## 라이선스

MIT License
