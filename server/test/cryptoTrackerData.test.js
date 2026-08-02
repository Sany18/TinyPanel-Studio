'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CryptoTrackerData } = require('../src/data/cryptoTrackerData');

test('normalizes Binance klines into cached candle data', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [[0, '100', '120', '90', '110'], [0, '110', '125', '105', '122']],
  });
  const service = new CryptoTrackerData({ fetchImpl });
  const entry = { status: 'loading', candles: [], updatedAt: null, error: null, fetching: false, fetchedAt: 0 };
  await service._refresh(entry, { symbol: 'BTCUSDT', interval: '1h', candleCount: 20 });
  assert.equal(entry.status, 'ready');
  assert.deepEqual(entry.candles[1], { open: 110, high: 125, low: 105, close: 122 });
});

test('keeps previous candles as stale when a refresh fails', async () => {
  const service = new CryptoTrackerData({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  const entry = {
    status: 'ready', candles: [{ open: 1, high: 2, low: 1, close: 2 }],
    updatedAt: null, error: null, fetching: false, fetchedAt: 0,
  };
  await service._refresh(entry, { symbol: 'BTCUSDT', interval: '1h', candleCount: 20 });
  assert.equal(entry.status, 'stale');
  assert.match(entry.error, /429/);
  assert.equal(entry.candles.length, 1);
});
