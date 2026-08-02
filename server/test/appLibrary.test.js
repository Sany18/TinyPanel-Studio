'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { AppLibrary, parseConfig } = require('../src/apps/appLibrary');

function createLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'display-app-library-'));
  const appDir = path.join(root, 'first-app');
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify({ id: 'first-app', name: 'First App' }));
  fs.writeFileSync(path.join(appDir, 'main.canvas.js'), 'function render(ctx) { ctx.clear(0); }');
  return { root, library: new AppLibrary(root) };
}

test('discovers, creates, activates and edits Canvas applications', () => {
  const { root, library } = createLibrary();
  try {
    assert.equal(library.activeId, 'first-app');
    const created = library.create({ id: 'second-app', name: 'Second App' });
    assert.equal(created.app.id, 'second-app');
    assert.equal(library.list().length, 2);
    library.update('function render(ctx) { ctx.clear("#ff0000"); }');
    assert.match(fs.readFileSync(path.join(root, 'second-app', 'main.canvas.js'), 'utf8'), /ff0000/);
    library.updateMetadata('second-app', { name: 'Renamed App', description: 'Updated description' });
    assert.equal(library.list().find((app) => app.id === 'second-app').name, 'Renamed App');
    const savedSource = fs.readFileSync(path.join(root, 'second-app', 'main.canvas.js'), 'utf8');
    assert.match(savedSource, /@name Renamed App/);
    assert.match(savedSource, /@description Updated description/);
    assert.equal(fs.existsSync(path.join(root, 'second-app', 'manifest.json')), false);
    library.activate('first-app');
    assert.equal(library.activeId, 'first-app');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('discovers metadata-free apps and persists display settings in JSDoc', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'display-app-config-'));
  const appDir = path.join(root, 'configured-app');
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(appDir, 'main.canvas.js'), `/**
 * @tinypanel
 * @name Configured App
 * @description No manifest required
 * @width 320
 * @height 240
 * @orientation landscape-reversed
 * @fps 12
 */
function render(ctx) { ctx.clear(0); }
`);
  try {
    const library = new AppLibrary(root);
    assert.equal(library.active.config.fps, 12);
    assert.equal(library.list()[0].name, 'Configured App');
    library.updateConfig('configured-app', { fps: 1, orientation: 'landscape' });
    const source = fs.readFileSync(path.join(appDir, 'main.canvas.js'), 'utf8');
    assert.equal(parseConfig(source).fps, 1);
    assert.match(source, /@orientation landscape\n/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('rejects unsafe IDs and invalid source without creating an app', () => {
  const { root, library } = createLibrary();
  try {
    assert.throws(() => library.create({ id: '../escape', name: 'Bad' }), /id must match/);
    assert.throws(() => library.create({ id: 'broken', name: 'Broken', source: 'nope' }), /not defined|must define function render/);
    assert.throws(() => library.updateMetadata('first-app', { name: ' ', description: '' }), /name is required/);
    assert.throws(() => library.updateMetadata('first-app', { name: 'Valid', description: 'x'.repeat(501) }), /500/);
    assert.equal(fs.existsSync(path.join(root, 'broken')), false);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('hot reloads valid external source edits and reports invalid ones', async () => {
  const { root, library } = createLibrary();
  const sourcePath = path.join(root, 'first-app', 'main.canvas.js');
  try {
    const changed = once(library, 'change');
    fs.writeFileSync(sourcePath, 'function render(ctx) { ctx.clear("#123456"); }');
    const [changeEvent] = await changed;
    assert.equal(changeEvent.type, 'external-change');
    assert.equal(changeEvent.id, 'first-app');
    assert.match(library.source, /123456/);
    assert.equal(library.revision, 2);

    const failed = once(library, 'change');
    fs.writeFileSync(sourcePath, 'function render(ctx) {');
    const [errorEvent] = await failed;
    assert.equal(errorEvent.type, 'external-error');
    assert.equal(errorEvent.id, 'first-app');
    assert.match(library.source, /123456/);
    assert.equal(library.revision, 2);
  } finally {
    library.close();
    fs.rmSync(root, { recursive: true });
  }
});
