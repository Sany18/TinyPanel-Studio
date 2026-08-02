'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { compile } = require('./liveApp');

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONFIG_BLOCK = /\/\*\*[\s\S]*?@tinypanel[\s\S]*?\*\//;
const CONFIG_DEFAULTS = Object.freeze({
  name: 'Canvas App', description: '', width: 160, height: 128, orientation: 'landscape', fps: 30,
});
const DEFAULT_SOURCE = `/**
 * @tinypanel
 * @name Canvas App
 * @description Starter app for experiments
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 30
 */
function render(ctx, state) {
  ctx.clear('#000000');
  ctx.fillStyle = '#40e0ff';
  ctx.fillRect(state.frame % 152, 56, 8, 16);
}
`;

function validateConfig(value, fallback = {}) {
  const config = { ...CONFIG_DEFAULTS, ...fallback, ...value };
  if (typeof config.name !== 'string' || !config.name.trim()) throw new TypeError('name is required');
  if (config.name.trim().length > 100) throw new TypeError('name must be no longer than 100 characters');
  if (/[\r\n]|\*\//.test(config.name)) throw new TypeError('name must fit on one JSDoc line');
  if (typeof config.description !== 'string') throw new TypeError('description must be a string');
  if (config.description.length > 500) throw new TypeError('description must be no longer than 500 characters');
  if (/[\r\n]|\*\//.test(config.description)) throw new TypeError('description must fit on one JSDoc line');
  config.width = Number(config.width);
  config.height = Number(config.height);
  config.fps = Number(config.fps);
  if (!Number.isInteger(config.width) || config.width < 1 || config.width > 4096) throw new RangeError('width must be between 1 and 4096');
  if (!Number.isInteger(config.height) || config.height < 1 || config.height > 4096) throw new RangeError('height must be between 1 and 4096');
  if (!Number.isFinite(config.fps) || config.fps < 1 || config.fps > 60) throw new RangeError('fps must be between 1 and 60');
  if (!['landscape', 'landscape-reversed', 'portrait', 'portrait-reversed'].includes(config.orientation)) {
    throw new RangeError('orientation is invalid');
  }
  config.name = config.name.trim();
  config.description = config.description.trim();
  return config;
}

function parseConfig(source, fallback = {}) {
  const block = source.match(CONFIG_BLOCK)?.[0];
  if (!block) return validateConfig({}, fallback);
  const values = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*\*\s*@([a-z]+)(?:\s+(.*?))?\s*$/i);
    if (!match) continue;
    const [, key, raw = ''] = match;
    if (key !== 'tinypanel' && Object.hasOwn(CONFIG_DEFAULTS, key)) values[key] = raw;
  }
  return validateConfig(values, fallback);
}

function configBlock(config) {
  return `/**\n * @tinypanel\n * @name ${config.name}\n * @description ${config.description}\n * @width ${config.width}\n * @height ${config.height}\n * @orientation ${config.orientation}\n * @fps ${config.fps}\n */`;
}

function writeConfig(source, values, fallback = {}) {
  const config = validateConfig(values, parseConfig(source, fallback));
  const block = configBlock(config);
  return { config, source: CONFIG_BLOCK.test(source) ? source.replace(CONFIG_BLOCK, block) : `${block}\n${source}` };
}

class AppLibrary extends EventEmitter {
  constructor(rootPath) {
    super();
    this.rootPath = rootPath;
    this.activeFile = path.join(rootPath, '.active-app');
    this.apps = new Map();
    this.revision = 1;
    this.updatedAt = new Date().toISOString();
    this._scan();
    if (!this.apps.size) throw new Error(`No applications found in ${rootPath}`);
    const persisted = fs.existsSync(this.activeFile) ? fs.readFileSync(this.activeFile, 'utf8').trim() : '';
    this.activeId = this.apps.has(persisted) ? persisted : this.apps.keys().next().value;
    for (const app of this.apps.values()) this._watch(app);
  }

  _watch(app) {
    fs.watchFile(app.sourcePath, { interval: 200, persistent: false }, () => this._reloadExternal(app));
  }

  _reloadExternal(app) {
    let source;
    try {
      source = fs.readFileSync(app.sourcePath, 'utf8');
      if (source === app.source) return;
      if (source.length > 256 * 1024) throw new TypeError('source must be no larger than 256 KiB');
      compile(source, app.sourcePath);
      const config = parseConfig(source, app.config);
      app.source = source;
      app.config = config;
      if (app.id === this.activeId) this.revision++;
      this.updatedAt = new Date().toISOString();
      this.emit('change', {
        type: 'external-change', id: app.id, active: app.id === this.activeId,
        revision: this.revision, updatedAt: this.updatedAt,
      });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      this.emit('change', {
        type: 'external-error', id: app.id, active: app.id === this.activeId,
        message: error.message, stack: error.stack,
      });
    }
  }

  close() {
    for (const app of this.apps.values()) fs.unwatchFile(app.sourcePath);
  }

  _scan() {
    fs.mkdirSync(this.rootPath, { recursive: true });
    this.apps.clear();
    for (const entry of fs.readdirSync(this.rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !APP_ID.test(entry.name)) continue;
      const directory = path.join(this.rootPath, entry.name);
      const manifestPath = path.join(directory, 'manifest.json');
      const sourcePath = path.join(directory, 'main.canvas.js');
      if (!fs.existsSync(sourcePath)) continue;
      const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
      if (manifest.id && manifest.id !== entry.name) continue;
      const source = fs.readFileSync(sourcePath, 'utf8');
      compile(source, sourcePath);
      const config = parseConfig(source, { ...manifest, name: manifest.name || entry.name });
      this.apps.set(entry.name, { id: entry.name, config, sourcePath, source });
    }
  }

  get active() {
    return this.apps.get(this.activeId);
  }

  get source() { return this.active.source; }
  get sourcePath() { return this.active.sourcePath; }

  list() {
    return Array.from(this.apps.values(), (app) => ({
      id: app.id,
      ...app.config,
      active: app.id === this.activeId,
    }));
  }

  describe() {
    return {
      app: { id: this.active.id, ...this.active.config },
      source: this.source,
      revision: this.revision,
      updatedAt: this.updatedAt,
    };
  }

  activate(id) {
    if (!this.apps.has(id)) throw new RangeError(`Unknown application: ${id}`);
    if (id !== this.activeId) {
      this.activeId = id;
      fs.writeFileSync(this.activeFile, `${id}\n`);
      this.revision++;
      this.updatedAt = new Date().toISOString();
    }
    return this.describe();
  }

  update(source) {
    if (typeof source !== 'string' || source.length > 256 * 1024) {
      throw new TypeError('source must be a string no larger than 256 KiB');
    }
    compile(source, this.sourcePath);
    fs.writeFileSync(this.sourcePath, source);
    this.active.source = source;
    this.active.config = parseConfig(source, this.active.config);
    this.revision++;
    this.updatedAt = new Date().toISOString();
    return this.describe();
  }

  updateMetadata(id, { name, description }) {
    const app = this.apps.get(id);
    if (!app) throw new RangeError(`Unknown application: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('name is required');
    if (name.trim().length > 100) throw new TypeError('name must be no longer than 100 characters');
    if (typeof description !== 'string') throw new TypeError('description must be a string');
    if (description.length > 500) throw new TypeError('description must be no longer than 500 characters');

    const updated = writeConfig(app.source, { name, description }, app.config);
    compile(updated.source, app.sourcePath);
    fs.writeFileSync(app.sourcePath, updated.source);
    app.source = updated.source;
    app.config = updated.config;
    if (id === this.activeId) {
      this.revision++;
      this.updatedAt = new Date().toISOString();
    }
    return { id, ...app.config, active: id === this.activeId };
  }

  updateConfig(id, values) {
    const app = this.apps.get(id);
    if (!app) throw new RangeError(`Unknown application: ${id}`);
    const updated = writeConfig(app.source, values, app.config);
    compile(updated.source, app.sourcePath);
    fs.writeFileSync(app.sourcePath, updated.source);
    app.source = updated.source;
    app.config = updated.config;
    this.revision++;
    this.updatedAt = new Date().toISOString();
    return { id, ...app.config, active: id === this.activeId };
  }

  create({ id, name, description = '', source = DEFAULT_SOURCE }) {
    if (!APP_ID.test(id)) throw new TypeError('id must match [a-z0-9][a-z0-9-]{0,63}');
    if (this.apps.has(id)) throw new Error(`Application already exists: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('name is required');
    const configured = writeConfig(source, { name: name.trim(), description: String(description) });
    compile(configured.source, `${id}/main.canvas.js`);
    const directory = path.join(this.rootPath, id);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'main.canvas.js'), configured.source);
    const app = { id, config: configured.config, sourcePath: path.join(directory, 'main.canvas.js'), source: configured.source };
    this.apps.set(id, app);
    this._watch(app);
    return this.activate(id);
  }
}

module.exports = { AppLibrary, APP_ID, DEFAULT_SOURCE, parseConfig, writeConfig };
