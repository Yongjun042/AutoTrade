import express, { Request, Response } from 'express';
import { createStrategy, BaseStrategy, MarketData, Position } from './strategies';
import { OllamaClient } from './llm/OllamaClient';
import { IntentGenerator } from './intent/IntentGenerator';

const app = express();
app.use(express.json());

app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Configuration
const config = {
  tradingCoreUrl: process.env.TRADING_CORE_URL || 'http://localhost:8080',
  strategyId: process.env.STRATEGY_ID || 'mom_v1',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama2',
};

// Services
let intentGenerator: IntentGenerator;
let ollamaClient: OllamaClient;

interface ApiError {
  success: false;
  message: string;
}

function badRequest(res: Response, message: string): Response<ApiError> {
  return res.status(400).json({
    success: false,
    message,
  });
}

function serverError(res: Response, error: unknown): Response<ApiError> {
  return res.status(500).json({
    success: false,
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// ==================== API Endpoints ====================

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Get AI Brain status
 */
app.get('/api/status', async (req: Request, res: Response) => {
  const ollamaAvailable = await ollamaClient.isAvailable();
  
  res.json({
    strategyId: config.strategyId,
    ollamaAvailable,
    ollamaModels: ollamaAvailable ? await ollamaClient.listModels() : [],
  });
});

/**
 * Generate trading ideas using LLM
 */
app.post('/api/ideas', async (req: Request, res: Response) => {
  try {
    const { context } = req.body;
    if (!isNonEmptyString(context)) {
      return badRequest(res, 'context is required');
    }

    const ideas = await ollamaClient.generateTradingIdeas(context);
    res.json({ ideas });
  } catch (error) {
    return serverError(res, error);
  }
});

/**
 * Analyze market with LLM
 */
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!isNonEmptyString(prompt)) {
      return badRequest(res, 'prompt is required');
    }

    const analysis = await ollamaClient.analyzeMarket(prompt);
    res.json({ analysis });
  } catch (error) {
    return serverError(res, error);
  }
});

/**
 * Generate daily report
 */
app.post('/api/report', async (req: Request, res: Response) => {
  try {
    const { summary } = req.body;
    if (!isNonEmptyString(summary)) {
      return badRequest(res, 'summary is required');
    }

    const report = await ollamaClient.generateDailyReport(summary);
    res.json({ report });
  } catch (error) {
    return serverError(res, error);
  }
});

/**
 * Explain trade outcome
 */
app.post('/api/explain', async (req: Request, res: Response) => {
  try {
    const { trade, outcome } = req.body;
    if (trade === undefined || outcome === undefined) {
      return badRequest(res, 'trade and outcome are required');
    }

    const explanation = await ollamaClient.explainOutcome(trade, outcome);
    res.json({ explanation });
  } catch (error) {
    return serverError(res, error);
  }
});

/**
 * Trigger strategy cycle manually
 */
app.post('/api/cycle', async (req: Request, res: Response) => {
  try {
    const { symbol, currentPrice, volume, bidPrice, askPrice } = req.body;

    if (!isNonEmptyString(symbol)) {
      return badRequest(res, 'symbol is required');
    }

    if (!isPositiveNumber(currentPrice) || !isPositiveNumber(volume) || !isPositiveNumber(bidPrice) || !isPositiveNumber(askPrice)) {
      return badRequest(res, 'currentPrice, volume, bidPrice, askPrice must be positive numbers');
    }

    if (askPrice < bidPrice) {
      return badRequest(res, 'askPrice must be greater than or equal to bidPrice');
    }
    
    const marketData: MarketData = {
      symbol,
      currentPrice,
      volume,
      bidPrice,
      askPrice,
      timestamp: new Date(),
      get spread() { return this.askPrice - this.bidPrice; },
      get spreadBps() { 
        return this.currentPrice > 0 
          ? (this.spread / this.currentPrice) * 10000 
          : 0; 
      },
    };

    const positions: Position[] = [];
    
    await intentGenerator.runCycle(marketData, positions);
    
    res.json({ success: true, message: 'Strategy cycle executed' });
  } catch (error) {
    return serverError(res, error);
  }
});

// ==================== Initialization ====================

async function initialize(): Promise<void> {
  console.log('Initializing AI Brain...');

  // Initialize Intent Generator
  intentGenerator = new IntentGenerator(
    config.tradingCoreUrl,
    config.strategyId
  );

  // Initialize Ollama Client
  ollamaClient = new OllamaClient(config.ollamaUrl, config.ollamaModel);
  
  // Check Ollama availability
  const available = await ollamaClient.isAvailable();
  if (available) {
    console.log('Ollama is available');
    const models = await ollamaClient.listModels();
    console.log(`Available models: ${models.join(', ')}`);
  } else {
    console.warn('Ollama not available - LLM features disabled');
  }

  console.log('AI Brain initialized');
}

async function start(): Promise<void> {
  await initialize();

  const port = parseInt(process.env.PORT || '3001');
  app.listen(port, () => {
    console.log(`AI Brain API running on port ${port}`);
  });
}

// Export for testing
export { app, initialize };

// Start if run directly
if (require.main === module) {
  start().catch(console.error);
}
