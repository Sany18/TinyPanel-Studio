'use strict';

const fs = require('fs');
const vm = require('vm');
const { CanvasRenderer } = require('../render/canvas565');

const CALL_RENDER = new vm.Script('__render(ctx, state)', { filename: 'live-app-call.vm.js' });

const SILENT_CONSOLE = Object.freeze({ log() {}, warn() {}, error() {} });

function compile(source, filename = 'live.canvas.js', consoleImpl = SILENT_CONSOLE, fetchImpl = globalThis.fetch) {
  const context = vm.createContext({
    Math,
    Date,
    console: consoleImpl,
    fetch: (...args) => fetchImpl(...args),
    URL,
    URLSearchParams,
    AbortController,
  });
  const script = new vm.Script(
    `'use strict';\n${source}\n`
      + `if (typeof render !== 'function') throw new TypeError('App must define function render(ctx, state)');\n`
      + 'globalThis.__render = render;',
    { filename },
  );
  script.runInContext(context, { timeout: 50 });
  return context;
}

class LiveAppStore {
  constructor(sourcePath) {
    this.sourcePath = sourcePath;
    this.source = fs.readFileSync(sourcePath, 'utf8');
    compile(this.source, sourcePath);
    this.revision = 1;
    this.updatedAt = new Date().toISOString();
  }

  update(source) {
    if (typeof source !== 'string' || source.length > 256 * 1024) {
      throw new TypeError('source must be a string no larger than 256 KiB');
    }
    compile(source, this.sourcePath);
    fs.writeFileSync(this.sourcePath, source);
    this.source = source;
    this.revision++;
    this.updatedAt = new Date().toISOString();
    return this.describe();
  }

  describe() {
    return { source: this.source, revision: this.revision, updatedAt: this.updatedAt };
  }
}

class LiveCanvasProgram {
  constructor(store, { dataProvider = null, log = null, fetchImpl = globalThis.fetch } = {}) {
    this.store = store;
    this.renderer = new CanvasRenderer();
    this.context = null;
    this.loadedRevision = 0;
    this.frame = 0;
    this.lastError = null;
    this.dataProvider = dataProvider;
    this.log = log;
    this.fetchImpl = fetchImpl;
    const writeLog = (level, values) => this.log?.write(level, values.map((value) => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }).join(' '));
    this.console = Object.freeze({
      log: (...values) => writeLog('log', values),
      warn: (...values) => writeLog('warn', values),
      error: (...values) => writeLog('error', values),
    });
  }

  nextFrame() {
    if (this.loadedRevision !== this.store.revision) {
      this.context = compile(this.store.source, this.store.sourcePath, this.console, this.fetchImpl);
      this.loadedRevision = this.store.revision;
      this.lastError = null;
    }

    const appData = this.dataProvider ? this.dataProvider(this.store.active?.manifest || {}) : null;
    this.dataStatus = appData ? { status: appData.status, updatedAt: appData.updatedAt, error: appData.error } : null;
    const state = Object.freeze({
      frame: this.frame,
      time: Date.now(),
      width: this.renderer.width,
      height: this.renderer.height,
      revision: this.loadedRevision,
      data: appData,
    });
    this.context.ctx = this.renderer.canvas;
    this.context.state = state;
    const rollback = this.renderer.snapshot();
    try {
      CALL_RENDER.runInContext(this.context, { timeout: 16 });
      this.lastError = null;
      this.frame++;
    } catch (error) {
      this.renderer.restore(rollback);
      this.lastError = { message: error.message, stack: error.stack, at: new Date().toISOString() };
    } finally {
      delete this.context.ctx;
      delete this.context.state;
    }
    return this.renderer.encodeDiff().frame;
  }
}

module.exports = { LiveAppStore, LiveCanvasProgram, compile };
