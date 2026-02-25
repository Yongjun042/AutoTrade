# AutoTrade - AI 자동매매 시스템

## 개요

한국투자증권(KIS) Open API를 활용한 AI 자동매매 시스템입니다.

**아키텍처:**
- Trading Core: 주문 실행, 정책/리스크 엔진, KIS API 연동
- AI Brain: 전략 실행, Intent 생성, 로컬 LLM (Ollama) 연동
- Dashboard: 실시간 모니터링 및 제어

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
- Recent Intents/Orders 확인
- Policy 프리셋 전환
- Auto-refresh (5초)

## 실행 방법

### 1. 의존성 설치

```bash
# Trading Core
cd trading-core
npm install

# AI Brain
cd ../ai-brain
npm install
```

### 2. 환경 설정

```bash
# 설정 파일 복사
cp config/trading-core.env.example trading-core/.env
cp config/ai-brain.env.example ai-brain/.env

# .env 파일 편집 (KIS API 키 입력)
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
# Trading Core
cd trading-core
npm run dev

# AI Brain (다른 터미널)
cd ai-brain
npm run dev
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
| POST | /api/killswitch/activate | Kill Switch 활성화 |
| POST | /api/killswitch/deactivate | Kill Switch 비활성화 |

### AI Brain (`:3001`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /health | 헬스체크 |
| GET | /api/status | AI Brain 상태 |
| POST | /api/ideas | 거래 아이디어 생성 |
| POST | /api/analyze | 시장 분석 |
| POST | /api/report | 일일 리포트 생성 |
| POST | /api/cycle | 전략 사이클 실행 |

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
