'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AppLibrary } = require('../src/apps/appLibrary');

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
    library.activate('first-app');
    assert.equal(library.activeId, 'first-app');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('rejects unsafe IDs and invalid source without creating an app', () => {
  const { root, library } = createLibrary();
  try {
    assert.throws(() => library.create({ id: '../escape', name: 'Bad' }), /id must match/);
    assert.throws(() => library.create({ id: 'broken', name: 'Broken', source: 'nope' }), /not defined|must define function render/);
    assert.equal(fs.existsSync(path.join(root, 'broken')), false);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
