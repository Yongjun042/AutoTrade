import express, { Request, Response } from 'express';
import { createStrategy, BaseStrategy, MarketData, Position } from './strategies';
import { OllamaClient } from './llm/OllamaClient';
import { IntentGenerator } from './intent/IntentGenerator';

const app = express();
app.use(express.json());

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
    const ideas = await ollamaClient.generateTradingIdeas(context);
    res.json({ ideas });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

/**
 * Analyze market with LLM
 */
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    const analysis = await ollamaClient.analyzeMarket(prompt);
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

/**
 * Generate daily report
 */
app.post('/api/report', async (req: Request, res: Response) => {
  try {
    const { summary } = req.body;
    const report = await ollamaClient.generateDailyReport(summary);
    res.json({ report });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

/**
 * Explain trade outcome
 */
app.post('/api/explain', async (req: Request, res: Response) => {
  try {
    const { trade, outcome } = req.body;
    const explanation = await ollamaClient.explainOutcome(trade, outcome);
    res.json({ explanation });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

/**
 * Trigger strategy cycle manually
 */
app.post('/api/cycle', async (req: Request, res: Response) => {
  try {
    const { symbol, currentPrice, volume, bidPrice, askPrice } = req.body;
    
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
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
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
