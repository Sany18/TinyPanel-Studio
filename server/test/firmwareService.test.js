'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { FirmwareService, SerialMonitorService } = require('../src/firmwareService');

function fakeSpawn(calls) {
  return (command, args) => {
    calls.push([command, ...args]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true; };
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
}

test('archives a successful firmware build with semantic version and build ID', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'display-firmware-'));
  try {
    fs.writeFileSync(path.join(projectDir, 'version.json'), '{"version":"1.2.3"}');
    const binaryDir = path.join(projectDir, '.pio', 'build', 'test-env');
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(path.join(binaryDir, 'firmware.bin'), Buffer.from([1, 2, 3]));
    const calls = [];
    const service = new FirmwareService({ projectDir, env: 'test-env', spawnImpl: fakeSpawn(calls) });
    const result = await service.build();
    assert.equal(result.build.version, '1.2.3');
    assert.equal(result.build.bytes, 3);
    assert.equal(fs.existsSync(path.join(projectDir, 'firmware-builds', result.build.filename)), true);
    assert.deepEqual(calls[0], ['pio', 'run', '-e', 'test-env']);
  } finally {
    fs.rmSync(projectDir, { recursive: true });
  }
});

test('serial monitor is opt-in and uses an explicit port and baud', () => {
  const calls = [];
  const monitor = new SerialMonitorService({
    projectDir: '/tmp/project', port: '/dev/cu.test', baud: 115200, spawnImpl: fakeSpawn(calls),
  });
  assert.equal(monitor.describe().running, false);
  assert.equal(monitor.start().running, true);
  assert.equal(calls[0][0], '/usr/bin/python3');
  assert.match(calls[0][1], /scripts\/serial_monitor\.py$/);
  assert.deepEqual(calls[0].slice(2), ['/dev/cu.test', '115200']);
  assert.equal(monitor.stop().stopping, true);
});
