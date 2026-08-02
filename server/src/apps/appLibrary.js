'use strict';

const fs = require('fs');
const path = require('path');
const { compile } = require('./liveApp');

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_SOURCE = `function render(ctx, state) {
  ctx.clear('#000000');
  ctx.fillStyle = '#40e0ff';
  ctx.fillRect(state.frame % 152, 56, 8, 16);
}
`;

class AppLibrary {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.activeFile = path.join(rootPath, '.active-app');
    this.apps = new Map();
    this.revision = 1;
    this.updatedAt = new Date().toISOString();
    this._scan();
    if (!this.apps.size) throw new Error(`No applications found in ${rootPath}`);
    const persisted = fs.existsSync(this.activeFile) ? fs.readFileSync(this.activeFile, 'utf8').trim() : '';
    this.activeId = this.apps.has(persisted) ? persisted : this.apps.keys().next().value;
  }

  _scan() {
    fs.mkdirSync(this.rootPath, { recursive: true });
    this.apps.clear();
    for (const entry of fs.readdirSync(this.rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !APP_ID.test(entry.name)) continue;
      const directory = path.join(this.rootPath, entry.name);
      const manifestPath = path.join(directory, 'manifest.json');
      const sourcePath = path.join(directory, 'main.canvas.js');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(sourcePath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.id !== entry.name || typeof manifest.name !== 'string') continue;
      const source = fs.readFileSync(sourcePath, 'utf8');
      compile(source, sourcePath);
      this.apps.set(entry.name, { id: entry.name, manifest, sourcePath, source });
    }
  }

  get active() {
    return this.apps.get(this.activeId);
  }

  get source() { return this.active.source; }
  get sourcePath() { return this.active.sourcePath; }

  list() {
    return Array.from(this.apps.values(), (app) => ({
      ...app.manifest,
      active: app.id === this.activeId,
    }));
  }

  describe() {
    return {
      app: this.active.manifest,
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
    this.revision++;
    this.updatedAt = new Date().toISOString();
    return this.describe();
  }

  create({ id, name, description = '', source = DEFAULT_SOURCE }) {
    if (!APP_ID.test(id)) throw new TypeError('id must match [a-z0-9][a-z0-9-]{0,63}');
    if (this.apps.has(id)) throw new Error(`Application already exists: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('name is required');
    compile(source, `${id}/main.canvas.js`);
    const directory = path.join(this.rootPath, id);
    fs.mkdirSync(directory);
    const manifest = { id, name: name.trim(), description: String(description) };
    fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'main.canvas.js'), source);
    this.apps.set(id, { id, manifest, sourcePath: path.join(directory, 'main.canvas.js'), source });
    return this.activate(id);
  }
}

module.exports = { AppLibrary, APP_ID, DEFAULT_SOURCE };
