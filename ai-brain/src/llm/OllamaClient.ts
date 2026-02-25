import axios from 'axios';

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama LLM Integration
 * 
 * Provides local LLM inference for:
 * - Strategy idea generation
 * - Market analysis
 * - Report generation
 * - Anomaly detection
 */
export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private availableModels: string[] = [];

  constructor(baseUrl: string = 'http://localhost:11434', defaultModel: string = 'llama2') {
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      this.availableModels = response.data.models?.map((m: OllamaModel) => m.name) || [];
      return true;
    } catch (error) {
      console.warn('Ollama not available:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    if (this.availableModels.length === 0) {
      await this.isAvailable();
    }
    return this.availableModels;
  }

  /**
   * Generate text completion
   */
  async generate(
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
    }
  ): Promise<string> {
    const request: OllamaGenerateRequest = {
      model: options?.model || this.defaultModel,
      prompt,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 256,
        stop: options?.stop,
      },
    };

    try {
      const response = await axios.post<OllamaGenerateResponse>(
        `${this.baseUrl}/api/generate`,
        request,
        { timeout: 60000 }
      );
      return response.data.response;
    } catch (error) {
      console.error('Ollama generate failed:', error);
      throw new Error(`Ollama generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze market data and generate insights
   */
  async analyzeMarket(prompt: string): Promise<string> {
    const systemPrompt = `You are an expert stock market analyst. 
Analyze the following market data and provide insights.
Focus on: price trends, volume patterns, support/resistance levels, and potential entry/exit points.
Be concise and actionable.`;

    return this.generate(`${systemPrompt}\n\n${prompt}`, {
      temperature: 0.5,
      maxTokens: 512,
    });
  }

  /**
   * Generate trading ideas
   */
  async generateTradingIdeas(context: string): Promise<string> {
    const prompt = `Based on the following market context, suggest potential trading ideas:

${context}

Provide a JSON array of trading ideas with:
- symbol
- entry price range
- target price
- stop loss
- rationale
- confidence (0-1)`;

    return this.generate(prompt, {
      temperature: 0.6,
      maxTokens: 1024,
    });
  }

  /**
   * Explain why a trade was rejected or why losses occurred
   */
  async explainOutcome(trade: any, outcome: any): Promise<string> {
    const prompt = `Analyze why the following trade resulted in the described outcome:

Trade: ${JSON.stringify(trade)}
Outcome: ${JSON.stringify(outcome)}

Provide a brief explanation in Korean.`;

    return this.generate(prompt, {
      temperature: 0.4,
      maxTokens: 256,
    });
  }

  /**
   * Generate daily report
   */
  async generateDailyReport(summary: any): Promise<string> {
    const prompt = `Generate a daily trading report in Korean:

${JSON.stringify(summary, null, 2)}

Include:
1. Today's performance summary
2. What went well
3. What could be improved
4. Tomorrow's outlook`;

    return this.generate(prompt, {
      temperature: 0.5,
      maxTokens: 512,
    });
  }
}
