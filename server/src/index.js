'use strict';

const net = require('net');
const path = require('path');
const {
  runSynthwave, runHtmlProgram, runCanvasProgram, runVideoProgram,
  setDisplayRotation, orientationToRotation,
} = require('./server');
const { HtmlProgram } = require('./programs/htmlProgram');
const { LiveCanvasProgram } = require('./apps/liveApp');
const { AppLibrary } = require('./apps/appLibrary');
const { FirmwareService, SerialMonitorService, LogStream } = require('./firmwareService');
const { DeviceRegistry } = require('./deviceRegistry');
const { VideoProgram } = require('./programs/videoProgram');
const { HardwareProfileService } = require('./hardwareProfile');
const { createVirtualDevice } = require('./virtualDevice');
const { BinancePositionData } = require('./data/binancePositionData');

const PORT = process.env.DISPLAY_SERVER_PORT ? Number(process.env.DISPLAY_SERVER_PORT) : 8765;
// Device Studio manages Canvas apps, so its normal startup mode must render
// the selected app. Legacy renderers remain available through explicit npm
// scripts / DISPLAY_SERVER_PROGRAM overrides.
const PROGRAM = process.env.DISPLAY_SERVER_PROGRAM || 'canvas'; // 'synthwave' | 'canvas' | 'html' | 'video'
const HTML_PATH = process.env.DISPLAY_SERVER_HTML_PATH
  || path.join(__dirname, '..', 'pages', 'clock.html');
// On by default (negligible idle cost - see debugServer.js). Set
// DISPLAY_SERVER_DEBUG_PORT=0 (or "off") to disable, or to a different port
// to override the default.
const DEBUG_PORT_RAW = process.env.DISPLAY_SERVER_DEBUG_PORT;
const DEBUG_PORT = DEBUG_PORT_RAW === '0' || DEBUG_PORT_RAW === 'off'
  ? null
  : Number(DEBUG_PORT_RAW || 8766);

async function main() {
  const registry = new DeviceRegistry();
  const appLibrary = new AppLibrary(path.join(__dirname, '..', '..', 'apps'));
  setDisplayRotation(orientationToRotation(appLibrary.active.config.orientation));
  appLibrary.on('change', (event) => {
    if (event.type === 'external-change' && event.active) {
      setDisplayRotation(orientationToRotation(appLibrary.active.config.orientation));
    }
  });
  const firmwareProjectDir = path.join(__dirname, '..', '..', 'firmware', 'display-client');
  const hardwareProfile = new HardwareProfileService(firmwareProjectDir);
  const firmwareService = new FirmwareService({
    projectDir: firmwareProjectDir,
    env: () => hardwareProfile.environment(),
  });
  const serialMonitor = new SerialMonitorService({
    projectDir: firmwareProjectDir,
    port: process.env.DISPLAY_SERIAL_PORT || null,
  });
  const appLog = new LogStream(500);
  // Feeds the crypto-tracker app's biggest open Binance position in as
  // state.data (see liveApp.js's dataProvider) - signing an authenticated
  // Binance request needs Node's crypto module, which the app's sandboxed vm
  // context deliberately doesn't have, so the signed poll has to live here.
  const binancePosition = new BinancePositionData({
    secretsPath: path.join(__dirname, '..', '..', 'apps', 'crypto-tracker', 'secrets.h'),
    symbol: 'BTCUSDT', // matches crypto-tracker's own hardcoded SYMBOL/chart
  });
  let htmlProgram = null;
  let videoProgram = null;
  if (PROGRAM === 'html') {
    htmlProgram = new HtmlProgram(HTML_PATH);
    console.log(`launching Puppeteer for ${HTML_PATH}...`);
    await htmlProgram.start();
    console.log('Puppeteer ready');
  }
  if (PROGRAM === 'video') {
    videoProgram = new VideoProgram({
      source: process.env.DISPLAY_VIDEO_SOURCE || null,
      fps: process.env.DISPLAY_VIDEO_FPS || 20,
    });
    videoProgram.start();
    console.log(`video stream ready (${process.env.DISPLAY_VIDEO_SOURCE || 'generated test pattern'})`);
  }

  function attachClient(socket) {
    const device = registry.register(socket);
    device.program = PROGRAM;
    console.log(`client connected: ${socket.remoteAddress}:${socket.remotePort} (id=${device.id})`);
    if (videoProgram) {
      runVideoProgram(socket, videoProgram, { device, registry });
    } else if (htmlProgram) {
      runHtmlProgram(socket, htmlProgram, { device, registry });
    } else if (PROGRAM === 'canvas') {
      const canvasProgram = new LiveCanvasProgram(appLibrary, {
        log: appLog,
        dataProvider: (app) => (app.id === 'crypto-tracker' ? binancePosition.getSnapshot() : null),
      });
      device.programController = canvasProgram;
      runCanvasProgram(socket, canvasProgram, {
        device,
        registry,
        frameIntervalMs: () => 1000 / appLibrary.active.config.fps,
      });
    } else {
      runSynthwave(socket, { device, registry });
    }
    return device;
  }

  const server = net.createServer(attachClient);

  server.listen(PORT, () => {
    console.log(`display_server listening on :${PORT} (program=${PROGRAM})`);
  });

  // Debugging without real hardware: a virtual device is a fake socket (see
  // virtualDevice.js) run through the exact same attachClient() path a real
  // ESP32's net.Socket goes through, so it registers, streams, and shows up
  // in the debug/preview viewers identically - just with no physical panel
  // on the other end. Toggled from Device Studio (see debugServer.js's
  // /api/devices/simulate), not started automatically.
  let virtualDeviceSocket = null;
  const virtualDevice = {
    active: () => Boolean(virtualDeviceSocket),
    start() {
      if (virtualDeviceSocket) return registry.get('sim');
      const socket = createVirtualDevice();
      virtualDeviceSocket = socket;
      socket.on('close', () => {
        if (virtualDeviceSocket === socket) virtualDeviceSocket = null;
      });
      const device = attachClient(socket);
      device.simulated = true;
      return device;
    },
    stop() {
      if (!virtualDeviceSocket) return false;
      virtualDeviceSocket.destroy();
      return true;
    },
  };

  if (DEBUG_PORT) {
    require('./debugServer').startDebugServer(DEBUG_PORT, registry, {
      appLibrary, firmwareService, serialMonitor, appLog, hardwareProfile, virtualDevice,
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
