'use strict';

class CryptoTrackerData {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  getSnapshot(settings = {}) {
    const symbol = String(settings.symbol || 'BTCUSDT').toUpperCase();
    const interval = String(settings.interval || '1h');
    const candleCount = Math.min(50, Math.max(5, Number(settings.candleCount) || 20));
    const pollMs = Math.max(1000, Number(settings.pollMs) || 5000);
    const key = `${symbol}:${interval}:${candleCount}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = { status: 'loading', candles: [], updatedAt: null, error: null, fetching: false, fetchedAt: 0 };
      this.cache.set(key, entry);
    }
    if (!entry.fetching && Date.now() - entry.fetchedAt >= pollMs) this._refresh(entry, { symbol, interval, candleCount });
    return {
      symbol, interval, status: entry.status, candles: entry.candles,
      updatedAt: entry.updatedAt, error: entry.error,
    };
  }

  async _refresh(entry, { symbol, interval, candleCount }) {
    entry.fetching = true;
    entry.fetchedAt = Date.now();
    try {
      const params = new URLSearchParams({ symbol, interval, limit: String(candleCount) });
      const response = await this.fetchImpl(`https://fapi.binance.com/fapi/v1/klines?${params}`);
      if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
      const payload = await response.json();
      entry.candles = payload.map((candle) => ({
        open: Number(candle[1]), high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]),
      })).filter((candle) => Object.values(candle).every(Number.isFinite));
      if (!entry.candles.length) throw new Error('Binance returned no valid candles');
      entry.status = 'ready';
      entry.updatedAt = new Date().toISOString();
      entry.error = null;
    } catch (error) {
      entry.status = entry.candles.length ? 'stale' : 'error';
      entry.error = error.message;
    } finally {
      entry.fetching = false;
    }
  }
}

module.exports = { CryptoTrackerData };
