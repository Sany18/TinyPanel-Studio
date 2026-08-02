'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { HardwareProfileService, DEFAULT_PROFILE } = require('../src/hardwareProfile');

test('persists a validated hardware profile and generates firmware macros', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tinypanel-hardware-'));
  try {
    const service = new HardwareProfileService(directory);
    const result = service.update({
      ...DEFAULT_PROFILE,
      display: 'st7789', width: 240, height: 240,
      pins: { ...DEFAULT_PROFILE.pins, backlight: 5 },
    });
    assert.equal(result.profile.width, 240);
    assert.equal(service.environment(), 'esp32-c3-super-mini');
    const header = fs.readFileSync(path.join(directory, 'hardware_config.h'), 'utf8');
    assert.match(header, /TP_DISPLAY_ST7789 1/);
    assert.match(header, /TP_TFT_BACKLIGHT 5/);
    assert.match(header, /TP_SERVER_HOST "192\.170\.60\.234"/);
    assert.match(header, /TP_SERVER_PORT 8765/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('validates display server address and port', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tinypanel-hardware-'));
  try {
    const service = new HardwareProfileService(directory);
    const result = service.update({ ...DEFAULT_PROFILE, serverHost: 'studio.local', serverPort: 9000 });
    assert.equal(result.profile.serverHost, 'studio.local');
    assert.equal(result.profile.serverPort, 9000);
    assert.throws(() => service.update({ ...DEFAULT_PROFILE, serverHost: 'bad host', serverPort: 8765 }), /Server host/);
    assert.throws(() => service.update({ ...DEFAULT_PROFILE, serverPort: 70000 }), /Server port/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('rejects conflicting required display pins', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tinypanel-hardware-'));
  try {
    const service = new HardwareProfileService(directory);
    assert.throws(() => service.update({
      ...DEFAULT_PROFILE, pins: { ...DEFAULT_PROFILE.pins, dc: DEFAULT_PROFILE.pins.cs },
    }), /must be unique/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('stores Wi-Fi credentials without exposing the password through describe()', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tinypanel-hardware-'));
  try {
    const service = new HardwareProfileService(directory);
    const result = service.update({
      ...DEFAULT_PROFILE,
      wifi: { ssid: 'Studio WiFi', password: 'secret-pass' },
    });
    assert.deepEqual(result.wifi, { ssid: 'Studio WiFi', configured: true });
    assert.doesNotMatch(JSON.stringify(result), /secret-pass/);
    assert.match(fs.readFileSync(path.join(directory, 'secrets.h'), 'utf8'), /WIFI_PASSWORD "secret-pass"/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
