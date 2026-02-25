import express, { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import 'reflect-metadata';

import { TradeIntent, TradeIntentSide, TradeIntentOrderType, TradeIntentStatus } from './domain/TradeIntent';
import { Order, OrderState } from './domain/Order';
import { OrderEvent, OrderEventType } from './domain/OrderEvent';
import { KisGateway } from './kis/KisGateway';
import { PolicyRiskEngine } from './policy/PolicyRiskEngine';
import { BudgetManager } from './policy/BudgetManager';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

const app = express();
app.use(express.json());

// Serve dashboard static files
app.use(express.static(path.join(__dirname, '../../dashboard')));

// Serve dashboard at root
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

// Database connection (will be initialized)
import { BudgetManager } from './policy/BudgetManager';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// Database connection (will be initialized)
let dataSource: DataSource;

// Services
let kisGateway: KisGateway | null = null;
let policyEngine: PolicyRiskEngine;
let budgetManager: BudgetManager;

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
    url: string;
  };
  kis: {
    appKey: string;
    appSecret: string;
    accountNo: string;
    env: 'REAL' | 'VTS';
    restRps: number;
  };
  killSwitchDefault: boolean;
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

/**
 * Submit TradeIntent from AI Brain
 */
app.post('/api/intents', async (req: Request, res: Response) => {
  try {
    const body: IntentRequest = req.body;
    console.log(`Received intent: strategy=${body.strategyId}, symbol=${body.symbol}, side=${body.side}, qty=${body.intentQty}`);

    // 1. Check kill switch
    if (budgetManager.isKillSwitchActive()) {
      return res.status(503).json({
        success: false,
        message: 'Kill switch is active',
      } as IntentResponse);
    }

    // 2. Check idempotency
    const idempotencyKey = body.idempotencyKey || uuidv4();
    const existingIntent = await dataSource.getRepository(TradeIntent).findOne({
      where: { idempotencyKey },
    });
    if (existingIntent) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate intent',
      } as IntentResponse);
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
    });

    await intentRepo.save(intent);

    // 4. Budget check
    if (!budgetManager.canMakeAiCall()) {
      intent.status = TradeIntentStatus.REJECTED;
      await intentRepo.save(intent);
      return res.status(503).json({
        success: false,
        message: 'AI budget exceeded',
        intentId: intent.intentId,
      } as IntentResponse);
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
      await intentRepo.save(intent);

      return res.json({
        success: false,
        message: `Rejected: ${decision.message}`,
        intentId: intent.intentId,
        reasonCodes: decision.reasonCodes,
      } as IntentResponse);
    }

    // 7
    if (!budgetManager.canPlaceOrder()) {
      intent.status = TradeIntentStatus.REJECTED;
      await intentRepo.save(intent);
      return res.status(503).json({
        success: false,
        message: 'Order budget exceeded',
        intentId: intent.intentId,
      } as IntentResponse);
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
      if (kisGateway) {
        const brokerOrderId = await kisGateway.placeOrder(
          order.symbol,
          order.side as 'BUY' | 'SELL',
          order.qty,
          order.price,
          order.orderType as 'LIMIT' | 'MARKET'
        );
        order.brokerOrderId = brokerOrderId;
        order.state = OrderState.SUBMITTED;
        order.submittedAt = new Date();
        await orderRepo.save(order);

        await logOrderEvent(order.orderId, OrderEventType.SUBMIT_SENT, OrderState.DRAFT, OrderState.SUBMITTED, 'Sent to broker');
      }
    } catch (error) {
      order.state = OrderState.ERROR;
      await orderRepo.save(order);
      await logOrderEvent(order.orderId, OrderEventType.INTERNAL_ERROR, null, OrderState.ERROR, String(error));
      throw error;
    }

    await budgetManager.recordOrder();

    intent.status = TradeIntentStatus.CONVERTED_TO_ORDER;
    await intentRepo.save(intent);

    return res.json({
      success: true,
      message: 'Order created',
      intentId: intent.intentId,
      orderId: order.orderId,
    } as IntentResponse);

  } catch (error) {
    console.error('Failed to process intent', error);
    return res.status(500).json({
      success: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    } as IntentResponse);
  }
});

/**
 * Get intent status
 */
app.get('/api/intents/:intentId', async (req: Request, res: Response) => {
  const intentId = parseInt(req.params.intentId);
  const intent = await dataSource.getRepository(TradeIntent).findOne({
    where: { intentId },
  });

  if (!intent) {
    return res.status(404).json({ error: 'Intent not found' });
  }

  return res.json(intent);
});

/**
 * Get budget status
 */
app.get('/api/budget', (req: Request, res: Response) => {
  return res.json(budgetManager.getStatus());
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
  return res.status(400).json({ error: 'Invalid action' });
});

/**
 * Get all intents (for dashboard)
 */
app.get('/api/intents', async (req: Request, res: Response) => {
  const intents = await dataSource.getRepository(TradeIntent).find({
    order: { createdAt: 'DESC' },
    take: 50,
  });
  return res.json(intents);
});

/**
 * Get all orders (for dashboard)
 */
app.get('/api/orders', async (req: Request, res: Response) => {
  const orders = await dataSource.getRepository(Order).find({
    order: { createdAt: 'DESC' },
    take: 50,
  });
  return res.json(orders);
});

/**
 * Get order events (for dashboard)
 */
app.get('/api/events', async (req: Request, res: Response) => {
  const events = await dataSource.getRepository(OrderEvent).find({
    order: { timestamp: 'DESC' },
    take: 100,
  });
  return res.json(events);
});

/**
 * Get positions (for dashboard)
 */
app.get('/api/positions', async (req: Request, res: Response) => {
  // Simplified - would query actual positions
  return res.json([]);
});

/**
 * Health check
 */
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
  policyEngine = new PolicyRiskEngine('neutral');

  // Initialize Budget Manager
  budgetManager = new BudgetManager(config.redis.url || null);

  // Apply kill switch default
  if (config.killSwitchDefault) {
    budgetManager.activateKillSwitch('Default (startup)');
  }

  console.log('Application initialized');
}

// ==================== Start Server ====================

async function start(): Promise<void> {
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
