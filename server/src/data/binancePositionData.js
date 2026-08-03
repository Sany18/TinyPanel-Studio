'use strict';

const crypto = require('crypto');
const fs = require('fs');

const POSITION_RISK_URL = 'https://fapi.binance.com/fapi/v2/positionRisk';

// secrets.h uses the same "#define NAME "value"" shape as the firmware's
// WiFi secrets.h (see firmware/display-client/secrets.h.example) - reused
// here rather than inventing a second secrets format for one app.
function loadCredentials(secretsPath) {
  if (!fs.existsSync(secretsPath)) return null;
  const text = fs.readFileSync(secretsPath, 'utf8');
  const apiKey = text.match(/#define\s+API_KEY\s+"([^"]*)"/)?.[1];
  const apiSecret = text.match(/#define\s+SECRET\s+"([^"]*)"/)?.[1];
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

// Polls the account's open Binance Futures positions and picks the largest
// (by notional) one, so a Canvas app's dataProvider (see liveApp.js) can
// read it as a plain cached snapshot - signing the request needs Node's
// crypto module, which the sandboxed vm context apps run in deliberately
// does not have access to (see liveApp.js's compile()), so this has to live
// server-side rather than in the app source itself.
class BinancePositionData {
  constructor({
    secretsPath, symbol = null, pollMs = 5000, fetchImpl = globalThis.fetch,
  } = {}) {
    this.credentials = loadCredentials(secretsPath);
    this.symbol = symbol;
    this.pollMs = pollMs;
    this.fetchImpl = fetchImpl;
    this.fetching = false;
    this.fetchedAt = 0;
    this.snapshot = {
      status: this.credentials ? 'loading' : 'disabled',
      position: null,
      updatedAt: null,
      error: this.credentials ? null : 'apps/crypto-tracker/secrets.h not found',
    };
  }

  getSnapshot() {
    if (this.credentials && !this.fetching && Date.now() - this.fetchedAt >= this.pollMs) this._refresh();
    return this.snapshot;
  }

  async _refresh() {
    this.fetching = true;
    this.fetchedAt = Date.now();
    try {
      const query = `timestamp=${Date.now()}&recvWindow=5000`;
      const signature = crypto.createHmac('sha256', this.credentials.apiSecret).update(query).digest('hex');
      const response = await this.fetchImpl(`${POSITION_RISK_URL}?${query}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Binance HTTP ${response.status}: ${await response.text()}`);
      const positions = await response.json();
      const open = positions
        .filter((position) => (this.symbol ? position.symbol === this.symbol : true))
        .map((position) => ({ ...position, positionAmt: Number(position.positionAmt) }))
        .filter((position) => position.positionAmt !== 0);
      const largest = open.sort(
        (a, b) => Math.abs(Number(b.notional)) - Math.abs(Number(a.notional)),
      )[0] || null;
      this.snapshot = {
        status: 'ready', position: largest ? toTrade(largest) : null, updatedAt: new Date().toISOString(), error: null,
      };
    } catch (error) {
      this.snapshot = {
        ...this.snapshot, status: this.snapshot.position ? 'stale' : 'error', error: error.message,
      };
    } finally {
      this.fetching = false;
    }
  }
}

function toTrade(position) {
  const leverage = Number(position.leverage) || 1;
  const notional = Math.abs(Number(position.notional));
  const isolated = position.marginType ? position.marginType === 'isolated' : Boolean(position.isolated);
  // isolatedWallet is the margin actually allocated to the position (what
  // Binance's UI shows in its "Margin" column); isolatedMargin also folds in
  // unrealized PnL and drifts away from that as the position moves.
  const isolatedWallet = Number(position.isolatedWallet);
  return {
    symbol: position.symbol,
    side: position.positionAmt > 0 ? 'long' : 'short',
    entryPrice: Number(position.entryPrice),
    quantity: Math.abs(position.positionAmt),
    leverage,
    marginUsd: isolated && Number.isFinite(isolatedWallet) && isolatedWallet > 0
      ? isolatedWallet
      : notional / leverage,
  };
}

module.exports = { BinancePositionData };
