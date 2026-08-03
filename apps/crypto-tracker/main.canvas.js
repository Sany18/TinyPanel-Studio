/**
 * @tinypanel
 * @name Crypto Tracker
 * @description Live Binance Futures price and candlestick chart
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 1
 * @wifiSleep true
 * @cpuMultiplier 0.5
 */
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1h';
const CANDLE_COUNT = 40;
const REFRESH_MS = 1000;
const BINANCE_API = 'https://fapi.binance.com/fapi/v1/klines';

const market = {
  symbol: SYMBOL,
  interval: INTERVAL,
  status: 'loading',
  candles: [],
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
    const response = await fetch(`${BINANCE_API}?${query}`);
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
    const payload = await response.json();
    const candles = payload.map((candle) => ({
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
    })).filter((candle) => Object.values(candle).every(Number.isFinite));
    if (!candles.length) throw new Error('Binance returned no valid candles');
    market.candles = candles;
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
  const BG = '#100020';
  const GRID = '#301860';
  const MAGENTA = '#ff207d';
  const CYAN = '#00ffff';
  const RED = '#ff2020';
  const GREEN = '#00ff40';
  const CURRENT_UP = '#176b3a';
  const CURRENT_DOWN = '#743039';
  const EXTREME_LABEL = '#7f899d';
  const TOP_DIVIDER_Y = 12;
  const CHART_TOP = 14;
  const CHART_BOTTOM = 107;
  const BOTTOM_DIVIDER_Y = 109;

  ctx.clear(BG);
  ctx.strokeStyle = MAGENTA;
  ctx.drawLine(0, TOP_DIVIDER_Y, 159, TOP_DIVIDER_Y);
  ctx.drawLine(0, BOTTOM_DIVIDER_Y, 159, BOTTOM_DIVIDER_Y);

  updateMarketInBackground();
  const data = market;
  if (!data || !data.candles || data.candles.length === 0) {
    ctx.drawText(data && data.status === 'error' ? 'DATA ERROR' : 'LOADING DATA', 4, 56, {
      color: data && data.status === 'error' ? RED : '#ffb000', scale: 2,
    });
    return;
  }

  const candles = data.candles;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const percent = (last.close - first.open) / first.open * 100;
  const direction = percent >= 0 ? GREEN : RED;
  const price = `$${last.close.toFixed(last.close >= 1000 ? 1 : 3)}`;
  const percentText = `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
  ctx.drawText(price, 2, 1, { color: direction, scale: 2 });
  ctx.drawText(percentText, 158 - percentText.length * 4, 4, { color: direction });

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
  const currentPriceY = priceY(last.close);
  ctx.strokeStyle = percent >= 0 ? CURRENT_UP : CURRENT_DOWN;
  ctx.drawLine(0, currentPriceY, 159, currentPriceY);

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
    const color = candle.close >= candle.open ? CYAN : RED;
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
    ctx.drawText(label, labelX, labelY, { color: EXTREME_LABEL, background: BG });
  }

  drawExtremeLabel(high, highIndex, priceY(high), false);
  drawExtremeLabel(low, lowIndex, priceY(low), true);

  ctx.drawText(`${data.symbol} ${data.interval}`, 2, 111, { color: '#ffffff' });

  const status = data.status === 'stale' ? 'STALE' : 'LIVE';
  const statusX = 160 - status.length * 4;
  ctx.drawText(status, statusX, 111, { color: data.status === 'stale' ? '#ffb000' : GREEN });

  const dateObj = new Date();
  const date = dateObj.toLocaleDateString('uk-UA');
  const time = dateObj.toLocaleTimeString('uk-UA');

  ctx.drawText(date, 2, 118, { color: '#007e8f', scale: 2 });
  const timeX = 161 - time.length * 8;
  ctx.drawText(time, timeX, 118, { color: '#007e8f', scale: 2 });
  ctx.drawText('By Hoxz', 96, 4, { color: '#600372' });
}
