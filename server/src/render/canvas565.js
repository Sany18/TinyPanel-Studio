'use strict';

const { DisplayFramebuffer, WIDTH, HEIGHT } = require('../displayFramebuffer');
const { FrameBuilder, TILE_SIZE, TILES_X, TILES_Y } = require('../protocol');

let createNativeCanvas = null;
try {
  ({ createCanvas: createNativeCanvas } = require('canvas'));
} catch (_) {
  // Keep the pure-JS renderer usable on an unsupported native platform.
}

const CSS_COLORS = Object.freeze({
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', transparent: '#000000',
});

function color565(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) return value;
  if (typeof value === 'string' && CSS_COLORS[value.toLowerCase()]) value = CSS_COLORS[value.toLowerCase()];
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  }
  throw new TypeError(`unsupported color: ${value}`);
}

function color565ToCss(value) {
  const color = color565(value);
  const r = Math.round(((color >> 11) & 0x1f) * 255 / 31);
  const g = Math.round(((color >> 5) & 0x3f) * 255 / 63);
  const b = Math.round((color & 0x1f) * 255 / 31);
  return `rgb(${r}, ${g}, ${b})`;
}

function interpolate565(from, to, amount) {
  const fromR = (from >> 11) & 0x1f;
  const fromG = (from >> 5) & 0x3f;
  const fromB = from & 0x1f;
  const toR = (to >> 11) & 0x1f;
  const toG = (to >> 5) & 0x3f;
  const toB = to & 0x1f;
  const r = Math.round(fromR + (toR - fromR) * amount);
  const g = Math.round(fromG + (toG - fromG) * amount);
  const b = Math.round(fromB + (toB - fromB) * amount);
  return (r << 11) | (g << 5) | b;
}

class CanvasLinearGradient {
  constructor(x0, y0, x1, y1) {
    this.x0 = Number(x0); this.y0 = Number(y0);
    this.x1 = Number(x1); this.y1 = Number(y1);
    if (![this.x0, this.y0, this.x1, this.y1].every(Number.isFinite)) {
      throw new TypeError('gradient coordinates must be finite numbers');
    }
    this.stops = [];
  }

  addColorStop(offset, color) {
    const position = Number(offset);
    if (!Number.isFinite(position) || position < 0 || position > 1) {
      throw new RangeError('color stop offset must be between 0 and 1');
    }
    this.stops.push({ offset: position, color: color565(color) });
    this.stops.sort((a, b) => a.offset - b.offset);
  }

  colorAt(x, y) {
    if (!this.stops.length) return 0;
    if (this.stops.length === 1) return this.stops[0].color;
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    const lengthSquared = dx * dx + dy * dy;
    const position = lengthSquared === 0 ? 0 : ((x - this.x0) * dx + (y - this.y0) * dy) / lengthSquared;
    if (position <= this.stops[0].offset) return this.stops[0].color;
    const last = this.stops[this.stops.length - 1];
    if (position >= last.offset) return last.color;
    for (let index = 1; index < this.stops.length; index++) {
      const right = this.stops[index];
      if (position <= right.offset) {
        const left = this.stops[index - 1];
        const span = right.offset - left.offset;
        return interpolate565(left.color, right.color, span === 0 ? 1 : (position - left.offset) / span);
      }
    }
    return last.color;
  }
}

function isGradient(style) { return style instanceof CanvasLinearGradient; }

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

  createLinearGradient(x0, y0, x1, y1) {
    return new CanvasLinearGradient(x0, y0, x1, y1);
  }

  _paint(style, x, y) {
    return isGradient(style) ? style.colorAt(x, y) : color565(style);
  }

  fillRect(x, y, width, height) {
    x = Math.trunc(x); y = Math.trunc(y); width = Math.trunc(width); height = Math.trunc(height);
    if (!isGradient(this.fillStyle)) {
      this.framebuffer.fillRect(x, y, width, height, color565(this.fillStyle));
      return;
    }
    const x0 = Math.max(0, x); const y0 = Math.max(0, y);
    const x1 = Math.min(this.framebuffer.width, x + width);
    const y1 = Math.min(this.framebuffer.height, y + height);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.framebuffer.pixel(px, py, this._paint(this.fillStyle, px, py));
    }
  }

  drawLine(x0, y0, x1, y1) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    if (!isGradient(this.strokeStyle)) {
      this.framebuffer.drawLine(x0, y0, x1, y1, color565(this.strokeStyle));
      return;
    }
    const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.framebuffer.pixel(x0, y0, this._paint(this.strokeStyle, x0, y0));
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x0 += sx; }
      if (doubled <= dx) { error += dx; y0 += sy; }
    }
  }

  fillCircle(x, y, radius) {
    x = Math.trunc(x); y = Math.trunc(y); radius = Math.trunc(radius);
    if (!isGradient(this.fillStyle)) {
      this.framebuffer.fillCircle(x, y, radius, color565(this.fillStyle));
      return;
    }
    const radiusSquared = radius * radius;
    for (let py = -radius; py <= radius; py++) {
      const halfWidth = Math.floor(Math.sqrt(radiusSquared - py * py));
      for (let px = -halfWidth; px <= halfWidth; px++) {
        this.framebuffer.pixel(x + px, y + py, this._paint(this.fillStyle, x + px, y + py));
      }
    }
  }

  fillTriangle(x0, y0, x1, y1, x2, y2) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    x2 = Math.trunc(x2); y2 = Math.trunc(y2);
    if (!isGradient(this.fillStyle)) {
      this.framebuffer.fillTriangle(x0, y0, x1, y1, x2, y2, color565(this.fillStyle));
      return;
    }
    const minX = Math.max(0, Math.min(x0, x1, x2));
    const maxX = Math.min(this.framebuffer.width - 1, Math.max(x0, x1, x2));
    const minY = Math.max(0, Math.min(y0, y1, y2));
    const maxY = Math.min(this.framebuffer.height - 1, Math.max(y0, y1, y2));
    const edge = (ax, ay, bx, by, px, py) => (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const a = edge(x0, y0, x1, y1, px, py);
        const b = edge(x1, y1, x2, y2, px, py);
        const c = edge(x2, y2, x0, y0, px, py);
        if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) {
          this.framebuffer.pixel(px, py, this._paint(this.fillStyle, px, py));
        }
      }
    }
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

class SoftwareCanvasRenderer {
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

    // Once a baseline exists, encode one tight horizontal range per changed
    // scanline. Animated grid lines tend to cross many tiles while changing
    // only one or two rows; tile-sized rectangles waste most of their payload
    // on unchanged pixels. Consecutive rows with the same range are merged.
    if (this.hasPrevious) {
      const dirtyTileFlags = new Uint8Array(TILES_X * TILES_Y);
      const rects = [];
      let previousRect = null;
      for (let y = 0; y < this.height; y++) {
        const rowStart = y * this.width;
        let minX = this.width;
        let maxX = -1;
        for (let x = 0; x < this.width; x++) {
          const index = rowStart + x;
          if (this.current.pixels[index] === this.previous[index]) continue;
          minX = Math.min(minX, x);
          maxX = x;
          dirtyTileFlags[Math.floor(y / TILE_SIZE) * TILES_X + Math.floor(x / TILE_SIZE)] = 1;
        }
        if (maxX < 0) {
          previousRect = null;
          continue;
        }
        const width = maxX - minX + 1;
        if (previousRect && previousRect.height < TILE_SIZE
          && previousRect.x === minX && previousRect.width === width
          && previousRect.y + previousRect.height === y) {
          previousRect.height++;
        } else {
          previousRect = { x: minX, y, width, height: 1 };
          rects.push(previousRect);
        }
      }

      dirtyTiles = dirtyTileFlags.reduce((total, dirty) => total + dirty, 0);
      for (const rect of rects) {
        const pixels = Buffer.allocUnsafe(rect.width * rect.height * 2);
        for (let row = 0; row < rect.height; row++) {
          const sourceStart = (rect.y + row) * this.width + rect.x;
          for (let col = 0; col < rect.width; col++) {
            pixels.writeUInt16BE(
              this.current.pixels[sourceStart + col],
              (row * rect.width + col) * 2,
            );
          }
        }
        fb.blitRect(rect.x, rect.y, rect.width, rect.height, pixels);
      }
      dirtyRects = rects.length;
      this.previous.set(this.current.pixels);
      return { frame: fb, dirtyTiles, dirtyRects };
    }

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
        const scanX0 = runStart * TILE_SIZE;
        const scanX1 = runEnd * TILE_SIZE;
        const scanY0 = tileRow * TILE_SIZE;
        const scanY1 = scanY0 + TILE_SIZE;
        let minX = scanX1;
        let maxX = scanX0 - 1;
        let minY = scanY1;
        let maxY = scanY0 - 1;
        for (let y = scanY0; y < scanY1; y++) {
          const rowStart = y * this.width;
          for (let x = scanX0; x < scanX1; x++) {
            const index = rowStart + x;
            if (!this.hasPrevious || this.current.pixels[index] !== this.previous[index]) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }
        }
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const pixels = Buffer.allocUnsafe(width * height * 2);
        for (let row = 0; row < height; row++) {
          const sourceStart = (minY + row) * this.width + minX;
          for (let col = 0; col < width; col++) {
            pixels.writeUInt16BE(this.current.pixels[sourceStart + col], (row * width + col) * 2);
          }
        }
        fb.blitRect(minX, minY, width, height, pixels);
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

  snapshot() {
    return this.current.pixels.slice();
  }

  restore(snapshot) {
    this.current.pixels.set(snapshot);
  }
}

function addCompatibilityMethods(context, width, height) {
  context.clear = (color = '#000000') => {
    context.save();
    context.globalCompositeOperation = 'copy';
    context.fillStyle = Number.isInteger(color) ? color565ToCss(color) : color;
    context.fillRect(0, 0, width, height);
    context.restore();
  };
  context.fillCircle = (x, y, radius) => {
    x = Math.trunc(x); y = Math.trunc(y); radius = Math.trunc(radius);
    const radiusSquared = radius * radius;
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      const halfWidth = Math.floor(Math.sqrt(radiusSquared - offsetY * offsetY));
      context.fillRect(x - halfWidth, y + offsetY, halfWidth * 2 + 1, 1);
    }
  };
  context.fillTriangle = (x0, y0, x1, y1, x2, y2) => {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    x2 = Math.trunc(x2); y2 = Math.trunc(y2);
    const minX = Math.max(0, Math.min(x0, x1, x2));
    const maxX = Math.min(width - 1, Math.max(x0, x1, x2));
    const minY = Math.max(0, Math.min(y0, y1, y2));
    const maxY = Math.min(height - 1, Math.max(y0, y1, y2));
    const edge = (ax, ay, bx, by, px, py) => (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const a = edge(x0, y0, x1, y1, px, py);
        const b = edge(x1, y1, x2, y2, px, py);
        const c = edge(x2, y2, x0, y0, px, py);
        if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) {
          context.fillRect(px, py, 1, 1);
        }
      }
    }
  };
  context.drawLine = (x0, y0, x1, y1) => {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    const dx = Math.abs(x1 - x0); const stepX = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0); const stepY = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    context.save();
    context.fillStyle = context.strokeStyle;
    while (true) {
      context.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x0 += stepX; }
      if (doubled <= dx) { error += dx; y0 += stepY; }
    }
    context.restore();
  };
  context.drawText = (text, x, y, options = {}) => {
    const scale = Math.max(1, Math.trunc(options.scale || 1));
    const foreground = options.color ?? context.fillStyle;
    const background = options.background;
    let cursorX = Math.trunc(x);
    const cursorY = Math.trunc(y);
    context.save();
    for (const rawCharacter of String(text)) {
      const glyph = FONT_3X5[rawCharacter.toUpperCase()] || FONT_3X5['?'];
      if (background !== undefined) {
        context.fillStyle = Number.isInteger(background) ? color565ToCss(background) : background;
        context.fillRect(cursorX, cursorY, 4 * scale, 5 * scale);
      }
      context.fillStyle = Number.isInteger(foreground) ? color565ToCss(foreground) : foreground;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row][col] === '1') {
            context.fillRect(cursorX + col * scale, cursorY + row * scale, scale, scale);
          }
        }
      }
      cursorX += 4 * scale;
    }
    context.restore();
    return cursorX;
  };
}

function hasIdentityTransform(context) {
  const transform = context.getTransform();
  return transform.a === 1 && transform.b === 0 && transform.c === 0
    && transform.d === 1 && transform.e === 0 && transform.f === 0;
}

class VectorRecorder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.reset();
  }

  reset() {
    this.frame = new FrameBuilder();
    this.valid = true;
    this.commandCount = 0;
    this.startsWithClear = false;
  }

  invalidate() { this.valid = false; }

  color(style) {
    if (typeof style !== 'string' && !Number.isInteger(style)) throw new TypeError('non-solid paint');
    return color565(style);
  }

  canDraw(context) {
    return this.valid && context.globalAlpha === 1
      && (context.globalCompositeOperation === 'source-over' || context.globalCompositeOperation === 'copy')
      && hasIdentityTransform(context);
  }

  add(method, args) {
    this.frame[method](...args);
    this.commandCount++;
  }
}

function compatibleContext(context, recorder = null) {
  const passthrough = new Set(['save', 'restore', 'getTransform', 'measureText']);
  const vectorMethods = new Set(['clear', 'fillRect', 'fillCircle', 'fillTriangle', 'drawLine']);
  return new Proxy(context, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!recorder) return value.bind(target);
      if (vectorMethods.has(property)) {
        return (...args) => {
          const result = value.apply(target, args);
          try {
            if (property === 'clear') {
              recorder.add('fillScreen', [recorder.color(args[0] ?? '#000000')]);
              if (recorder.commandCount === 1) recorder.startsWithClear = true;
            } else if (!recorder.canDraw(target)) {
              recorder.invalidate();
            } else if (property === 'fillRect') {
              recorder.add('fillRect', args.slice(0, 4).map(Math.trunc).concat(recorder.color(target.fillStyle)));
            } else if (property === 'fillCircle') {
              recorder.add('fillCircle', args.slice(0, 3).map(Math.trunc).concat(recorder.color(target.fillStyle)));
            } else if (property === 'fillTriangle') {
              recorder.add('fillTriangle', args.slice(0, 6).map(Math.trunc).concat(recorder.color(target.fillStyle)));
            } else if (property === 'drawLine') {
              recorder.add('drawLine', args.slice(0, 4).map(Math.trunc).concat(recorder.color(target.strokeStyle)));
            }
          } catch (_) {
            recorder.invalidate();
          }
          return result;
        };
      }
      if (passthrough.has(property) || property === 'createLinearGradient') return value.bind(target);
      return (...args) => {
        recorder.invalidate();
        return value.apply(target, args);
      };
    },
    set(target, property, value) {
      if ((property === 'fillStyle' || property === 'strokeStyle') && Number.isInteger(value)) {
        value = color565ToCss(value);
      }
      return Reflect.set(target, property, value, target);
    },
  });
}

class NativeCanvasRenderer extends SoftwareCanvasRenderer {
  constructor(width = WIDTH, height = HEIGHT) {
    super(width, height);
    this.nativeCanvas = createNativeCanvas(width, height);
    this.nativeContext = this.nativeCanvas.getContext('2d', { alpha: false });
    // The physical panel is a low-resolution pixel grid. Cairo's default
    // antialiasing blends shape edges into neighboring pixels before RGB565
    // quantization, producing visible one-pixel halos that the old rasterizer
    // never generated.
    this.nativeContext.antialias = 'none';
    this.nativeContext.quality = 'nearest';
    this.nativeContext.patternQuality = 'nearest';
    this.nativeContext.imageSmoothingEnabled = false;
    addCompatibilityMethods(this.nativeContext, width, height);
    this.vectorRecorder = new VectorRecorder(width, height);
    // Keep the last successfully encoded image as the runtime-error rollback
    // checkpoint. LiveCanvasProgram asks for a snapshot before every render;
    // reusing this ImageData avoids a second full-canvas getImageData allocation
    // on every frame.
    this.rollbackSnapshot = this.nativeContext.getImageData(0, 0, width, height);
    // Experimental until firmware primitives are pixel-identical to the
    // server rasterizer. Mixing the two leaves one-pixel edge residue that a
    // later dirty diff cannot see in its server-side baseline.
    this.vectorEnabled = false;
    this.canvas = compatibleContext(this.nativeContext, this.vectorRecorder);
    this.backend = 'node-canvas-rgba';
  }

  encodeDiff() {
    const image = this.nativeContext.getImageData(0, 0, this.width, this.height);
    for (let pixel = 0; pixel < this.current.pixels.length; pixel++) {
      const offset = pixel * 4;
      this.current.pixels[pixel] = ((image.data[offset] >> 3) << 11)
        | ((image.data[offset + 1] >> 2) << 5)
        | (image.data[offset + 2] >> 3);
    }
    const vector = this.vectorRecorder;
    // A full vector redraw is compact, but the ST7735 has no back buffer: its
    // clear/background/shapes become visible one command at a time and moving
    // scenes appear to mix layers from adjacent frames. Use vector commands
    // only to establish the initial complete frame; subsequent animation is
    // sent as dirty raster ranges without clearing the whole physical panel.
    const canUseVector = this.vectorEnabled && !this.hasPrevious && vector.valid
      && vector.commandCount > 0 && vector.startsWithClear;
    if (canUseVector) {
      this.previous.set(this.current.pixels);
      this.hasPrevious = true;
      const result = {
        frame: vector.frame,
        dirtyTiles: 0,
        dirtyRects: 0,
        encoding: 'vector',
      };
      this.rollbackSnapshot = image;
      vector.reset();
      return result;
    }
    vector.reset();
    const result = { ...super.encodeDiff(), encoding: 'raster' };
    this.rollbackSnapshot = image;
    return result;
  }

  snapshot() {
    return this.rollbackSnapshot;
  }

  restore(snapshot) {
    this.nativeContext.putImageData(snapshot, 0, 0);
    this.vectorRecorder.invalidate();
  }
}

const CanvasRenderer = createNativeCanvas ? NativeCanvasRenderer : SoftwareCanvasRenderer;

module.exports = {
  Canvas565, CanvasLinearGradient, CanvasRenderer, NativeCanvasRenderer,
  SoftwareCanvasRenderer, color565, FONT_3X5,
};
