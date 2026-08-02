'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CanvasRenderer, color565 } = require('../src/render/canvas565');

test('converts CSS hex colors to RGB565', () => {
  assert.equal(color565('#ff0000'), 0xf800);
  assert.equal(color565('#00ff00'), 0x07e0);
  assert.equal(color565('#0000ff'), 0x001f);
});

test('first render is full and later renders contain only dirty tiles', () => {
  const renderer = new CanvasRenderer();
  const first = renderer.render((ctx) => {
    ctx.clear('#000000');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 1, 2, 2);
  });
  assert.equal(first.dirtyTiles, 80);

  const unchanged = renderer.render(() => {});
  assert.equal(unchanged.dirtyTiles, 0);

  const changed = renderer.render((ctx) => {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(17, 1, 1, 1);
  });
  assert.equal(changed.dirtyTiles, 1);
  assert.equal(changed.dirtyRects, 1);
  assert.equal(changed.frame.toBuffer().length, 517);
});

test('merges adjacent dirty tiles into one horizontal rectangle', () => {
  const renderer = new CanvasRenderer();
  renderer.render((ctx) => ctx.clear(0));
  const changed = renderer.render((ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 1, 31, 1);
  });
  assert.equal(changed.dirtyTiles, 2);
  assert.equal(changed.dirtyRects, 1);
  assert.equal(changed.frame.toBuffer()[0], 0xe1);
});

test('draws compact bitmap text and reports its end position', () => {
  const renderer = new CanvasRenderer();
  const end = renderer.canvas.drawText('BTC 10%', 2, 3, { color: '#ffffff', scale: 2 });
  assert.equal(end, 2 + 7 * 8);
  assert.equal(renderer.current.pixels.some((pixel) => pixel === 0xffff), true);
});
