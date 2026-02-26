import express, { Express, Request, Response } from 'express';
import { DataSource, LessThan, MoreThan } from 'typeorm';
import 'reflect-metadata';
import * as path from 'path';

import { TradeIntent, TradeIntentSide, TradeIntentOrderType, TradeIntentStatus } from './domain/TradeIntent';
import { Order, OrderState } from './domain/Order';
import { OrderEvent, OrderEventType } from './domain/OrderEvent';
import { KisGateway } from './kis/KisGateway';
import { PolicyRiskEngine } from './policy/PolicyRiskEngine';
import { PolicyPresets } from './policy/PolicyConfig';
import { BudgetManager } from './policy/BudgetManager';
import { v4 as uuidv4 } from 'uuid';

const POLICY_PRESET_NAMES = ['conservative', 'neutral', 'aggressive'] as const;
type PolicyPreset = (typeof POLICY_PRESET_NAMES)[number];

const app: Express = express();
app.use(express.json());

app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Serve dashboard static files
app.use(express.static(path.join(__dirname, '../../dashboard')));

// Serve dashboard at root
app.get('/', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

// Database connection (will be initialized)
let dataSource: DataSource;

// Services
let kisGateway: KisGateway | null = null;
let policyEngine: PolicyRiskEngine;
let budgetManager: BudgetManager;
let activePolicyPreset: PolicyPreset = 'neutral';
type KisMockTestResult = Awaited<ReturnType<KisGateway['runMockAccountTest']>>;
let lastKisMockTestResult: KisMockTestResult | null = null;

// ==================== Configuration ====================

interface AppConfig {
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  redis: {
    url: string | null;
  };
  kis: {
    appKey: string;
    appSecret: string;
    accountNo: string;
    env: 'REAL' | 'VTS';
    restRps: number;
  };
  killSwitchDefault: boolean;
  policyPresetDefault: PolicyPreset;
}

function isPolicyPreset(value: unknown): value is PolicyPreset {
  return typeof value === 'string' && POLICY_PRESET_NAMES.includes(value as PolicyPreset);
}

// ==================== Intent API ====================

interface IntentRequest {
  idempotencyKey?: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  intentQty: number;
  orderType?: 'LIMIT' | 'MARKET';
  limitPrice?: number;
  timeInForceSec?: number;
  confidence?: number;
  reasons?: string;
  expiresAt?: string;
}

interface IntentResponse {
  success: boolean;
  message: string;
  intentId?: number;
  orderId?: number;
  reasonCodes?: string[];
}

interface PolicyPresetRequest {
  preset?: string;
}

interface PositionView {
  symbol: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  success: false;
  message: string;
  code?: string;
  reasonCodes?: string[];
}

interface QueryIntParseResult {
  value?: number;
  error?: string;
}

interface KisMockTestStatusResponse {
  configured: boolean;
  env: 'REAL' | 'VTS' | null;
  accountNoMasked: string | null;
  canRun: boolean;
  kisCallsUsed: number;
  kisCallsLimit: number;
  lastResult: KisMockTestResult | null;
}

function problemResponse(
  req: Request,
  res: Response,
  status: number,
  title: string,
  detail: string,
  code?: string,
  reasonCodes?: string[]
): Response<ProblemDetails> {
  const problem: ProblemDetails = {
    type: code ? `https://autotrade.local/problems/${code}` : 'about:blank',
    title,
    status,
    detail,
    instance: req.originalUrl,
    success: false,
    message: detail,
    code,
    reasonCodes,
  };

  res.type('application/problem+json');
  return res.status(status).json(problem);
}

function parseQueryLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return defaultLimit;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(parsed, maxLimit);
}

function parsePositiveQueryInt(value: unknown, field: string): QueryIntParseResult {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === undefined || raw === null || raw === '') {
    return {};
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${field} must be a positive integer` };
  }

  return { value: parsed };
}

function getKisMockTestStatus(): KisMockTestStatusResponse {
  const budgetStatus = budgetManager.getStatus();

  if (!kisGateway) {
    return {
      configured: false,
      env: null,
      accountNoMasked: null,
      canRun: false,
      kisCallsUsed: budgetStatus.kisCalls,
      kisCallsLimit: budgetStatus.kisCallsLimit,
      lastResult: lastKisMockTestResult,
    };
  }

  const env = kisGateway.getEnvironment();

  return {
    configured: true,
    env,
    accountNoMasked: kisGateway.getAccountNoMasked(),
    canRun: env === 'VTS',
    kisCallsUsed: budgetStatus.kisCalls,
    kisCallsLimit: budgetStatus.kisCallsLimit,
    lastResult: lastKisMockTestResult,
  };
}

function parseEnumValue<T extends string>(value: string | undefined, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function validateIntentRequest(body: IntentRequest): string | null {
  if (!body || typeof body !== 'object') {
    return 'Invalid payload';
  }

  if (!body.strategyId || !body.strategyId.trim()) {
    return 'strategyId is required';
  }

  if (!body.symbol || !body.symbol.trim()) {
    return 'symbol is required';
  }

  if (!parseEnumValue(body.side, ['BUY', 'SELL'] as const)) {
    return 'side must be BUY or SELL';
  }

  if (!Number.isFinite(body.intentQty) || body.intentQty <= 0) {
    return 'intentQty must be a positive number';
  }

  if (body.orderType && !parseEnumValue(body.orderType, ['LIMIT', 'MARKET'] as const)) {
    return 'orderType must be LIMIT or MARKET';
  }

  const normalizedOrderType = body.orderType || 'LIMIT';

  if (normalizedOrderType === 'LIMIT' && (!Number.isFinite(body.limitPrice) || (body.limitPrice ?? 0) <= 0)) {
    return 'limitPrice must be provided and positive for LIMIT orders';
  }

  if (body.limitPrice !== undefined && (!Number.isFinite(body.limitPrice) || body.limitPrice <= 0)) {
    return 'limitPrice must be a positive number';
  }

  if (body.timeInForceSec !== undefined && (!Number.isFinite(body.timeInForceSec) || body.timeInForceSec <= 0)) {
    return 'timeInForceSec must be a positive number';
  }

  if (body.expiresAt) {
    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return 'expiresAt must be a valid ISO date string';
    }
  }

  return null;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const directCode = (error as { code?: string }).code;
  if (directCode === '23505') {
    return true;
  }

  const driverError = (error as { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}

function applyPolicyPreset(preset: PolicyPreset): void {
  const policy = PolicyPresets[preset]();
  policyEngine.setPolicy(policy);
  budgetManager.setBudget(policy.budget);
  activePolicyPreset = preset;
}

function buildPositionsFromOrders(orders: Order[]): PositionView[] {
  const positions = new Map<string, { qty: number; totalCost: number; currentPrice: number }>();

  for (const order of orders) {
    const fillQty = order.filledQty > 0 ? order.filledQty : (order.state === OrderState.FILLED ? order.qty : 0);
    const fillPrice = order.price ?? 0;

    if (fillQty <= 0 || fillPrice <= 0) {
      continue;
    }

    const snapshot = positions.get(order.symbol) || { qty: 0, totalCost: 0, currentPrice: fillPrice };
    snapshot.currentPrice = fillPrice;

    if (order.side === TradeIntentSide.BUY) {
      snapshot.qty += fillQty;
      snapshot.totalCost += fillQty * fillPrice;
    } else {
      const sellQty = Math.min(snapshot.qty, fillQty);
      const avgCost = snapshot.qty > 0 ? snapshot.totalCost / snapshot.qty : 0;
      snapshot.qty -= sellQty;
      snapshot.totalCost -= avgCost * sellQty;

      if (snapshot.qty <= 0) {
        snapshot.qty = 0;
        snapshot.totalCost = 0;
      }
    }

    positions.set(order.symbol, snapshot);
  }

  const rows: PositionView[] = [];
  for (const [symbol, snapshot] of positions.entries()) {
    if (snapshot.qty <= 0) {
      continue;
    }

    const avgPrice = snapshot.totalCost / snapshot.qty;
    const currentPrice = snapshot.currentPrice > 0 ? snapshot.currentPrice : avgPrice;
    const marketValue = snapshot.qty * currentPrice;
    const unrealizedPnl = (currentPrice - avgPrice) * snapshot.qty;

    rows.push({
      symbol,
      qty: snapshot.qty,
      avgPrice,
      currentPrice,
      marketValue,
      unrealizedPnl,
    });
  }

  return rows.sort((a, b) => b.marketValue - a.marketValue);
}

function parseRiskReasonCodes(raw?: string): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Keep compatibility fallback below
  }

  return raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function toIntentView(intent: TradeIntent): object {
  return {
    ...intent,
    riskReasonCodes: parseRiskReasonCodes(intent.riskReasonCodes),
  };
}

/**
 * Submit TradeIntent from AI Brain
 */
app.post('/api/intents', async (req: Request, res: Response) => {
  try {
    const body: IntentRequest = req.body;

    const validationError = validateIntentRequest(body);
    if (validationError) {
      return problemResponse(req, res, 400, 'Invalid intent payload', validationError, 'invalid-intent-payload');
    }

    console.log(`Received intent: strategy=${body.strategyId}, symbol=${body.symbol}, side=${body.side}, qty=${body.intentQty}`);

    // 1. Check kill switch
    if (budgetManager.isKillSwitchActive()) {
      return problemResponse(req, res, 503, 'Trading halted', 'Kill switch is active', 'kill-switch-active');
    }

    // 2. Check idempotency
    const idempotencyKey = body.idempotencyKey || uuidv4();
    const existingIntent = await dataSource.getRepository(TradeIntent).findOne({
      where: { idempotencyKey },
    });
    if (existingIntent) {
      return problemResponse(req, res, 409, 'Duplicate intent', 'Duplicate intent', 'duplicate-intent');
    }

    // 3. Create TradeIntent
    const intentRepo = dataSource.getRepository(TradeIntent);
    const intent = intentRepo.create({
      idempotencyKey,
      strategyId: body.strategyId,
      symbol: body.symbol,
      side: TradeIntentSide[body.side],
      intentQty: body.intentQty,
      orderType: body.orderType ? TradeIntentOrderType[body.orderType] : TradeIntentOrderType.LIMIT,
      limitPrice: body.limitPrice || null,
      timeInForceSec: body.timeInForceSec || 120,
      confidence: body.confidence || null,
      reasons: body.reasons || null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      status: TradeIntentStatus.PENDING,
    } as Partial<TradeIntent>);

    await intentRepo.save(intent);

    // 4. Budget check
    if (!budgetManager.canMakeAiCall()) {
      intent.status = TradeIntentStatus.REJECTED;
      intent.riskReasonCodes = JSON.stringify(['BUDGET_AI_EXCEEDED']);
      await intentRepo.save(intent);
      return problemResponse(req, res, 503, 'Budget exceeded', 'AI budget exceeded', 'ai-budget-exceeded');
    }

    // 5. Record AI call
    const estimatedCost = estimateAiCallCost(body.confidence);
    await budgetManager.recordAiCall(estimatedCost);

    // 6. Policy & Risk evaluation
    // Simplified portfolio state - in production, query actual portfolio
    const portfolio = {
      totalEquity: 10_000_000,
      cash: 5_000_000,
      marketValue: 5_000_000,
      dailyPnl: 0,
      ordersToday: budgetManager.getStatus().orders,
      positions: [],
    };

    const decision = policyEngine.evaluate(intent, portfolio, 0);

    if (decision.isRejected) {
      intent.status = TradeIntentStatus.REJECTED;
      intent.riskReasonCodes = JSON.stringify(decision.reasonCodes);
      await intentRepo.save(intent);

      return problemResponse(
        req,
        res,
        422,
        'Intent rejected by risk policy',
        `Rejected: ${decision.message}`,
        'risk-rejected',
        decision.reasonCodes
      );
    }

    // 7
    if (!budgetManager.canPlaceOrder()) {
      intent.status = TradeIntentStatus.REJECTED;
      intent.riskReasonCodes = JSON.stringify(['BUDGET_ORDER_EXCEEDED']);
      await intentRepo.save(intent);
      return problemResponse(req, res, 503, 'Budget exceeded', 'Order budget exceeded', 'order-budget-exceeded');
    }

    if (!kisGateway) {
      intent.status = TradeIntentStatus.REJECTED;
      intent.riskReasonCodes = JSON.stringify(['BROKER_UNAVAILABLE']);
      await intentRepo.save(intent);
      return problemResponse(req, res, 503, 'Broker unavailable', 'Broker gateway not configured', 'broker-not-configured');
    }

    // 8. Create and submit order
    const orderRepo = dataSource.getRepository(Order);
    const order = orderRepo.create({
      intentId: intent.intentId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.intentQty,
      price: intent.limitPrice,
      orderType: intent.orderType!,
      state: OrderState.DRAFT,
      idempotencyKey: intent.idempotencyKey,
    });

    await orderRepo.save(order);

    // Log event
    await logOrderEvent(order.orderId, OrderEventType.SUBMIT, null, OrderState.DRAFT, 'Order created');

    // Submit to broker
    try {
      const gateway = kisGateway;
      if (!gateway) {
        throw new Error('Broker gateway not configured');
      }

      if (!budgetManager.canMakeKisCall()) {
        order.state = OrderState.REJECTED;
        order.rejectReason = 'KIS call budget exceeded';
        await orderRepo.save(order);
        await logOrderEvent(order.orderId, OrderEventType.BROKER_REJECT, OrderState.DRAFT, OrderState.REJECTED, 'KIS call budget exceeded');

        intent.status = TradeIntentStatus.REJECTED;
        intent.riskReasonCodes = JSON.stringify(['BUDGET_KIS_CALLS_EXCEEDED']);
        await intentRepo.save(intent);
        return problemResponse(req, res, 503, 'Budget exceeded', 'KIS call budget exceeded', 'kis-budget-exceeded');
      }

      await budgetManager.recordKisCall();

      const brokerOrderId = await gateway.placeOrder(
        order.symbol,
        order.side as 'BUY' | 'SELL',
        order.qty,
        order.price ?? null,
        order.orderType as 'LIMIT' | 'MARKET'
      );
      order.brokerOrderId = brokerOrderId;
      order.state = OrderState.SUBMITTED;
      order.submittedAt = new Date();
      await orderRepo.save(order);

      await logOrderEvent(order.orderId, OrderEventType.SUBMIT_SENT, OrderState.DRAFT, OrderState.SUBMITTED, 'Sent to broker');
    } catch (error) {
      order.state = OrderState.ERROR;
      await orderRepo.save(order);
      await logOrderEvent(order.orderId, OrderEventType.INTERNAL_ERROR, null, OrderState.ERROR, String(error));
      throw error;
    }

    await budgetManager.recordOrder();

    intent.status = TradeIntentStatus.CONVERTED_TO_ORDER;
    intent.riskReasonCodes = undefined;
    await intentRepo.save(intent);

    return res.json({
      success: true,
      message: 'Order created',
      intentId: intent.intentId,
      orderId: order.orderId,
    } as IntentResponse);

  } catch (error) {
    if (isUniqueViolation(error)) {
      return problemResponse(req, res, 409, 'Duplicate intent', 'Duplicate intent', 'duplicate-intent');
    }

    console.error('Failed to process intent', error);
    return problemResponse(
      req,
      res,
      500,
      'Intent processing failed',
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'intent-processing-failed'
    );
  }
});

/**
 * Get intent status
 */
app.get('/api/intents/:intentId', async (req: Request, res: Response) => {
  const intentId = Number.parseInt(req.params.intentId, 10);
  if (!Number.isFinite(intentId) || intentId <= 0) {
    return problemResponse(req, res, 400, 'Invalid intent id', 'intentId must be a positive number', 'invalid-intent-id');
  }

  const intent = await dataSource.getRepository(TradeIntent).findOne({
    where: { intentId },
  });

  if (!intent) {
    return problemResponse(req, res, 404, 'Intent not found', 'Intent not found', 'intent-not-found');
  }

  return res.json(toIntentView(intent));
});

/**
 * Get budget status
 */
app.get('/api/budget', (req: Request, res: Response) => {
  return res.json({
    ...budgetManager.getStatus(),
    policyPreset: activePolicyPreset,
  });
});

/**
 * Get current policy preset
 */
app.get('/api/policy', (req: Request, res: Response) => {
  return res.json({
    preset: activePolicyPreset,
  });
});

/**
 * Set current policy preset
 */
app.post('/api/policy/preset', (req: Request, res: Response) => {
  const { preset } = req.body as PolicyPresetRequest;

  if (!isPolicyPreset(preset)) {
    return problemResponse(
      req,
      res,
      400,
      'Invalid policy preset',
      'Invalid preset. Use conservative, neutral, or aggressive.',
      'invalid-policy-preset'
    );
  }

  applyPolicyPreset(preset);

  return res.json({
    success: true,
    message: `Policy preset changed to ${preset}`,
    preset,
  });
});

/**
 * Kill switch controls
 */
app.post('/api/killswitch/:action', (req: Request, res: Response) => {
  const action = req.params.action;
  if (action === 'activate') {
    budgetManager.activateKillSwitch(req.body.reason || 'Manual');
    return res.json({ success: true, message: 'Kill switch activated' });
  } else if (action === 'deactivate') {
    budgetManager.deactivateKillSwitch();
    return res.json({ success: true, message: 'Kill switch deactivated' });
  }
  return problemResponse(req, res, 400, 'Invalid kill switch action', 'Invalid action', 'invalid-killswitch-action');
});

/**
 * Get all intents (for dashboard)
 */
app.get('/api/intents', async (req: Request, res: Response) => {
  const limit = parseQueryLimit(req.query.limit, 50, 200);
  const cursor = parsePositiveQueryInt(req.query.cursor, 'cursor');
  const since = parsePositiveQueryInt(req.query.since, 'since');

  if (cursor.error) {
    return problemResponse(req, res, 400, 'Invalid query', cursor.error, 'invalid-query');
  }
  if (since.error) {
    return problemResponse(req, res, 400, 'Invalid query', since.error, 'invalid-query');
  }
  if (cursor.value && since.value) {
    return problemResponse(req, res, 400, 'Invalid query', 'Use either cursor or since, not both', 'invalid-query');
  }

  const where = since.value
    ? { intentId: MoreThan(since.value) }
    : cursor.value
      ? { intentId: LessThan(cursor.value) }
      : undefined;
  const order = since.value ? { intentId: 'ASC' as const } : { intentId: 'DESC' as const };

  const intents = await dataSource.getRepository(TradeIntent).find({
    where,
    order,
    take: limit,
  });

  if (intents.length > 0) {
    const lastIntent = intents[intents.length - 1];
    res.setHeader('X-Next-Cursor', lastIntent.intentId.toString());
  }

  return res.json(intents.map(toIntentView));
});

/**
 * Get all orders (for dashboard)
 */
app.get('/api/orders', async (req: Request, res: Response) => {
  const limit = parseQueryLimit(req.query.limit, 50, 200);
  const cursor = parsePositiveQueryInt(req.query.cursor, 'cursor');
  const since = parsePositiveQueryInt(req.query.since, 'since');

  if (cursor.error) {
    return problemResponse(req, res, 400, 'Invalid query', cursor.error, 'invalid-query');
  }
  if (since.error) {
    return problemResponse(req, res, 400, 'Invalid query', since.error, 'invalid-query');
  }
  if (cursor.value && since.value) {
    return problemResponse(req, res, 400, 'Invalid query', 'Use either cursor or since, not both', 'invalid-query');
  }

  const where = since.value
    ? { orderId: MoreThan(since.value) }
    : cursor.value
      ? { orderId: LessThan(cursor.value) }
      : undefined;
  const order = since.value ? { orderId: 'ASC' as const } : { orderId: 'DESC' as const };

  const orders = await dataSource.getRepository(Order).find({
    where,
    order,
    take: limit,
  });

  if (orders.length > 0) {
    res.setHeader('X-Next-Cursor', orders[orders.length - 1].orderId.toString());
  }

  return res.json(orders);
});

/**
 * Get order events (for dashboard)
 */
app.get('/api/events', async (req: Request, res: Response) => {
  const limit = parseQueryLimit(req.query.limit, 100, 300);
  const cursor = parsePositiveQueryInt(req.query.cursor, 'cursor');
  const since = parsePositiveQueryInt(req.query.since, 'since');

  if (cursor.error) {
    return problemResponse(req, res, 400, 'Invalid query', cursor.error, 'invalid-query');
  }
  if (since.error) {
    return problemResponse(req, res, 400, 'Invalid query', since.error, 'invalid-query');
  }
  if (cursor.value && since.value) {
    return problemResponse(req, res, 400, 'Invalid query', 'Use either cursor or since, not both', 'invalid-query');
  }

  const where = since.value
    ? { eventId: MoreThan(since.value) }
    : cursor.value
      ? { eventId: LessThan(cursor.value) }
      : undefined;
  const order = since.value ? { eventId: 'ASC' as const } : { eventId: 'DESC' as const };

  const events = await dataSource.getRepository(OrderEvent).find({
    where,
    order,
    take: limit,
  });

  if (events.length > 0) {
    res.setHeader('X-Next-Cursor', events[events.length - 1].eventId.toString());
  }

  return res.json(events);
});

/**
 * Get positions (for dashboard)
 */
app.get('/api/positions', async (req: Request, res: Response) => {
  const limit = parseQueryLimit(req.query.limit, 50, 200);

  const filledStates = [OrderState.FILLED, OrderState.PARTIALLY_FILLED];
  const orders = await dataSource.getRepository(Order).find({
    where: filledStates.map((state) => ({ state })),
    order: { createdAt: 'ASC' },
  });

  return res.json(buildPositionsFromOrders(orders).slice(0, limit));
});

/**
 * Get KIS mock-account test status
 */
app.get('/api/kis/mock-test/status', (req: Request, res: Response) => {
  return res.json(getKisMockTestStatus());
});

/**
 * Run KIS mock-account test (VTS only)
 */
app.post('/api/kis/mock-test/run', async (req: Request, res: Response) => {
  try {
    if (!kisGateway) {
      return problemResponse(req, res, 503, 'Broker unavailable', 'KIS gateway not configured', 'broker-not-configured');
    }

    const env = kisGateway.getEnvironment();
    if (env !== 'VTS') {
      return problemResponse(req, res, 400, 'Invalid environment', 'Set KIS_ENV=VTS to run mock-account test', 'invalid-kis-env');
    }

    const budgetStatus = budgetManager.getStatus();
    if (budgetStatus.kisCalls >= budgetStatus.kisCallsLimit) {
      return problemResponse(req, res, 503, 'Budget exceeded', 'KIS call budget exceeded', 'kis-budget-exceeded');
    }

    await budgetManager.recordKisCall();
    const result = await kisGateway.runMockAccountTest();
    lastKisMockTestResult = result;

    return res.json(result);
  } catch (error) {
    return problemResponse(
      req,
      res,
      500,
      'Mock account test failed',
      error instanceof Error ? error.message : 'Unknown error',
      'mock-test-failed'
    );
  }
});

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== Helper Functions ====================

async function logOrderEvent(
  orderId: number,
  eventType: OrderEventType,
  fromState: OrderState | null,
  toState: OrderState,
  payload: string
): Promise<void> {
  const eventRepo = dataSource.getRepository(OrderEvent);
  const event = eventRepo.create({
    orderId,
    eventType,
    fromState: fromState || undefined,
    toState,
    payload,
  });
  await eventRepo.save(event);
}

function estimateAiCallCost(confidence?: number): number {
  if (!confidence) return 100;
  if (confidence > 0.8) return 200;
  if (confidence > 0.6) return 150;
  return 100;
}

// ==================== Initialization ====================

async function initializeApp(config: AppConfig): Promise<void> {
  // Initialize TypeORM
  dataSource = new DataSource({
    type: 'postgres',
    host: config.db.host,
    port: config.db.port,
    username: config.db.username,
    password: config.db.password,
    database: config.db.database,
    synchronize: true, // For development; use migrations in production
    logging: false,
    entities: [TradeIntent, Order, OrderEvent],
  });

  await dataSource.initialize();
  console.log('Database connected');

  // Initialize KIS Gateway
  if (config.kis.appKey && config.kis.appSecret && config.kis.accountNo) {
    kisGateway = new KisGateway({
      appKey: config.kis.appKey,
      appSecret: config.kis.appSecret,
      accountNo: config.kis.accountNo,
      env: config.kis.env,
      restRps: config.kis.restRps,
    });
    console.log('KIS Gateway initialized');
  }

  // Initialize Policy Engine
  activePolicyPreset = config.policyPresetDefault;
  policyEngine = new PolicyRiskEngine(activePolicyPreset);

  // Initialize Budget Manager
  budgetManager = new BudgetManager(config.redis.url || null);

  // Sync budget limits with active policy preset
  applyPolicyPreset(activePolicyPreset);

  // Apply kill switch default
  if (config.killSwitchDefault) {
    budgetManager.activateKillSwitch('Default (startup)');
  }

  console.log('Application initialized');
}

// ==================== Start Server ====================

async function start(): Promise<void> {
  const envPolicyPreset = process.env.POLICY_PRESET || 'neutral';
  const policyPresetDefault: PolicyPreset = isPolicyPreset(envPolicyPreset) ? envPolicyPreset : 'neutral';

  if (!isPolicyPreset(envPolicyPreset)) {
    console.warn(`Invalid POLICY_PRESET='${envPolicyPreset}', fallback to 'neutral'`);
  }

  // Load config from environment
  const config: AppConfig = {
    port: parseInt(process.env.PORT || '8080'),
    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'tradebot',
      password: process.env.DB_PASSWORD || 'tradebot',
      database: process.env.DB_NAME || 'tradebot',
    },
    redis: {
      url: process.env.REDIS_URL || null,
    },
    kis: {
      appKey: process.env.KIS_APP_KEY || '',
      appSecret: process.env.KIS_APP_SECRET || '',
      accountNo: process.env.KIS_ACCOUNT_NO || '',
      env: (process.env.KIS_ENV as 'REAL' | 'VTS') || 'REAL',
      restRps: parseInt(process.env.KIS_REST_RPS || '20'),
    },
    killSwitchDefault: process.env.KILL_SWITCH_DEFAULT !== 'false',
    policyPresetDefault,
  };

  await initializeApp(config);

  app.listen(config.port, () => {
    console.log(`Trading Core API running on port ${config.port}`);
  });
}

// Export for testing
export { app, initializeApp, dataSource };

// Start if run directly
if (require.main === module) {
  start().catch(console.error);
}
