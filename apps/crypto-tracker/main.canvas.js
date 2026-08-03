/**
 * @tinypanel
 * @name Crypto Tracker
 * @description Live Binance Futures price and candlestick chart
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 4
 * @wifiSleep true
 * @cpuMultiplier 0.5
 */
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1h';
const CANDLE_COUNT = 40;
const REFRESH_MS = 1000;
const REQUEST_TIMEOUT_MS = 4000;
const STALE_AFTER_MS = 5000;
const BINANCE_KLINES_API = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_TICKER_API = 'https://fapi.binance.com/fapi/v1/ticker/price';
const COLOR_THEME = 'balanced'; // 'balanced' | 'contrast'
// The position itself (side/entryPrice/marginUsd/leverage/quantity) comes
// from state.data.position - the server polls the account's largest open
// BTCUSDT position via a signed Binance request (see
// server/src/data/binancePositionData.js) and hands it in as a cached
// snapshot, since the sandboxed app context here has no crypto module to
// sign that request itself. feeRate isn't part of that API response, so it
// stays a local estimate.
const FEE_RATE = 0.01; // percent per fill; displayed fee includes entry + exit

const COLOR_THEMES = {
  balanced: {
    BG: '#0b0318', GRID: '#291747', ACCENT: '#d81b78',
    UP: '#20d9d2', DOWN: '#f04464', TEXT: '#ded7ed', MUTED: '#766b8c',
    WARNING: '#d69a32', CURRENT_UP: '#176b68', CURRENT_DOWN: '#70293b', TRADE_LINE: '#9b7629',
  },
  contrast: {
    BG: '#05000d', GRID: '#55308c', ACCENT: '#ff2085',
    UP: '#00ffff', DOWN: '#ff3048', TEXT: '#ffffff', MUTED: '#b8a9d1',
    WARNING: '#ffb000', CURRENT_UP: '#087f7f', CURRENT_DOWN: '#8f1d32', TRADE_LINE: '#ffc020',
  },
};

const market = {
  symbol: SYMBOL,
  interval: INTERVAL,
  status: 'loading',
  candles: [],
  price: null,
  error: null,
  updatedAt: null,
};
let fetching = false;
let nextRefreshAt = 0;

async function refreshMarket() {
  fetching = true;
  nextRefreshAt = Date.now() + REFRESH_MS;
  try {
    const query = new URLSearchParams({
      symbol: SYMBOL,
      interval: INTERVAL,
      limit: String(CANDLE_COUNT),
    });
    const requestOptions = { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    const [klinesResponse, tickerResponse] = await Promise.all([
      fetch(`${BINANCE_KLINES_API}?${query}`, requestOptions),
      fetch(`${BINANCE_TICKER_API}?symbol=${encodeURIComponent(SYMBOL)}`, requestOptions),
    ]);
    if (!klinesResponse.ok) throw new Error(`Binance klines HTTP ${klinesResponse.status}`);
    if (!tickerResponse.ok) throw new Error(`Binance ticker HTTP ${tickerResponse.status}`);
    const [payload, ticker] = await Promise.all([klinesResponse.json(), tickerResponse.json()]);
    const candles = payload.map((candle) => ({
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
    })).filter((candle) => Object.values(candle).every(Number.isFinite));
    if (!candles.length) throw new Error('Binance returned no valid candles');
    const currentPrice = Number(ticker.price);
    if (!Number.isFinite(currentPrice)) throw new Error('Binance returned an invalid ticker price');
    market.candles = candles;
    market.price = currentPrice;
    market.status = 'ready';
    market.updatedAt = new Date().toISOString();
    market.error = null;
  } catch (error) {
    market.status = market.candles.length ? 'stale' : 'error';
    market.error = error.message;
    console.error('Binance refresh failed:', error.message);
  } finally {
    fetching = false;
  }
}

function updateMarketInBackground() {
  if (!fetching && Date.now() >= nextRefreshAt) refreshMarket();
}

function render(ctx, state) {
  const {
    BG, GRID, ACCENT, UP, DOWN, TEXT, MUTED, WARNING, CURRENT_UP, CURRENT_DOWN, TRADE_LINE,
  } = COLOR_THEMES[COLOR_THEME] || COLOR_THEMES.balanced;
  const TOP_DIVIDER_Y = 12;
  const CHART_TOP = 14;
  const CHART_BOTTOM = 107;
  const BOTTOM_DIVIDER_Y = 109;

  ctx.clear(BG);
  ctx.strokeStyle = ACCENT;
  ctx.drawLine(0, TOP_DIVIDER_Y, 159, TOP_DIVIDER_Y);
  ctx.drawLine(0, BOTTOM_DIVIDER_Y, 159, BOTTOM_DIVIDER_Y);

  updateMarketInBackground();
  const data = market;
  if (!data || !data.candles || data.candles.length === 0) {
    ctx.drawText(data && data.status === 'error' ? 'DATA ERROR' : 'LOADING DATA', 4, 56, {
      color: data && data.status === 'error' ? DOWN : WARNING, scale: 2,
    });
    return;
  }

  const candles = data.candles;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const currentPrice = Number.isFinite(data.price) ? data.price : last.close;
  const percent = (currentPrice - first.open) / first.open * 100;
  const direction = percent >= 0 ? UP : DOWN;
  const price = `$${currentPrice.toFixed(currentPrice >= 1000 ? 1 : 3)}`;
  const percentText = `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  const percentX = 158 - percentText.length * 4;
  ctx.drawText(price, 2, 1, { color: direction, scale: 2 });
  ctx.drawText(percentText, percentX, 4, { color: direction });

  let low = candles[0].low;
  let high = candles[0].high;
  let lowIndex = 0;
  let highIndex = 0;
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (candle.low < low) {
      low = candle.low;
      lowIndex = index;
    }
    if (candle.high > high) {
      high = candle.high;
      highIndex = index;
    }
  }
  const visibleLow = low;
  const visibleHigh = high;
  const trade = state.data?.position || null;
  const tradeEnabled = Boolean(trade)
    && (trade.side === 'long' || trade.side === 'short')
    && Number.isFinite(trade.entryPrice) && trade.entryPrice > 0
    && Number.isFinite(trade.marginUsd) && trade.marginUsd > 0
    && Number.isFinite(trade.leverage) && trade.leverage >= 1
    && Number.isFinite(trade.quantity) && trade.quantity > 0;
  if (tradeEnabled) {
    low = Math.min(low, trade.entryPrice);
    high = Math.max(high, trade.entryPrice);
  }
  low = Math.min(low, currentPrice);
  high = Math.max(high, currentPrice);
  const GRID_STEP = 500;
  const axisLow = Math.floor(low / GRID_STEP) * GRID_STEP;
  let axisHigh = Math.ceil(high / GRID_STEP) * GRID_STEP;
  if (axisHigh === axisLow) axisHigh += GRID_STEP;
  const range = axisHigh - axisLow;
  const chartHeight = CHART_BOTTOM - CHART_TOP;
  const priceY = (value) => CHART_BOTTOM - Math.round((value - axisLow) / range * chartHeight);
  const gridLevels = [];
  ctx.strokeStyle = GRID;
  for (let level = axisLow; level <= axisHigh; level += GRID_STEP) {
    const y = priceY(level);
    ctx.drawLine(0, y, 159, y);
    gridLevels.push({ level, y });
  }
  const currentPriceY = priceY(currentPrice);
  ctx.strokeStyle = percent >= 0 ? CURRENT_UP : CURRENT_DOWN;
  ctx.drawLine(0, currentPriceY, 159, currentPriceY);
  if (tradeEnabled) {
    const entryY = priceY(trade.entryPrice);
    ctx.strokeStyle = TRADE_LINE;
    for (let x = 0; x < 160; x += 5) ctx.drawLine(x, entryY, Math.min(x + 2, 159), entryY);
  }

  for (const { level, y } of gridLevels) {
    const label = `$${level}`;
    const labelY = Math.max(CHART_TOP, Math.min(CHART_BOTTOM - 4, y - 2));
    ctx.drawText(label, 1, labelY, { color: GRID, background: BG });
  }

  const slot = 160 / candles.length;
  const availableBodyWidth = Math.max(1, Math.floor(slot) - 1);
  // An odd body width gives the 1 px wick a real center pixel.
  const bodyWidth = availableBodyWidth % 2 === 0
    ? Math.max(1, availableBodyWidth - 1)
    : availableBodyWidth;

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const color = candle.close >= candle.open ? UP : DOWN;
    const center = Math.floor(index * slot + slot / 2);
    const yHigh = priceY(candle.high);
    const yLow = priceY(candle.low);
    const yOpen = priceY(candle.open);
    const yClose = priceY(candle.close);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen) + 1);
    ctx.fillStyle = color;
    ctx.fillRect(center, yHigh, 1, Math.max(1, yLow - yHigh + 1));
    ctx.fillRect(center - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, bodyHeight);
  }

  function drawExtremeLabel(value, index, y, placeBelow) {
    const label = `$${value.toFixed(0)}`;
    const labelWidth = label.length * 4;
    const center = Math.floor(index * slot + slot / 2);
    const labelX = center + labelWidth + 3 <= 160
      ? center + 3
      : Math.max(0, center - labelWidth - 2);
    const preferredY = placeBelow ? y + 2 : y - 6;
    const labelY = Math.max(CHART_TOP, Math.min(CHART_BOTTOM - 4, preferredY));
    ctx.drawText(label, labelX, labelY, { color: MUTED, background: BG });
  }

  drawExtremeLabel(visibleHigh, highIndex, priceY(visibleHigh), false);
  drawExtremeLabel(visibleLow, lowIndex, priceY(visibleLow), true);

  ctx.drawText(`${data.symbol} ${data.interval}`, 2, 111, { color: TEXT });

  if (tradeEnabled) {
    const sideSign = trade.side === 'long' ? 1 : -1;
    const pnl = (currentPrice - trade.entryPrice) * trade.quantity * sideSign;
    const fee = trade.quantity * (trade.entryPrice + currentPrice) * (FEE_RATE / 100);
    const feeText = String(Number(fee.toFixed(2)));
    const tradeText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(1)}`;
    const tradeHeader = `$${trade.marginUsd.toFixed(2)} X${trade.leverage} F$${feeText}`;
    const afterPriceX = 2 + price.length * 8 + 4;
    const beforePercentX = percentX - tradeText.length * 4 - 4;
    ctx.drawText(tradeText, Math.min(afterPriceX, beforePercentX), 4, { color: pnl >= 0 ? UP : DOWN });
    ctx.drawText(tradeHeader, 46, 111, { color: TEXT });
  }

  const updatedAtMs = data.updatedAt ? Date.parse(data.updatedAt) : 0;
  const stale = data.status === 'stale' || !updatedAtMs || Date.now() - updatedAtMs > STALE_AFTER_MS;
  const status = stale ? 'STALE' : 'LIVE';
  const statusX = 160 - status.length * 4;
  ctx.drawText(status, statusX, 111, { color: stale ? WARNING : UP });

  const dateObj = new Date();
  const date = dateObj.toLocaleDateString('uk-UA');
  const time = dateObj.toLocaleTimeString('uk-UA');

  ctx.drawText(date, 2, 118, { color: MUTED, scale: 2 });
  const timeX = 161 - time.length * 8;
  ctx.drawText(time, timeX, 118, { color: MUTED, scale: 2 });
}
