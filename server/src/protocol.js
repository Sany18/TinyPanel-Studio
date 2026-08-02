'use strict';

// Wire format is documented in ../../DISPLAY_PROTOCOL.md — keep this file in
// sync with that spec, it's the only source of truth shared with the .ino.

const OP_FILL_SCREEN = 0x01;
const OP_FILL_RECT = 0x02;
const OP_FILL_CIRCLE = 0x03;
const OP_FILL_TRIANGLE = 0x04;
const OP_DRAW_LINE = 0x05;
const OP_BLIT_TILE = 0xe0;
const OP_BLIT_RECT = 0xe1;
const OP_FRAME_END = 0xf0;

const ACK_BYTE = 0x06;

const TILE_SIZE = 16;
const TILES_X = 10; // 160 / 16
const TILES_Y = 8; // 128 / 16
const TILE_COUNT = TILES_X * TILES_Y; // 80
const TILE_PIXEL_BYTES = TILE_SIZE * TILE_SIZE * 2; // 512
const MAX_RECT_PIXEL_BYTES = 160 * TILE_SIZE * 2; // one full-width 16px strip

class FrameBuilder {
  constructor() {
    this._chunks = [];
  }

  fillScreen(color) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(OP_FILL_SCREEN, 0);
    buf.writeUInt16BE(color, 1);
    this._chunks.push(buf);
    return this;
  }

  fillRect(x, y, w, h, color) {
    const buf = Buffer.alloc(11);
    buf.writeUInt8(OP_FILL_RECT, 0);
    buf.writeInt16BE(x, 1);
    buf.writeInt16BE(y, 3);
    buf.writeInt16BE(w, 5);
    buf.writeInt16BE(h, 7);
    buf.writeUInt16BE(color, 9);
    this._chunks.push(buf);
    return this;
  }

  fillCircle(x0, y0, r, color) {
    const buf = Buffer.alloc(9);
    buf.writeUInt8(OP_FILL_CIRCLE, 0);
    buf.writeInt16BE(x0, 1);
    buf.writeInt16BE(y0, 3);
    buf.writeInt16BE(r, 5);
    buf.writeUInt16BE(color, 7);
    this._chunks.push(buf);
    return this;
  }

  fillTriangle(x0, y0, x1, y1, x2, y2, color) {
    const buf = Buffer.alloc(15);
    buf.writeUInt8(OP_FILL_TRIANGLE, 0);
    buf.writeInt16BE(x0, 1);
    buf.writeInt16BE(y0, 3);
    buf.writeInt16BE(x1, 5);
    buf.writeInt16BE(y1, 7);
    buf.writeInt16BE(x2, 9);
    buf.writeInt16BE(y2, 11);
    buf.writeUInt16BE(color, 13);
    this._chunks.push(buf);
    return this;
  }

  drawLine(x0, y0, x1, y1, color) {
    const buf = Buffer.alloc(11);
    buf.writeUInt8(OP_DRAW_LINE, 0);
    buf.writeInt16BE(x0, 1);
    buf.writeInt16BE(y0, 3);
    buf.writeInt16BE(x1, 5);
    buf.writeInt16BE(y1, 7);
    buf.writeUInt16BE(color, 9);
    this._chunks.push(buf);
    return this;
  }

  // pixelDataBE: a pre-built TILE_PIXEL_BYTES-long Buffer of RGB565 pixels,
  // row-major within the tile, big-endian - the caller (htmlProgram.js)
  // already has to build this during RGB565 conversion, so this just wraps
  // it rather than re-encoding 256 pixels one at a time.
  blitTile(tileIndex, pixelDataBE) {
    if (pixelDataBE.length !== TILE_PIXEL_BYTES) {
      throw new RangeError(`blitTile: pixelDataBE must be ${TILE_PIXEL_BYTES} bytes, got ${pixelDataBE.length}`);
    }
    const buf = Buffer.alloc(2 + TILE_PIXEL_BYTES);
    buf.writeUInt8(OP_BLIT_TILE, 0);
    buf.writeUInt8(tileIndex, 1);
    pixelDataBE.copy(buf, 2);
    this._chunks.push(buf);
    return this;
  }

  // Horizontal dirty strip. Keeping h <= TILE_SIZE bounds the ESP32 command
  // and native pixel buffers while still merging up to 10 adjacent tiles.
  blitRect(x, y, width, height, pixelDataBE) {
    const pixelBytes = width * height * 2;
    if (!Number.isInteger(x) || !Number.isInteger(y)
        || !Number.isInteger(width) || !Number.isInteger(height)
        || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > 160 || y + height > 128 || height > TILE_SIZE) {
      throw new RangeError(`blitRect: invalid rectangle ${x},${y} ${width}x${height}`);
    }
    if (pixelBytes > MAX_RECT_PIXEL_BYTES || pixelDataBE.length !== pixelBytes) {
      throw new RangeError(`blitRect: expected ${pixelBytes} pixel bytes, got ${pixelDataBE.length}`);
    }
    const buf = Buffer.allocUnsafe(5 + pixelBytes);
    buf.writeUInt8(OP_BLIT_RECT, 0);
    buf.writeUInt8(x, 1);
    buf.writeUInt8(y, 2);
    buf.writeUInt8(width, 3);
    buf.writeUInt8(height, 4);
    pixelDataBE.copy(buf, 5);
    this._chunks.push(buf);
    return this;
  }

  frameEnd() {
    this._chunks.push(Buffer.from([OP_FRAME_END]));
    return this;
  }

  toBuffer() {
    return Buffer.concat(this._chunks);
  }
}

module.exports = {
  OP_FILL_SCREEN,
  OP_FILL_RECT,
  OP_FILL_CIRCLE,
  OP_FILL_TRIANGLE,
  OP_DRAW_LINE,
  OP_BLIT_TILE,
  OP_BLIT_RECT,
  OP_FRAME_END,
  ACK_BYTE,
  TILE_SIZE,
  TILES_X,
  TILES_Y,
  TILE_COUNT,
  TILE_PIXEL_BYTES,
  MAX_RECT_PIXEL_BYTES,
  FrameBuilder,
};
