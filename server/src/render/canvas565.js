'use strict';

const { DisplayFramebuffer, WIDTH, HEIGHT } = require('../displayFramebuffer');
const { FrameBuilder, TILE_SIZE, TILES_X, TILES_Y } = require('../protocol');

function color565(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) return value;
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  }
  throw new TypeError(`unsupported color: ${value}`);
}

const FONT_3X5 = {
  ' ': ['000', '000', '000', '000', '000'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'], P: ['110', '101', '110', '100', '100'],
  Q: ['111', '101', '101', '111', '001'], R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  '$': ['011', '110', '111', '011', '110'], '%': ['101', '001', '010', '100', '101'],
  '+': ['000', '010', '111', '010', '000'], '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'], ':': ['000', '010', '000', '010', '000'],
  '/': ['001', '001', '010', '100', '100'], '|': ['010', '010', '010', '010', '010'],
  '?': ['111', '001', '010', '000', '010'], '_': ['000', '000', '000', '000', '111'],
};

class Canvas565 {
  constructor(framebuffer = new DisplayFramebuffer()) {
    this.framebuffer = framebuffer;
    this.fillStyle = 0xffff;
    this.strokeStyle = 0xffff;
  }

  clear(color = 0) {
    this.framebuffer.pixels.fill(color565(color));
  }

  fillRect(x, y, width, height) {
    this.framebuffer.fillRect(Math.trunc(x), Math.trunc(y), Math.trunc(width), Math.trunc(height), color565(this.fillStyle));
  }

  drawLine(x0, y0, x1, y1) {
    this.framebuffer.drawLine(Math.trunc(x0), Math.trunc(y0), Math.trunc(x1), Math.trunc(y1), color565(this.strokeStyle));
  }

  fillCircle(x, y, radius) {
    this.framebuffer.fillCircle(Math.trunc(x), Math.trunc(y), Math.trunc(radius), color565(this.fillStyle));
  }

  fillTriangle(x0, y0, x1, y1, x2, y2) {
    this.framebuffer.fillTriangle(Math.trunc(x0), Math.trunc(y0), Math.trunc(x1), Math.trunc(y1),
      Math.trunc(x2), Math.trunc(y2), color565(this.fillStyle));
  }

  drawText(text, x, y, options = {}) {
    const scale = Math.max(1, Math.trunc(options.scale || 1));
    const color = color565(options.color ?? this.fillStyle);
    const background = options.background === undefined ? null : color565(options.background);
    let cursorX = Math.trunc(x);
    const cursorY = Math.trunc(y);
    for (const rawCharacter of String(text)) {
      const character = rawCharacter.toUpperCase();
      const glyph = FONT_3X5[character] || FONT_3X5['?'];
      if (background !== null) this.framebuffer.fillRect(cursorX, cursorY, 4 * scale, 5 * scale, background);
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row][col] === '1') {
            this.framebuffer.fillRect(cursorX + col * scale, cursorY + row * scale, scale, scale, color);
          }
        }
      }
      cursorX += 4 * scale;
    }
    return cursorX;
  }
}

class CanvasRenderer {
  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    this.current = new DisplayFramebuffer(width, height);
    this.previous = new Uint16Array(width * height);
    this.hasPrevious = false;
    this.canvas = new Canvas565(this.current);
  }

  render(draw) {
    draw(this.canvas);
    return this.encodeDiff();
  }

  encodeDiff() {
    const fb = new FrameBuilder();
    let dirtyTiles = 0;
    let dirtyRects = 0;
    for (let tileRow = 0; tileRow < TILES_Y; tileRow++) {
      const rowDirty = new Array(TILES_X).fill(false);
      for (let tileCol = 0; tileCol < TILES_X; tileCol++) {
        let dirty = !this.hasPrevious;
        const tileX = tileCol * TILE_SIZE;
        const tileY = tileRow * TILE_SIZE;
        if (!dirty) {
          for (let row = 0; row < TILE_SIZE && !dirty; row++) {
            const start = (tileY + row) * this.width + tileX;
            for (let col = 0; col < TILE_SIZE; col++) {
              if (this.current.pixels[start + col] !== this.previous[start + col]) {
                dirty = true;
                break;
              }
            }
          }
        }
        if (dirty) {
          rowDirty[tileCol] = true;
          dirtyTiles++;
        }
      }

      for (let runStart = 0; runStart < TILES_X;) {
        if (!rowDirty[runStart]) { runStart++; continue; }
        let runEnd = runStart + 1;
        while (runEnd < TILES_X && rowDirty[runEnd]) runEnd++;
        const x = runStart * TILE_SIZE;
        const y = tileRow * TILE_SIZE;
        const width = (runEnd - runStart) * TILE_SIZE;
        const pixels = Buffer.allocUnsafe(width * TILE_SIZE * 2);
        for (let row = 0; row < TILE_SIZE; row++) {
          const sourceStart = (y + row) * this.width + x;
          for (let col = 0; col < width; col++) {
            pixels.writeUInt16BE(this.current.pixels[sourceStart + col], (row * width + col) * 2);
          }
        }
        fb.blitRect(x, y, width, TILE_SIZE, pixels);
        dirtyRects++;
        runStart = runEnd;
      }
    }
    this.previous.set(this.current.pixels);
    this.hasPrevious = true;
    return { frame: fb, dirtyTiles, dirtyRects };
  }

  resetDiff() {
    this.hasPrevious = false;
  }
}

module.exports = { Canvas565, CanvasRenderer, color565, FONT_3X5 };
