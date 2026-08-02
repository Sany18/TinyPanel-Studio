'use strict';

const path = require('path');
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
const {
  FrameBuilder, TILE_SIZE, TILES_X, TILE_COUNT, TILE_PIXEL_BYTES,
} = require('../protocol');

const PANEL_W = 160;
const PANEL_H = 128;

// Renders a static HTML/CSS file to the panel via headless Chromium, diffed
// tile-by-tile against the previous frame so only changed 16x16 tiles get
// sent (see DISPLAY_PROTOCOL.md's "Tile blit" section).
class HtmlProgram {
  constructor(htmlFilePath) {
    this.htmlFilePath = htmlFilePath;
    this._browser = null;
    this._page = null;
    this._prevTiles = null; // Buffer[TILE_COUNT] | null; null = force full redraw
  }

  // Idempotent: call once at server startup and reuse across ESP32
  // reconnects - relaunching Chromium per reconnect would be slow.
  async start() {
    if (this._browser) return;
    this._browser = await puppeteer.launch();
    this._page = await this._browser.newPage();
    await this._page.setViewport({ width: PANEL_W, height: PANEL_H, deviceScaleFactor: 1 });
    await this._page.goto('file://' + path.resolve(this.htmlFilePath));
  }

  // Call on each new ESP32 connection: forces the next nextFrame() to be a
  // full 80-tile redraw, since there's no shared diff state with whatever
  // is actually on the panel after a (re)connect - mirrors the .ino's own
  // rxLen/expectedLen reset in connectServer().
  resetDiff() {
    this._prevTiles = null;
  }

  // Returns a FrameBuilder with only the changed tiles' blitTile() calls
  // queued. Caller adds frameEnd() (matches how programs/synthwave.js's
  // functions don't call frameEnd() either - that's runLockstep's job).
  async nextFrame() {
    const rgb565 = await this._captureRgb565();
    const fb = new FrameBuilder();
    const isFirst = this._prevTiles === null;
    const nextTiles = new Array(TILE_COUNT);

    for (let tileIndex = 0; tileIndex < TILE_COUNT; tileIndex++) {
      const tileBuf = this._extractTileBE(rgb565, tileIndex);
      nextTiles[tileIndex] = tileBuf;
      if (isFirst || !tileBuf.equals(this._prevTiles[tileIndex])) {
        fb.blitTile(tileIndex, tileBuf);
      }
    }
    this._prevTiles = nextTiles;
    return fb;
  }

  async _captureRgb565() {
    const pngBuf = await this._page.screenshot({ encoding: 'binary' });
    const png = PNG.sync.read(pngBuf);
    const out = new Uint16Array(PANEL_W * PANEL_H);
    for (let i = 0; i < PANEL_W * PANEL_H; i++) {
      const o = i * 4;
      const r = png.data[o];
      const g = png.data[o + 1];
      const b = png.data[o + 2];
      out[i] = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    }
    return out;
  }

  _extractTileBE(rgb565, tileIndex) {
    const tileCol = tileIndex % TILES_X;
    const tileRow = Math.floor(tileIndex / TILES_X);
    const buf = Buffer.alloc(TILE_PIXEL_BYTES);
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let col = 0; col < TILE_SIZE; col++) {
        const px = rgb565[(tileRow * TILE_SIZE + row) * PANEL_W + (tileCol * TILE_SIZE + col)];
        buf.writeUInt16BE(px, (row * TILE_SIZE + col) * 2);
      }
    }
    return buf;
  }

  async stop() {
    if (this._browser) await this._browser.close();
  }
}

module.exports = { HtmlProgram, PANEL_W, PANEL_H };
