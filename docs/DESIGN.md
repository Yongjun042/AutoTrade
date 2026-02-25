# AutoTrade 상세 설계문서 (v0.2)

**작성일:** 2026-02-25  
**버전:** 0.2  
**상태:** 설계 완료

---

## 1. 개요

### 1.1 목표

한국투자증권(KIS) Open API를 활용하여 AI가 자동으로 주식을 매매하는 시스템 구축

### 1.2 핵심 원칙

1. **AI는 제안만, 실행은 Policy/Risk가 결정**
2. **Single-Writer**: KIS API 호출은 하나의 서비스만 담당
3. **Idempotency**: 중복 주문 방지
4. **Budget First**: AI 비용이 수익을 초과하지 않도록 관리

---

## 2. 아키텍처

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                     Windows Host PC                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Linux VM (Podman + Quadlet)             │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │  Postgres   │  │    Redis    │  │   Ollama   │ │   │
│  │  │  (Data)     │  │ (Rate Limit)│  │  (Local    │ │   │
│  │  └─────────────┘  └─────────────┘  │   LLM)     │ │   │
│  │                                        └────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │           Trading Core (Node.js)               │  │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │   │
│  │  │  │KIS Gateway│ │Policy/Risk│ │Order Manager │  │  │   │
│  │  │  └──────────┘ └──────────┘ └──────────────┘  │  │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │   │
│  │  │  │ Budget   │ │Dashboard  │ │Reconciliation│  │  │   │
│  │  │  │ Manager  │ │ (Static)  │ │  Scheduler   │  │  │   │
│  │  │  └──────────┘ └──────────┘ └──────────────┘  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │           AI Brain (Node.js)                   │  │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │   │
│  │  │  │Strategies│ │ Intent   │ │  Ollama      │  │  │   │
│  │  │  │          │ │Generator  │ │  Client      │  │  │   │
│  │  │  └──────────┘ └──────────┘ └──────────────┘  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
AI Brain                    Trading Core                    KIS API
   │                             │                              │
   │─── Intent (JSON) ──────────>│                              │
   │                             │                              │
   │                      Policy/Risk Evaluation               │
   │                      ┌───────────────┐                    │
   │                      │ APPROVE/REJECT│                    │
   │                      └───────────────┘                    │
   │                             │                              │
   │                      Order Creation                      │
   │                             │                              │
   │                             │─── REST API ───────────────>│
   │                             │                              │
   │                             │<── Order ID ───────────────│
   │                             │                              │
   │                    State Machine                         │
   │                    (DRAFT → SUBMITTED → ACKED → FILLED) │
```

---

## 3. KIS API 연동

### 3.1 제약사항

| 항목 | 제한 |
|------|------|
| REST 호출 (실전) | 1초당 20건 |
| REST 호출 (모의) | 1초당 2건 |
| 토큰 발급 | 1초당 1건 |
| WebSocket | 세션당 41개 구독 |
| 토큰 유효기간 | 24시간 |

### 3.2 레이트리밋 구현

```typescript
class RateLimiter {
  private permits: number;
  private refillRate: number; // 20 req/s

  async acquire(): Promise<void> {
    this.refillPermits();
    if (this.permits < 1) {
      throw new Error('KIS_RATE_LIMIT_EXCEEDED');
    }
    this.permits--;
  }
}
```

### 3.3 토큰 관리

- **발급**: 24시간 유효
- **갱신**: 6시간 이후 가능
- **전략**: 1시간 전强制 갱신

---

## 4. Policy & Risk Engine

### 4.1 3가지 프리셋

#### Conservative (보수)
```yaml
risk:
  max_gross_exposure_pct: 30
  max_position_pct_per_symbol: 5
  max_open_positions: 6
  max_orders_per_day: 10
  max_daily_loss_pct: 0.7
  max_drawdown_pct: 3.0
```

#### Neutral (중립)
```yaml
risk:
  max_gross_exposure_pct: 60
  max_position_pct_per_symbol: 10
  max_open_positions: 10
  max_orders_per_day: 40
  max_daily_loss_pct: 1.5
  max_drawdown_pct: 8.0
```

#### Aggressive (공격)
```yaml
risk:
  max_gross_exposure_pct: 85
  max_position_pct_per_symbol: 15
  max_open_positions: 15
  max_orders_per_day: 120
  max_daily_loss_pct: 2.5
  max_drawdown_pct: 12.0
```

### 4.2 거부 사유 코드

| 코드 | 설명 |
|------|------|
| RISK_SYMBOL_NOT_ALLOWED | 허용되지 않은 종목 |
| RISK_MAX_POSITIONS_EXCEEDED | 최대 포지션 초과 |
| RISK_MAX_POSITION_PCT_EXCEEDED | 종목별 비중 초과 |
| RISK_MAX_GROSS_EXPOSURE_EXCEEDED | 총 노출 초과 |
| RISK_CASH_BUFFER_INSUFFICIENT | 현금 버퍼 부족 |
| RISK_DAILY_LOSS_LIMIT_EXCEEDED | 일일 손실 한도 초과 |
| RISK_MAX_ORDERS_PER_DAY_EXCEEDED | 일일 주문 횟수 초과 |
| RISK_COOLDOWN_ACTIVE | 쿨다운 기간 |
| RISK_INTENT_EXPIRED | 인텐트 만료 |

---

## 5. 주문 상태머신

### 5.1 상태 다이어그램

```
                    ┌─────────────┐
                    │    DRAFT   │
                    └──────┬──────┘
                           │ EV_SUBMIT
                           v
                 ┌─────────────────┐
          ┌──────│ PENDING_SUBMIT  │──────┐
          │      └────────┬────────┘      │
          │               │                │
    EV_SUBMIT_SENT   EV_INTERNAL_ERROR    │
          │               │                │
          v               v                v
    ┌──────────┐   ┌──────────┐    ┌──────────┐
    │ SUBMITTED │   │  ERROR   │    │ REJECTED │
    └────┬─────┘   └──────────┘    └──────────┘
         │
    ┌────┴────┬─────────────┬────────────┐
    v         v             v            v
┌───────┐ ┌───────┐ ┌──────────┐ ┌──────────┐
│  ACK  │ │REJECT │ │  TIMEOUT │ │ NET_ERR │
└───┬───┘ └───┬───┘ └────┬─────┘ └────┬─────┘
    │         │          │            │
    v         v          v            v
┌───────┐ ┌───────┐ ┌──────────┐ ┌──────────┐
│ FILLED│ │       │ │ PENDING_ │ │          │
│       │ │       │ │ UNKNOWN  │ │          │
└───┬───┘ └───┬───┘ └────┬─────┘ └────┬─────┘
    │         │          │            │
    │         │    RECONCILE         │
    v         v          v            v
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ CANCEL  │ │  PARTIAL │ │   ACK    │ │ EXPIRED  │
│ REQUEST │ │   FILL   │ │  /FILL   │ │          │
└──────────┘ └────┬─────┘ └──────────┘ └──────────┘
                  │
                  v
            ┌──────────┐
            │  FILLED  │
            └──────────┘
```

### 5.2 상태 목록

| 상태 | 설명 |
|------|------|
| DRAFT | 주문 생성됨 (제출 전) |
| PENDING_SUBMIT | 제출 진행 중 |
| SUBMITTED | 브로커에 요청 전송 (ACK 미확정) |
| ACKED | 브로커 접수确认 |
| PARTIALLY_FILLED | 부분 체결 |
| FILLED | 전량 체결 |
| CANCEL_REQUESTED | 취소 요청 |
| CANCELLED | 취소 완료 |
| REJECTED | 브로커 거부 |
| EXPIRED | 만료 |
| ERROR | 내부 오류 |
| PENDING_UNKNOWN | 타임아웃/불확실 |

---

## 6. Budget Manager

### 6.1 관리 대상

| 항목 | 기본값 (Neutral) |
|------|-----------------|
| AI 호출 횟수/일 | 200회 |
| AI 비용/일 | 3,000원 |
| KIS REST 호출/일 | 20,000회 |
| 주문 횟수/일 | 40회 |

### 6.2 Kill Switch

 Budget 초과 시 자동 또는 수동으로 트리거:
- 모든新規 주문 차단
- 기존 주문은 유지

---

## 7. AI Brain

### 7.1 전략

#### Momentum Strategy (mom_v1)
- 1분/5분 단기 모멘텀
- 거래량 & 스프레드 필터
- 스톱로스 (-2%)

#### Trend Strategy (trend_v1)
- 일봉 기반 트렌드 팔로잉
- 이동평균 사용

#### Rebalance Strategy (rebalance_weekly_v1)
- 주 1회 리밸런싱

### 7.2 Intent 포맷

```json
{
  "strategy_id": "mom_v1",
  "symbol": "005930",
  "side": "BUY",
  "intent_qty": 10,
  "order_type": "LIMIT",
  "limit_price": 71200,
  "confidence": 0.62,
  "reasons": ["momentum", "volume=1500000"],
  "expires_at": "2026-02-25T11:05:00+09:00"
}
```

---

## 8. 배포

### 8.1 Podman Quadlet

| 파일 | 설명 |
|------|------|
| tradebot.network | 내부 브릿지 네트워크 |
| tradebot-postgres.container | PostgreSQL 16 |
| tradebot-redis.container | Redis 7 |
| tradebot-trading-core.container | Trading Core (8080) |
| tradebot-ai-brain.container | AI Brain (3001) |

### 8.2 환경 변수

**Trading Core:**
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
- REDIS_URL
- KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT_NO
- KIS_ENV (REAL/VTS)
- KILL_SWITCH_DEFAULT

**AI Brain:**
- TRADING_CORE_URL
- STRATEGY_ID
- OLLAMA_URL, OLLAMA_MODEL

---

## 9. API 엔드포인트

### Trading Core (:8080)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | / | 대시보드 |
| GET | /health | 헬스체크 |
| POST | /api/intents | TradeIntent 제출 |
| GET | /api/intents | Intent 목록 |
| GET | /api/orders | 주문 목록 |
| GET | /api/events | 이벤트 로그 |
| GET | /api/budget | Budget 상태 |
| POST | /api/killswitch/activate | Kill Switch 활성화 |
| POST | /api/killswitch/deactivate | Kill Switch 비활성화 |

### AI Brain (:3001)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /health | 헬스체크 |
| GET | /api/status | AI Brain 상태 |
| POST | /api/ideas | 거래 아이디어 생성 |
| POST | /api/analyze | 시장 분석 |
| POST | /api/report | 일일 리포트 생성 |

---

## 10. 보안

### 10.1 원칙

1. **격리**: 주문 권한은 Trading Core에만
2. **로컬 LLM**: Ollama는 localhost에서만 실행
3. **포트 최소화**: 외부 공개는 localhost만

### 10.2 체크리스트

- [ ] KIS API 키 암호화 저장
- [ ] Postgres 비밀번호 강화
- [ ] Redis 비밀번호 설정
- [ ] Ollama 외부 접근 차단
- [ ] 방화벽 규칙 적용

---

## 11. 테스트

### 11.1 단위 테스트

| 모듈 | 테스트 파일 |
|------|------------|
| Order State Machine | Order.test.ts |
| Policy Engine | PolicyRiskEngine.test.ts |
| Momentum Strategy | strategies/index.test.ts |

### 11.2 통합 테스트 시나리오

1. Intent 제출 → Policy 검증 → 주문 생성
2. 주문 상태전이 (DRAFT → FILLED)
3. Kill Switch 활성화 → 주문 차단
4. Budget 초과 → 주문 차단

---

## 12. 운영

### 12.1 모니터링

- 대시보드에서 실시간 확인
- Budget 소진 알림
- 주문 실패 알림
- Reconciliation 실패 알림

### 12.2 장애 대응

| 시나리오 | 조치 |
|----------|------|
| REST 429 오류 | 폴링 주기 증가, WS 전환 |
| 토큰 만료 | 강제 갱신 |
| WS 끊김 | 재연결 (지수 백오프) |
| 주문 불일치 | Reconciliation 강제 실행 |
| Ollama 응답 없음 | 로컬 폴백 or 거래 중단 |

---

## 13.今後のロードマップ

- [ ] 실제 거래 테스트 (모의투자)
- [ ] 백테스트 시스템 구축
- [ ] 더 많은 전략 추가
- [ ] ML 모델 통합
- [ ] 알림 시스템 (Slack/Discord)

---

## 14. 참고자료

- KIS Developers: https://www.kiwoom.com/
- Podman Quadlet: https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html
- Ollama: https://github.com/ollama/ollama
