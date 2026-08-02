'use strict';

const net = require('net');
const path = require('path');
const {
  runSynthwave, runHtmlProgram, runCanvasProgram, runVideoProgram, setDisplayRotation,
} = require('./server');
const { HtmlProgram } = require('./programs/htmlProgram');
const { LiveCanvasProgram } = require('./apps/liveApp');
const { AppLibrary } = require('./apps/appLibrary');
const { FirmwareService, SerialMonitorService, LogStream } = require('./firmwareService');
const { DeviceRegistry } = require('./deviceRegistry');
const { VideoProgram } = require('./programs/videoProgram');
const { HardwareProfileService } = require('./hardwareProfile');

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
  appLibrary.on('change', (event) => {
    if (event.type === 'external-change' && event.active) {
      setDisplayRotation(appLibrary.active.config.orientation === 'landscape-reversed' ? 1 : 3);
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

  const server = net.createServer((socket) => {
    const device = registry.register(socket);
    device.program = PROGRAM;
    console.log(`client connected: ${socket.remoteAddress}:${socket.remotePort} (id=${device.id})`);
    if (videoProgram) {
      runVideoProgram(socket, videoProgram, { device, registry });
    } else if (htmlProgram) {
      runHtmlProgram(socket, htmlProgram, { device, registry });
    } else if (PROGRAM === 'canvas') {
      const canvasProgram = new LiveCanvasProgram(appLibrary, { log: appLog });
      device.programController = canvasProgram;
      runCanvasProgram(socket, canvasProgram, {
        device,
        registry,
        frameIntervalMs: () => 1000 / appLibrary.active.config.fps,
      });
    } else {
      runSynthwave(socket, { device, registry });
    }
  });

  server.listen(PORT, () => {
    console.log(`display_server listening on :${PORT} (program=${PROGRAM})`);
  });

  if (DEBUG_PORT) {
    require('./debugServer').startDebugServer(DEBUG_PORT, registry, {
      appLibrary, firmwareService, serialMonitor, appLog, hardwareProfile,
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
