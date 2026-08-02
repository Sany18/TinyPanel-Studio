function render(ctx, state) {
  const BG = '#100020';
  const GRID = '#301860';
  const MAGENTA = '#ff207d';
  const CYAN = '#00ffff';
  const RED = '#ff2020';
  const GREEN = '#00ff40';

  ctx.clear(BG);
  ctx.strokeStyle = GRID;
  for (let y = 30; y <= 94; y += 16) ctx.drawLine(0, y, 159, y);
  ctx.strokeStyle = MAGENTA;
  ctx.drawLine(0, 20, 159, 20);
  ctx.drawLine(0, 101, 159, 101);

  const data = state.data;
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
  ctx.drawText(price, 2, 2, { color: direction, scale: 2 });
  ctx.drawText(percentText, 158 - percentText.length * 4, 12, { color: direction });

  let low = candles[0].low;
  let high = candles[0].high;
  for (const candle of candles) {
    low = Math.min(low, candle.low);
    high = Math.max(high, candle.high);
  }
  const range = Math.max(0.000001, high - low);
  const chartTop = 23;
  const chartBottom = 98;
  const chartHeight = chartBottom - chartTop;
  const priceY = (value) => chartBottom - Math.round((value - low) / range * chartHeight);
  const slot = 160 / candles.length;
  const bodyWidth = Math.max(2, Math.floor(slot) - 2);

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

  ctx.drawText(`${data.symbol} ${data.interval}`, 2, 106, { color: '#ffffff' });
  const status = data.status === 'stale' ? 'STALE' : 'LIVE';
  ctx.drawText(status, 158 - status.length * 4, 106, { color: data.status === 'stale' ? '#ffb000' : GREEN });
}
