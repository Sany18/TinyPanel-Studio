'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATALOG = Object.freeze({
  controllers: [
    { id: 'esp32-c3-super-mini', name: 'ESP32-C3 Super Mini', environment: 'esp32-c3-super-mini', maxPin: 21 },
    { id: 'esp32-s3-devkitc-1', name: 'ESP32-S3 DevKitC-1', environment: 'esp32-s3-devkitc-1', maxPin: 48 },
    { id: 'esp32-devkit-v1', name: 'ESP32 DevKit V1', environment: 'esp32-devkit-v1', maxPin: 39 },
  ],
  displays: [
    { id: 'st7735', name: 'ST7735 / ST7735S', defaultWidth: 160, defaultHeight: 128 },
    { id: 'st7789', name: 'ST7789', defaultWidth: 240, defaultHeight: 240 },
    { id: 'ili9341', name: 'ILI9341', defaultWidth: 320, defaultHeight: 240 },
  ],
  buses: [
    { id: 'hardware-spi', name: 'Hardware SPI' },
    { id: 'software-spi', name: 'Software SPI' },
  ],
});

const DEFAULT_PROFILE = Object.freeze({
  controller: 'esp32-c3-super-mini',
  display: 'st7735',
  bus: 'hardware-spi',
  width: 160,
  height: 128,
  rotation: 3,
  colorOrder: 'rgb',
  spiFrequency: 40000000,
  pins: { cs: 0, dc: 3, reset: 4, mosi: 2, sclk: 1, miso: -1, backlight: -1 },
});

class HardwareProfileService {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.profilePath = path.join(projectDir, 'hardware.json');
    this.headerPath = path.join(projectDir, 'hardware_config.h');
    this.secretsPath = path.join(projectDir, 'secrets.h');
    this.profile = fs.existsSync(this.profilePath)
      ? this.validate(JSON.parse(fs.readFileSync(this.profilePath, 'utf8')))
      : this.validate(DEFAULT_PROFILE);
    if (!fs.existsSync(this.profilePath)) {
      fs.writeFileSync(this.profilePath, `${JSON.stringify(this.profile, null, 2)}\n`);
    }
    this._writeHeader();
  }

  describe() {
    const wifi = this._readWifi();
    return {
      profile: this.profile,
      catalog: CATALOG,
      wifi: { ssid: wifi.ssid, configured: Boolean(wifi.ssid && wifi.password) },
    };
  }

  validate(value) {
    const controller = CATALOG.controllers.find((item) => item.id === value.controller);
    const display = CATALOG.displays.find((item) => item.id === value.display);
    if (!controller) throw new TypeError('Unsupported controller');
    if (!display) throw new TypeError('Unsupported display driver');
    if (!CATALOG.buses.some((item) => item.id === value.bus)) throw new TypeError('Unsupported display bus');
    const width = Number(value.width); const height = Number(value.height);
    if (!Number.isInteger(width) || width < 16 || width > 320
      || !Number.isInteger(height) || height < 16 || height > 320) throw new RangeError('Display size must be 16–320 pixels');
    const rotation = Number(value.rotation);
    if (![0, 1, 2, 3].includes(rotation)) throw new RangeError('Rotation must be 0–3');
    const spiFrequency = Number(value.spiFrequency);
    if (!Number.isInteger(spiFrequency) || spiFrequency < 1000000 || spiFrequency > 80000000) {
      throw new RangeError('SPI frequency must be 1–80 MHz');
    }
    const pins = {};
    for (const name of ['cs', 'dc', 'reset', 'mosi', 'sclk', 'miso', 'backlight']) {
      const pin = Number(value.pins?.[name]);
      if (!Number.isInteger(pin) || pin < -1 || pin > controller.maxPin) throw new RangeError(`${name} pin must be -1–${controller.maxPin}`);
      pins[name] = pin;
    }
    const required = ['cs', 'dc', 'mosi', 'sclk'];
    const used = required.map((name) => pins[name]);
    if (used.some((pin) => pin < 0)) throw new RangeError('CS, DC, MOSI and SCLK pins are required');
    if (new Set(used).size !== used.length) throw new RangeError('Required display pins must be unique');
    return {
      controller: controller.id, display: display.id, bus: value.bus,
      width, height, rotation, colorOrder: value.colorOrder === 'bgr' ? 'bgr' : 'rgb',
      spiFrequency, pins,
    };
  }

  update(value) {
    this.profile = this.validate(value);
    fs.writeFileSync(this.profilePath, `${JSON.stringify(this.profile, null, 2)}\n`);
    this._writeHeader();
    if (value.wifi) this._writeWifi(value.wifi);
    return this.describe();
  }

  _readWifi() {
    if (!fs.existsSync(this.secretsPath)) return { ssid: '', password: '' };
    const source = fs.readFileSync(this.secretsPath, 'utf8');
    const read = (name) => source.match(new RegExp(`#define\\s+${name}\\s+"((?:\\\\.|[^"\\\\])*)"`))?.[1]
      ?.replace(/\\"/g, '"').replace(/\\\\/g, '\\') || '';
    return { ssid: read('WIFI_SSID'), password: read('WIFI_PASSWORD') };
  }

  _writeWifi(value) {
    const current = this._readWifi();
    const ssid = String(value.ssid ?? current.ssid).trim();
    const password = value.password ? String(value.password) : current.password;
    if (!ssid || Buffer.byteLength(ssid) > 32) throw new RangeError('Wi-Fi SSID must be 1–32 bytes');
    if (!password || Buffer.byteLength(password) > 63) throw new RangeError('Wi-Fi password must be 1–63 bytes');
    const quote = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    fs.writeFileSync(this.secretsPath, `// Generated by TinyPanel Studio. This file is gitignored.\n\n#define WIFI_SSID     "${quote(ssid)}"\n#define WIFI_PASSWORD "${quote(password)}"\n`);
  }

  environment() {
    return CATALOG.controllers.find((item) => item.id === this.profile.controller).environment;
  }

  _writeHeader() {
    const p = this.profile;
    const macro = (value) => String(value).replace(/[^A-Z0-9]/gi, '_').toUpperCase();
    const header = `#pragma once
// Generated by TinyPanel Studio. Edit hardware.json or use Hardware Setup.
#define TP_CONTROLLER_${macro(p.controller)} 1
#define TP_DISPLAY_${macro(p.display)} 1
#define TP_BUS_${macro(p.bus)} 1
#define TP_TFT_WIDTH ${p.width}
#define TP_TFT_HEIGHT ${p.height}
#define TP_TFT_ROTATION ${p.rotation}
#define TP_COLOR_ORDER_${macro(p.colorOrder)} 1
#define TP_SPI_FREQUENCY ${p.spiFrequency}
#define TP_TFT_CS ${p.pins.cs}
#define TP_TFT_DC ${p.pins.dc}
#define TP_TFT_RST ${p.pins.reset}
#define TP_TFT_MOSI ${p.pins.mosi}
#define TP_TFT_SCLK ${p.pins.sclk}
#define TP_TFT_MISO ${p.pins.miso}
#define TP_TFT_BACKLIGHT ${p.pins.backlight}
`;
    fs.writeFileSync(this.headerPath, header);
  }
}

module.exports = { HardwareProfileService, CATALOG, DEFAULT_PROFILE };
