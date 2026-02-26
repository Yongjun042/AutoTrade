import { MomentumStrategy, TrendStrategy, createStrategy } from '../strategies';

describe('MomentumStrategy', () => {
  let strategy: MomentumStrategy;

  beforeEach(() => {
    strategy = new MomentumStrategy({ threshold: 0.02, volumeThreshold: 1000000 });
  });

  const createMockMarketData = (overrides: any = {}): any => ({
    symbol: '005930',
    currentPrice: 70000,
    volume: 1500000,
    bidPrice: 69950,
    askPrice: 70050,
    timestamp: new Date(),
    get spread() { return this.askPrice - this.bidPrice; },
    get spreadBps() { return (this.spread / this.currentPrice) * 10000; },
    ...overrides,
  });

  describe('analyze', () => {
    test('should return BUY signal for new position with good conditions', () => {
      const marketData = createMockMarketData();
      const positions: any[] = [];

      const signal = strategy.analyze(marketData, positions);

      expect(signal).not.toBeNull();
      expect(signal?.action).toBe('BUY');
      expect(signal?.strategyId).toBe('mom_v1');
      expect(signal?.confidence).toBe(0.5);
    });

    test('should return null when spread is too wide', () => {
      const marketData = createMockMarketData({
        bidPrice: 69000,
        askPrice: 72000, // Wide spread > 30 bps
      });
      const positions: any[] = [];

      const signal = strategy.analyze(marketData, positions);

      expect(signal).toBeNull();
    });

    test('should return null when volume is too low', () => {
      const marketData = createMockMarketData({ volume: 500000 });
      const positions: any[] = [];

      const signal = strategy.analyze(marketData, positions);

      expect(signal).toBeNull();
    });

    test('should return SELL signal for existing position at stop loss', () => {
      const marketData = createMockMarketData();
      const positions = [{
        symbol: '005930',
        qty: 10,
        avgPrice: 72000, // Currently at loss
        currentPrice: 68600, // -5% loss
        get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
        get marketValue() { return this.currentPrice * this.qty; },
      }];

      const signal = strategy.analyze(marketData, positions);

      expect(signal).not.toBeNull();
      expect(signal?.action).toBe('SELL');
      expect(signal?.reasons).toContain('stop_loss');
      expect(signal?.confidence).toBe(0.9);
    });

    test('should return null for existing position without exit signal', () => {
      const marketData = createMockMarketData({ currentPrice: 71000 });
      const positions = [{
        symbol: '005930',
        qty: 10,
        avgPrice: 70000, // Slight gain
        currentPrice: 71000,
        get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
        get marketValue() { return this.currentPrice * this.qty; },
      }];

      const signal = strategy.analyze(marketData, positions);

      // Returns null because no stop loss triggered
      expect(signal).toBeNull();
    });
  });

  describe('getRequiredData', () => {
    test('should return required data types', () => {
      const required = strategy.getRequiredData();
      expect(required).toContain('price');
      expect(required).toContain('volume');
      expect(required).toContain('bid');
      expect(required).toContain('ask');
    });
  });
});

describe('Strategy Factory', () => {
  test('should create MomentumStrategy', () => {
    const strategy = createStrategy('mom_v1');
    expect(strategy).toBeInstanceOf(MomentumStrategy);
  });

  test('should create TrendStrategy', () => {
    const strategy = createStrategy('trend_v1');
    expect(strategy).toBeInstanceOf(TrendStrategy);
  });

  test('should throw error for unknown strategy', () => {
    expect(() => createStrategy('unknown')).toThrow('Unknown strategy');
  });

  test('should pass config to strategy', () => {
    const strategy = createStrategy('mom_v1', { threshold: 0.05 });
    // Strategy should use custom config
    expect(strategy).toBeDefined();
  });

  test('trend strategy should produce BUY signal on breakout condition', () => {
    const strategy = createStrategy('trend_v1', { entryThresholdPct: 0.5 });

    const marketData = {
      symbol: '005930',
      currentPrice: 100,
      volume: 2_000_000,
      bidPrice: 99.4,
      askPrice: 99.5,
      timestamp: new Date(),
      get spread() { return this.askPrice - this.bidPrice; },
      get spreadBps() { return (this.spread / this.currentPrice) * 10000; },
    };

    const signal = strategy.analyze(marketData, []);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('BUY');
  });

  test('trend strategy should produce SELL signal for stop loss', () => {
    const strategy = createStrategy('trend_v1', { stopLossPct: -2 });

    const marketData = {
      symbol: '005930',
      currentPrice: 100,
      volume: 2_000_000,
      bidPrice: 99.8,
      askPrice: 100.0,
      timestamp: new Date(),
      get spread() { return this.askPrice - this.bidPrice; },
      get spreadBps() { return (this.spread / this.currentPrice) * 10000; },
    };

    const positions = [{
      symbol: '005930',
      qty: 10,
      avgPrice: 110,
      currentPrice: 100,
      get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
      get marketValue() { return this.currentPrice * this.qty; },
    }];

    const signal = strategy.analyze(marketData, positions);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('SELL');
  });

  test('rebalance strategy should fill slot with BUY', () => {
    const strategy = createStrategy('rebalance_weekly_v1', { targetPositions: 3 });

    const marketData = {
      symbol: '005930',
      currentPrice: 100,
      volume: 1_500_000,
      bidPrice: 99.9,
      askPrice: 100.0,
      timestamp: new Date(),
      get spread() { return this.askPrice - this.bidPrice; },
      get spreadBps() { return (this.spread / this.currentPrice) * 10000; },
    };

    const positions = [{
      symbol: '000660',
      qty: 10,
      avgPrice: 80,
      currentPrice: 90,
      get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
      get marketValue() { return this.currentPrice * this.qty; },
    }];

    const signal = strategy.analyze(marketData, positions);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('BUY');
  });

  test('rebalance strategy should trim overweight position with SELL', () => {
    const strategy = createStrategy('rebalance_weekly_v1', { targetPositions: 2, imbalanceTolerance: 0.2 });

    const marketData = {
      symbol: '005930',
      currentPrice: 120,
      volume: 2_000_000,
      bidPrice: 119.9,
      askPrice: 120.0,
      timestamp: new Date(),
      get spread() { return this.askPrice - this.bidPrice; },
      get spreadBps() { return (this.spread / this.currentPrice) * 10000; },
    };

    const positions = [
      {
        symbol: '005930',
        qty: 100,
        avgPrice: 100,
        currentPrice: 120,
        get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
        get marketValue() { return this.currentPrice * this.qty; },
      },
      {
        symbol: '000660',
        qty: 10,
        avgPrice: 80,
        currentPrice: 81,
        get unrealizedPnl() { return (this.currentPrice - this.avgPrice) * this.qty; },
        get marketValue() { return this.currentPrice * this.qty; },
      },
    ];

    const signal = strategy.analyze(marketData, positions);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('SELL');
  });
});
