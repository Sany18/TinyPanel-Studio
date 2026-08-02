'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CanvasRenderer, SoftwareCanvasRenderer, color565 } = require('../src/render/canvas565');

test('converts CSS hex colors to RGB565', () => {
  assert.equal(color565('#ff0000'), 0xf800);
  assert.equal(color565('#00ff00'), 0x07e0);
  assert.equal(color565('#0000ff'), 0x001f);
  assert.equal(color565('cyan'), 0x07ff);
  assert.equal(color565('green'), 0x0400);
});

test('renders linear gradients with Canvas color stops', () => {
  const renderer = new CanvasRenderer(10, 2);
  const gradient = renderer.canvas.createLinearGradient(1, 0, 8, 0);
  gradient.addColorStop(0, 'green');
  gradient.addColorStop(0.5, 'cyan');
  gradient.addColorStop(1, '#ffffff');
  renderer.canvas.fillStyle = gradient;
  renderer.canvas.fillRect(0, 0, 10, 2);
  renderer.encodeDiff();
  assert.equal(renderer.current.pixels[0], color565('green'));
  assert.equal(renderer.current.pixels[9], color565('#ffffff'));
  assert.notEqual(renderer.current.pixels[4], renderer.current.pixels[0]);
});

test('supports browser Canvas paths and transforms', () => {
  const renderer = new CanvasRenderer();
  renderer.canvas.fillStyle = '#ff0000';
  renderer.canvas.save();
  renderer.canvas.translate(20, 10);
  renderer.canvas.beginPath();
  renderer.canvas.arc(0, 0, 5, 0, Math.PI * 2);
  renderer.canvas.fill();
  renderer.canvas.restore();
  renderer.encodeDiff();
  assert.notEqual(renderer.current.pixels[10 * 160 + 20], 0);
});

test('keeps shape edges pixel-sharp without antialias colors', () => {
  const renderer = new CanvasRenderer();
  renderer.canvas.clear('#300038');
  renderer.canvas.fillStyle = '#ff9800';
  renderer.canvas.fillCircle(40, 40, 17);
  renderer.encodeDiff();
  const colors = new Set(renderer.current.pixels);
  assert.deepEqual(colors, new Set([color565('#300038'), color565('#ff9800')]));
});

test('keeps legacy helper geometry pixel-identical to the software renderer', () => {
  const native = new CanvasRenderer();
  const software = new (require('../src/render/canvas565').SoftwareCanvasRenderer)();
  for (const renderer of [native, software]) {
    renderer.canvas.clear('#100020');
    renderer.canvas.fillStyle = '#ff9800';
    renderer.canvas.fillCircle(80, 50, 26);
    renderer.canvas.fillStyle = '#800080';
    renderer.canvas.fillTriangle(4, 63, 26, 42, 52, 63);
    renderer.canvas.strokeStyle = '#ffffff';
    renderer.canvas.drawLine(0, 127, 80, 65);
    renderer.encodeDiff();
  }
  assert.deepEqual(native.current.pixels, software.current.pixels);
});

test('first render is full and later renders contain only dirty tiles', () => {
  const renderer = new SoftwareCanvasRenderer();
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
  assert.equal(changed.frame.toBuffer().length, 7);
});

test('merges adjacent dirty tiles into one horizontal rectangle', () => {
  const renderer = new SoftwareCanvasRenderer();
  renderer.render((ctx) => ctx.clear(0));
  const changed = renderer.render((ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 1, 31, 1);
  });
  assert.equal(changed.dirtyTiles, 2);
  assert.equal(changed.dirtyRects, 1);
  assert.equal(changed.frame.toBuffer()[0], 0xe1);
});

test('splits a full changed frame into protocol-safe 16-row strips', () => {
  const renderer = new SoftwareCanvasRenderer();
  renderer.render((ctx) => ctx.clear('#000000'));
  const changed = renderer.render((ctx) => ctx.clear('#ffffff'));
  assert.equal(changed.dirtyRects, 8);
  assert.equal(changed.frame.toBuffer().length, 8 * (5 + 160 * 16 * 2));
});

test('encodes compatible native Canvas calls as compact vector commands', { skip: !new CanvasRenderer().backend }, () => {
  const renderer = new CanvasRenderer();
  renderer.vectorEnabled = true;
  const result = renderer.render((ctx) => {
    ctx.clear('#000000');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(1, 2, 3, 4);
    ctx.strokeStyle = '#ffffff';
    ctx.drawLine(0, 0, 10, 10);
  });
  assert.equal(result.encoding, 'vector');
  assert.equal(result.frame.toBuffer().length, 25);
  assert.deepEqual([...result.frame.toBuffer()].filter((_, index) => index === 0 || index === 3 || index === 14), [0x01, 0x02, 0x05]);
});

test('falls back to raster encoding for browser Canvas paths', { skip: !new CanvasRenderer().backend }, () => {
  const renderer = new CanvasRenderer();
  const result = renderer.render((ctx) => {
    ctx.clear('#000000');
    ctx.beginPath();
    ctx.arc(20, 20, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  assert.equal(result.encoding, 'raster');
  assert.equal(result.frame.toBuffer()[0], 0xe1);
});

test('draws compact bitmap text and reports its end position', () => {
  const renderer = new CanvasRenderer();
  const end = renderer.canvas.drawText('BTC 10%', 2, 3, { color: '#ffffff', scale: 2 });
  renderer.encodeDiff();
  assert.equal(end, 2 + 7 * 8);
  assert.equal(renderer.current.pixels.some((pixel) => pixel === 0xffff), true);
});
