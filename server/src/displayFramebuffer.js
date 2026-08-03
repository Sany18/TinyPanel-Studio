'use strict';

const {
  FrameBuilder, TILE_SIZE, TILES_X, TILES_Y,
} = require('./protocol');

const WIDTH = 160;
const HEIGHT = 128;

function readU16(buf, offset) {
  return buf.readUInt16BE(offset);
}

function readI16(buf, offset) {
  return buf.readInt16BE(offset);
}

class DisplayFramebuffer {
  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint16Array(width * height);
  }

  pixel(x, y, color) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.pixels[y * this.width + x] = color;
    }
  }

  fillRect(x, y, width, height, color) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + width);
    const y1 = Math.min(this.height, y + height);
    for (let py = y0; py < y1; py++) {
      this.pixels.fill(color, py * this.width + x0, py * this.width + x1);
    }
  }

  drawLine(x0, y0, x1, y1, color) {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.pixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x0 += sx; }
      if (doubled <= dx) { error += dx; y0 += sy; }
    }
  }

  fillCircle(cx, cy, radius, color) {
    const radiusSquared = radius * radius;
    for (let y = -radius; y <= radius; y++) {
      const halfWidth = Math.floor(Math.sqrt(radiusSquared - y * y));
      this.fillRect(cx - halfWidth, cy + y, halfWidth * 2 + 1, 1, color);
    }
  }

  fillTriangle(x0, y0, x1, y1, x2, y2, color) {
    const minX = Math.max(0, Math.min(x0, x1, x2));
    const maxX = Math.min(this.width - 1, Math.max(x0, x1, x2));
    const minY = Math.max(0, Math.min(y0, y1, y2));
    const maxY = Math.min(this.height - 1, Math.max(y0, y1, y2));
    const edge = (ax, ay, bx, by, px, py) => (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const a = edge(x0, y0, x1, y1, x, y);
        const b = edge(x1, y1, x2, y2, x, y);
        const c = edge(x2, y2, x0, y0, x, y);
        if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) this.pixel(x, y, color);
      }
    }
  }

  blitTile(tileIndex, buf, pixelOffset) {
    const tileX = (tileIndex % TILES_X) * TILE_SIZE;
    const tileY = Math.floor(tileIndex / TILES_X) * TILE_SIZE;
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let col = 0; col < TILE_SIZE; col++) {
        this.pixel(tileX + col, tileY + row, readU16(buf, pixelOffset + (row * TILE_SIZE + col) * 2));
      }
    }
  }

  blitRect(x, y, width, height, buf, pixelOffset) {
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        this.pixel(x + col, y + row, readU16(buf, pixelOffset + (row * width + col) * 2));
      }
    }
  }

  applyFrame(buf) {
    let offset = 0;
    while (offset < buf.length) {
      const op = buf[offset];
      if (op === 0x01) {
        this.pixels.fill(readU16(buf, offset + 1));
        offset += 3;
      } else if (op === 0x02) {
        this.fillRect(readI16(buf, offset + 1), readI16(buf, offset + 3),
          readI16(buf, offset + 5), readI16(buf, offset + 7), readU16(buf, offset + 9));
        offset += 11;
      } else if (op === 0x03) {
        this.fillCircle(readI16(buf, offset + 1), readI16(buf, offset + 3),
          readI16(buf, offset + 5), readU16(buf, offset + 7));
        offset += 9;
      } else if (op === 0x04) {
        this.fillTriangle(readI16(buf, offset + 1), readI16(buf, offset + 3),
          readI16(buf, offset + 5), readI16(buf, offset + 7),
          readI16(buf, offset + 9), readI16(buf, offset + 11), readU16(buf, offset + 13));
        offset += 15;
      } else if (op === 0x05) {
        this.drawLine(readI16(buf, offset + 1), readI16(buf, offset + 3),
          readI16(buf, offset + 5), readI16(buf, offset + 7), readU16(buf, offset + 9));
        offset += 11;
      } else if (op === 0x06) {
        offset += 2;
      } else if (op === 0x07) {
        offset += 3;
      } else if (op === 0xe0) {
        this.blitTile(buf[offset + 1], buf, offset + 2);
        offset += 514;
      } else if (op === 0xe1) {
        const x = buf[offset + 1];
        const y = buf[offset + 2];
        const width = buf[offset + 3];
        const height = buf[offset + 4];
        this.blitRect(x, y, width, height, buf, offset + 5);
        offset += 5 + width * height * 2;
      } else if (op === 0xe2) {
        const length = readU16(buf, offset + 1);
        // JPEG is decoded by the physical client and browser preview. The
        // registry keeps its most recent raster snapshot until a decoder is
        // available here as well.
        offset += 3 + length;
      } else if (op === 0xf0) {
        offset++;
      } else {
        throw new Error(`unknown framebuffer opcode 0x${op.toString(16)} at ${offset}`);
      }
    }
  }

  snapshotFrame() {
    const fb = new FrameBuilder();
    for (let tileRow = 0; tileRow < TILES_Y; tileRow++) {
      const y = tileRow * TILE_SIZE;
      const strip = Buffer.allocUnsafe(this.width * TILE_SIZE * 2);
      for (let row = 0; row < TILE_SIZE; row++) {
        for (let x = 0; x < this.width; x++) {
          strip.writeUInt16BE(this.pixels[(y + row) * this.width + x], (row * this.width + x) * 2);
        }
      }
      fb.blitRect(0, y, this.width, TILE_SIZE, strip);
    }
    fb.frameEnd();
    return fb.toBuffer();
  }
}

module.exports = { DisplayFramebuffer, WIDTH, HEIGHT };
