'use strict';

const net = require('net');
const path = require('path');
const { runSynthwave, runHtmlProgram, runCanvasProgram } = require('./server');
const { HtmlProgram } = require('./programs/htmlProgram');
const { LiveCanvasProgram } = require('./apps/liveApp');
const { AppLibrary } = require('./apps/appLibrary');
const { FirmwareService, SerialMonitorService } = require('./firmwareService');
const { CryptoTrackerData } = require('./data/cryptoTrackerData');
const { DeviceRegistry } = require('./deviceRegistry');

const PORT = process.env.DISPLAY_SERVER_PORT ? Number(process.env.DISPLAY_SERVER_PORT) : 8765;
const PROGRAM = process.env.DISPLAY_SERVER_PROGRAM || 'synthwave'; // 'synthwave' | 'canvas' | 'html'
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
  const appLibrary = new AppLibrary(path.join(__dirname, '..', 'apps'));
  const cryptoTrackerData = new CryptoTrackerData();
  const firmwareProjectDir = path.join(__dirname, '..', '..', 'firmware', 'display-client');
  const firmwareService = new FirmwareService({ projectDir: firmwareProjectDir });
  const serialMonitor = new SerialMonitorService({
    projectDir: firmwareProjectDir,
    port: process.env.DISPLAY_SERIAL_PORT || '/dev/cu.usbmodem11321401',
  });
  let htmlProgram = null;
  if (PROGRAM === 'html') {
    htmlProgram = new HtmlProgram(HTML_PATH);
    console.log(`launching Puppeteer for ${HTML_PATH}...`);
    await htmlProgram.start();
    console.log('Puppeteer ready');
  }

  const server = net.createServer((socket) => {
    const device = registry.register(socket);
    device.program = PROGRAM;
    console.log(`client connected: ${socket.remoteAddress}:${socket.remotePort} (id=${device.id})`);
    if (htmlProgram) {
      runHtmlProgram(socket, htmlProgram, { device, registry });
    } else if (PROGRAM === 'canvas') {
      const canvasProgram = new LiveCanvasProgram(appLibrary, {
        dataProvider: (manifest) => manifest.dataSource === 'crypto-tracker'
          ? cryptoTrackerData.getSnapshot(manifest.settings) : null,
      });
      device.programController = canvasProgram;
      runCanvasProgram(socket, canvasProgram, { device, registry });
    } else {
      runSynthwave(socket, { device, registry });
    }
  });

  server.listen(PORT, () => {
    console.log(`display_server listening on :${PORT} (program=${PROGRAM})`);
  });

  if (DEBUG_PORT) {
    require('./debugServer').startDebugServer(DEBUG_PORT, registry, {
      appLibrary, firmwareService, serialMonitor,
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
