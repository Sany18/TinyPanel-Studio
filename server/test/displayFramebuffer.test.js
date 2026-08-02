'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DisplayFramebuffer } = require('../src/displayFramebuffer');
const { FrameBuilder } = require('../src/protocol');

test('applies vector and tile commands to bounded RGB565 state', () => {
  const sourceTile = Buffer.alloc(512);
  for (let i = 0; i < 256; i++) sourceTile.writeUInt16BE(i, i * 2);
  const frame = new FrameBuilder()
    .fillScreen(0x0001)
    .fillRect(2, 3, 4, 5, 0x1234)
    .drawLine(0, 0, 2, 0, 0xffff)
    .blitTile(79, sourceTile)
    .frameEnd()
    .toBuffer();

  const framebuffer = new DisplayFramebuffer();
  framebuffer.applyFrame(frame);
  assert.equal(framebuffer.pixels[3 * 160 + 2], 0x1234);
  assert.equal(framebuffer.pixels[0], 0xffff);
  assert.equal(framebuffer.pixels[127 * 160 + 159], 255);
});

test('full snapshot reconstructs the same framebuffer without history', () => {
  const original = new DisplayFramebuffer();
  original.applyFrame(new FrameBuilder()
    .fillScreen(0x0102)
    .fillCircle(40, 30, 12, 0xabcd)
    .fillTriangle(70, 10, 90, 60, 50, 60, 0x7777)
    .frameEnd()
    .toBuffer());

  const restored = new DisplayFramebuffer();
  restored.applyFrame(original.snapshotFrame());
  assert.deepEqual(restored.pixels, original.pixels);
  assert.equal(original.snapshotFrame().length, 8 * (5 + 160 * 16 * 2) + 1);
});
