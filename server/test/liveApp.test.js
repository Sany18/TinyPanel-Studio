'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LiveAppStore, LiveCanvasProgram } = require('../src/apps/liveApp');

function withStore(source, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'display-live-app-'));
  const sourcePath = path.join(directory, 'live.canvas.js');
  fs.writeFileSync(sourcePath, source);
  try { return run(new LiveAppStore(sourcePath)); }
  finally { fs.rmSync(directory, { recursive: true }); }
}

test('validates updates before persisting or incrementing revision', () => {
  withStore('function render(ctx) { ctx.clear(0); }', (store) => {
    assert.throws(() => store.update('const nope = true;'), /must define function render/);
    assert.equal(store.revision, 1);
    assert.match(fs.readFileSync(store.sourcePath, 'utf8'), /function render/);
    store.update('function render(ctx) { ctx.clear("#ff0000"); }');
    assert.equal(store.revision, 2);
  });
});

test('hot reloads a new revision and rolls back pixels after runtime errors', () => {
  withStore('function render(ctx) { ctx.clear("#000000"); }', (store) => {
    const program = new LiveCanvasProgram(store);
    program.nextFrame();
    store.update('function render(ctx) { ctx.clear("#ff0000"); throw new Error("boom"); }');
    const before = program.renderer.current.pixels.slice();
    program.nextFrame();
    assert.deepEqual(program.renderer.current.pixels, before);
    assert.match(program.lastError.message, /boom/);
  });
});

test('forwards application console output to the debug log', () => {
  withStore('function render(ctx, state) { console.log("frame", state.frame); ctx.clear(0); }', (store) => {
    const entries = [];
    const program = new LiveCanvasProgram(store, { log: { write: (channel, line) => entries.push({ channel, line }) } });
    program.nextFrame();
    assert.deepEqual(entries, [{ channel: 'log', line: 'frame 0' }]);
  });
});

test('exposes fetch to Canvas applications for background data loading', () => {
  withStore('function render(ctx) { fetch("https://example.test/data"); ctx.clear(0); }', (store) => {
    const calls = [];
    const program = new LiveCanvasProgram(store, {
      fetchImpl: (url) => { calls.push(url); return Promise.resolve({ ok: true }); },
    });
    program.nextFrame();
    assert.deepEqual(calls, ['https://example.test/data']);
  });
});
