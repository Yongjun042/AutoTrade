# AutoTrade 상세 설계문서 (v0.3)

**작성일:** 2026-02-26  
**버전:** 0.3  
**상태:** 보강 완료 (Node.js + Dashboard 제어 + pnpm 기준)

---

## 1. 문서 목적

본 문서는 한국투자증권(KIS) Open API 기반 자동매매 시스템의 구현 기준을 정의한다.

- 국내주식 자동매매를 목표로 한다.
- 런타임은 Node.js 기반 2서비스(`trading-core`, `ai-brain`)로 운영한다.
- 프론트 대시보드에서 운영자가 핵심 제어(Kill Switch 등)를 수행할 수 있어야 한다.
- 패키지 매니저는 `pnpm`을 표준으로 채택한다.

---

## 2. v0.3 강화 사항

v0.2 대비 이번 버전에서 강화한 내용은 다음과 같다.

1. **Node 중심 아키텍처 명시**: Trading Core/AI Brain 책임 경계 재정의
2. **대시보드 조작 플로우 명시**: Kill Switch, 상태 조회, 수동 사이클 트리거
3. **패키지 매니저 표준화**: `pnpm workspace` 도입 전략 추가
4. **운영 토폴로지 구체화**: Windows 호스트 + Linux VM + Podman/Quadlet 운영 모델
5. **실행 가드레일 강화**: Budget/Priority/Reconcile 중심 운영 규약 추가

---

## 3. 핵심 원칙

1. **AI는 제안만, 실행은 Core가 결정**
2. **Broker Single-Writer**: KIS API 호출/주문 실행은 `trading-core`만 수행
3. **Idempotency 우선**: 동일 Intent 중복 주문 금지
4. **Budget First**: AI 비용/호출량/주문량을 초과하면 자동 제한
5. **Fail Safe**: 불확실 상태(`PENDING_UNKNOWN`)는 Reconcile로만 해소
6. **UI는 통제 수단**: 대시보드는 관측 + 운영 제어, 실행 엔진 우회 금지

---

## 4. 상위 아키텍처

```text
Windows Host
└─ Linux VM (Podman + Quadlet)
   ├─ trading-core (Node.js/Express)
   │  ├─ KIS Gateway
   │  ├─ Policy/Risk Engine
   │  ├─ Budget Manager
   │  ├─ Order Manager + Reconcile
   │  └─ Static Dashboard Hosting
   ├─ ai-brain (Node.js/Express)
   │  ├─ Strategy Registry
   │  ├─ Intent Generator
   │  └─ Ollama/External LLM Client
   ├─ postgres (거래 상태/이벤트 저장)
   └─ redis (호출 제한/캐시/락)
```

---

## 5. 컴포넌트 책임

### 5.1 `trading-core`

- Intent 수신 및 정책 심사 (`/api/intents`)
- 주문 생성/브로커 제출/이벤트 기록
- Kill Switch 제어 (`/api/killswitch/:action`)
- 대시보드 API 제공 (`/api/budget`, `/api/orders`, `/api/events`, `/api/intents`)
- 정합성 회복(Reconcile) 대상 상태 관리

### 5.2 `ai-brain`

- 전략 계산 및 Intent 생성
- LLM 기반 보조 기능(아이디어/분석/리포트/설명)
- 수동 전략 사이클 실행 API (`/api/cycle`)

### 5.3 `dashboard`

- 거래 상태 시각화(최근 Intent/Order/Event)
- Kill Switch 수동 토글
- 정책 버튼/자동 새로고침 UI
- 운영자 중심 제어판 역할(거래 알고리즘 자체는 없음)

### 5.4 저장소

- `PostgreSQL`: Intent/Order/Event/상태 기록
- `Redis`: 레이트리밋/일일 카운터/분산 상태 캐시

---

## 6. KIS 제약사항 반영

### 6.1 외부 제약

- REST 호출: 실전 20 req/s, 모의 2 req/s
- 토큰 발급: 1 req/s
- WebSocket 등록: 세션당 41개
- 접근 토큰: 24시간 유효(주기적 갱신 필요)

### 6.2 설계 반영

- 글로벌 토큰버킷 레이트리미터를 `KisGateway`에 고정
- 호출 우선순위: 주문/체결 조회 > 리스크 필수 조회 > 일반 시세
- WS 구독은 `watchlist` 우선순위 기반으로 제한 슬롯 운영

---

## 7. API 계약 (Node/Express)

### 7.1 Trading Core (`:8080`)

| 메서드 | 경로 | 용도 | 상태 |
|--------|------|------|------|
| GET | `/` | 대시보드 정적 파일 | 구현됨 |
| GET | `/health` | 헬스체크 | 구현됨 |
| POST | `/api/intents` | Intent 접수/심사/주문 | 구현됨 |
| GET | `/api/intents` | 최근 Intent 목록 | 구현됨 |
| GET | `/api/intents/:intentId` | Intent 상세 | 구현됨 |
| GET | `/api/orders` | 최근 주문 목록 | 구현됨 |
| GET | `/api/events` | 주문 이벤트 로그 | 구현됨 |
| GET | `/api/budget` | 예산/킬스위치 상태 | 구현됨 |
| GET | `/api/policy` | 현재 정책 프리셋 조회 | 구현됨 |
| GET | `/api/kis/mock-test/status` | KIS 모의계좌 테스트 상태 조회 | 구현됨 |
| POST | `/api/killswitch/:action` | 수동 On/Off | 구현됨 |
| POST | `/api/policy/preset` | 정책 프리셋 전환 | 구현됨 |
| POST | `/api/kis/mock-test/run` | KIS 모의계좌 테스트 실행 (VTS 전용) | 구현됨 |

API 운영 규약:

- 에러 응답은 `application/problem+json` 형태(`type/title/status/detail/instance`)를 기본으로 하며 `message` 호환 필드를 포함한다.
- 목록 조회 API는 `limit` 쿼리를 지원하고, `intents/orders/events`는 `cursor`(과거 페이지) / `since`(최신 증분) 조회와 `X-Next-Cursor` 헤더를 지원한다.
- 대시보드 폴링 GET 응답은 `Cache-Control: no-store`를 기본으로 한다.
- `TradeIntent`는 거절 시 `riskReasonCodes`를 저장해 대시보드에서 사유를 표시할 수 있어야 한다.
- KIS 모의계좌 테스트는 토큰/잔고 조회 기반의 read-only 검사로 제한하고, `KIS_ENV=VTS`에서만 실행한다.

### 7.2 AI Brain (`:3001`)

| 메서드 | 경로 | 용도 | 상태 |
|--------|------|------|------|
| GET | `/health` | 헬스체크 | 구현됨 |
| GET | `/api/status` | AI 런타임 상태 | 구현됨 |
| POST | `/api/ideas` | 아이디어 생성 | 구현됨 |
| POST | `/api/analyze` | 시장 분석 | 구현됨 |
| POST | `/api/report` | 일일 리포트 | 구현됨 |
| POST | `/api/explain` | 트레이드 결과 설명 | 구현됨 |
| POST | `/api/cycle` | 수동 전략 실행 | 구현됨 |

---

## 8. 대시보드 제어 설계

### 8.1 현재 제어 기능

- Kill Switch 토글 (실제 API 연동)
- 예산/Intent/주문/이벤트 모니터링
- 포지션 모니터링 (`/api/positions`)
- 5초 주기 자동 갱신
- 정책 프리셋 버튼 -> `/api/policy/preset` 연동
- KIS 모의계좌 테스트 카드 -> `/api/kis/mock-test/status`, `/api/kis/mock-test/run` 연동

### 8.2 보강 대상

- 전략 프로파일 전환 UI 추가
  - `ai-brain`의 실행 전략을 운영자가 선택 가능하도록 확장

### 8.3 권한 및 안전장치

- 운영 제어 API는 인증/인가 계층 도입 전까지 내부망으로 제한
- 고위험 제어(프리셋 전환/전략 변경)는 감사 로그 필수

---

## 9. Policy/Risk/Budget 설계

### 9.1 정책 프리셋

`conservative`, `neutral`, `aggressive` 3개 프리셋을 유지한다.

- `conservative`: 초기 실거래/안정화
- `neutral`: 기본 운영
- `aggressive`: 제한적 실험

### 9.2 거부 코드

거부 사유는 명시적 코드(`RISK_*`)로 반환한다.

예:

- `RISK_SYMBOL_NOT_ALLOWED`
- `RISK_MAX_GROSS_EXPOSURE_EXCEEDED`
- `RISK_MAX_ORDERS_PER_DAY_EXCEEDED`
- `RISK_COOLDOWN_ACTIVE`
- `RISK_INTENT_EXPIRED`

### 9.3 예산 제어

일 단위 관리 항목:

- AI 호출 횟수
- AI 비용 추정치
- KIS REST 호출량
- 주문 횟수

예산 초과 정책:

- 신규 주문 차단
- 필요 시 자동 Kill Switch 활성화
- 운영 알림 이벤트 생성

---

## 10. 주문 상태머신 및 Reconcile

### 10.1 상태

`DRAFT -> PENDING_SUBMIT -> SUBMITTED -> ACKED -> PARTIALLY_FILLED -> FILLED`

보조 상태:

- `CANCEL_REQUESTED`, `CANCELLED`
- `REJECTED`, `EXPIRED`
- `ERROR`, `PENDING_UNKNOWN`

### 10.2 핵심 규칙

- 타임아웃 시 즉시 재주문하지 않고 `PENDING_UNKNOWN`으로 전환
- Reconcile이 브로커 상태 조회 후 최종 상태를 확정
- 모든 상태 전이는 `order_event`에 기록

### 10.3 Reconcile 스케줄

- 장중: 5~15초 주기
- 장외: 60초 이상 완화
- 우선순위: `SUBMITTED`, `PENDING_UNKNOWN`, `CANCEL_REQUESTED`, `ERROR`

---

## 11. AI 운용 전략 (로컬 + 서버 혼합)

### 11.1 이중 역할 분리

1. **Runtime Decision AI**
   - 정형 입력 기반 Intent 생성
   - 저지연/재현성/비용통제 우선

2. **Ops/Research AI**
   - 리포트/원인분석/전략 실험 제안
   - 고빈도 주문 경로와 분리

### 11.2 모델 배치

- 로컬 모델(Ollama)은 기본적으로 내부망/로컬 바인딩
- 외부 추론 서버 사용 시 네트워크 장애 대비 fallback 정책 필요

### 11.3 AI 출력 계약

AI 출력은 자유 텍스트가 아니라 `TradeIntent` JSON으로 제한한다.

필수 필드:

- `strategy_id`, `symbol`, `side`, `intent_qty`
- `order_preference`, `confidence`, `reasons`, `expires_at`

---

## 12. 배포/운영 표준 (Linux VM + Podman Quadlet)

### 12.1 기본 운영 형태

- Windows 개인 PC 위 Linux VM 1대로 시작
- VM 내부에서 rootless Podman + Quadlet 사용
- 컨테이너: `trading-core`, `ai-brain`, `postgres`, `redis`

### 12.2 Quadlet 표준 유닛

- `.network`: `tradebot.network`
- `.volume`: `pgdata.volume`, `redisdata.volume`
- `.container`: `tradebot-postgres`, `tradebot-redis`, `tradebot-trading-core`, `tradebot-ai-brain`

### 12.3 운영 원칙

- 서비스 자동기동: 각 유닛의 `[Install]` 설정 사용
- 내부 통신은 브리지 네트워크 alias 기반
- 외부 공개 포트 최소화(필요 시 localhost 바인딩)
- 민감정보는 env 파일/secret으로 분리

### 12.4 Podman/Quadlet 하드닝 체크리스트

- Linux VM 내부에서 rootless 사용자 계정으로 서비스 운영
- rootless Quadlet 경로(`~/.config/containers/systemd/`)를 단일 표준으로 유지
- Quadlet 수정 후 `systemctl --user daemon-reload`를 표준 절차로 적용
- 재부팅 자동기동이 필요하면 user linger 설정을 운영 체크리스트에 포함
- 컨테이너 이미지는 short name 대신 fully-qualified image 사용
- Podman API는 Unix socket 기본값 유지, TCP 노출은 상호 TLS 없으면 금지
- 공개 포트는 1024 이상 고포트 우선, 필요 시 호스트 레벨 포워딩 사용
- 컨테이너 보안 옵션(`NoNewPrivileges`, capability drop, read-only rootfs) 기본 적용 검토

---

## 13. 패키지 매니저 표준: pnpm

### 13.1 채택 이유

- 멀티 서비스 의존성 관리 단순화
- lockfile 일원화 및 재현성 강화
- 디스크 사용량/설치 속도 개선

### 13.2 목표 구조

루트에 `pnpm-workspace.yaml`을 두고 아래 패키지를 워크스페이스로 관리한다.

```yaml
packages:
  - "trading-core"
  - "ai-brain"
```

도입 시 표준 규칙:

- `corepack use pnpm@<version>`으로 저장소 단위 버전 고정
- 루트 `package.json`의 `packageManager` 필드로 pnpm 버전 명시
- 내부 패키지 의존성은 `workspace:` 프로토콜 우선 사용

### 13.3 운영 명령 표준

```bash
# 전체 설치
pnpm install -r

# 서비스별 실행
pnpm --filter trading-core dev
pnpm --filter ai-brain dev

# 빌드/테스트
pnpm --filter trading-core build
pnpm --filter trading-core test
pnpm --filter ai-brain build
```

### 13.4 마이그레이션 체크

1. 루트 workspace 파일/공통 스크립트 유지 관리
2. 기존 lockfile에서 `pnpm import`로 전환 후 `pnpm-lock.yaml` 단일화
3. CI 설치를 `pnpm install --frozen-lockfile` 기준으로 고정
4. 실수 방지를 위해 `preinstall`에 `only-allow pnpm` 적용 검토
5. npm-only 문구를 README/운영문서에서 제거

---

## 14. 운영 런북 (요약)

### 14.0 로컬 개발 실행/종료

- `.env` 파일은 `trading-core/.env`, `ai-brain/.env`에 배치하고 서비스 시작 시 로드한다.
- 로컬 실행 최소 요건은 PostgreSQL 1개이며 Redis는 선택 사항이다.
- 기본 실행 포트는 `trading-core:8080`, `ai-brain:3001`이다.
- 포트 충돌 시 `PORT=18080 pnpm --filter trading-core dev`처럼 우회하고, `TRADING_CORE_URL`도 동일 포트로 동기화한다.
- 종료 시 서비스 프로세스를 먼저 중단하고(`Ctrl + C`), 이후 `docker stop tradebot-postgres`로 DB를 정리한다.

### 14.1 장 시작 전

- 토큰 상태 확인
- DB/Redis 헬스체크
- Kill Switch 기본값 확인
- 정책/전략 버전 확인

### 14.2 장중 모니터링

- 주문 성공률, ACK 지연, 거부율
- KIS 429/WS 연결 상태
- 일손실/노출도/예산 소진률

### 14.3 장애 대응

- 429 급증: 시세성 호출 축소, 주문성 호출 우선
- 토큰 실패: 재발급 1회 후 실패 시 자동중단
- 상태 불일치: Reconcile 강제, 불일치 지속 시 Kill Switch

---

## 15. 단계별 구현 계획

### Phase 1: 실행 안전성 확보

- TokenManager + RateLimiter + Kill Switch
- 상태머신 + 이벤트 로깅 + Reconcile

### Phase 2: 대시보드 제어 고도화

- 정책 프리셋 전환 API 연결
- 전략 프로파일 전환 UI/API 연결

### Phase 3: AI 운영 고도화

- Runtime AI 성능/비용 튜닝
- Ops AI 리포트 자동화

---

## 16. 오픈 이슈

1. Reconcile 스케줄러의 실동작 구현 범위 확정 필요
2. Trend/Rebalance 전략의 실거래 검증(신호 품질/빈도 튜닝) 필요
3. `pnpm` 운영 온보딩(개발자 로컬 Corepack/권한 이슈 대응) 문서 보강 필요
