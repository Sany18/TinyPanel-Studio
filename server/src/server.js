'use strict';

const { EventEmitter } = require('events');
const { monitorEventLoopDelay } = require('perf_hooks');
const { FrameBuilder, ACK_BYTE } = require('./protocol');
const synthwave = require('./programs/synthwave');

// Emits a 'frame' event with the exact bytes written to the real client
// (see sendFrame below) - lets a debug viewer (src/debugServer.js) mirror
// precisely what's actually on the wire, not a re-derived approximation.
const frameBus = new EventEmitter();

// Lightweight diagnostics for periodic stalls.  A steadily growing heap
// followed by a large event-loop delay points at GC; a large ACK time with a
// healthy event loop points at WiFi/ESP32/SPI instead.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();
let totalFrames = 0;
let totalBytes = 0;
let lastBuildMs = 0;
let lastAckMs = 0;
let windowFrames = 0;
let windowAckCount = 0;
let windowAckTotalMs = 0;
let windowAckMaxMs = 0;
let metricsPrintedAt = performance.now();

setInterval(() => {
  const now = performance.now();
  const windowSeconds = (now - metricsPrintedAt) / 1000;
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const p99Ms = eventLoopDelay.percentile(99) / 1e6;
  const maxMs = eventLoopDelay.max / 1e6;
  const fps = windowFrames / windowSeconds;
  const ackAvgMs = windowAckCount ? windowAckTotalMs / windowAckCount : 0;
  console.log(
    `[perf] frames=${totalFrames} bytes=${totalBytes}`
    + ` heap=${heapMb.toFixed(1)}MB fps=${fps.toFixed(1)}`
    + ` build=${lastBuildMs.toFixed(1)}ms ack_last=${lastAckMs.toFixed(1)}ms`
    + ` ack_avg=${ackAvgMs.toFixed(1)}ms ack_max=${windowAckMaxMs.toFixed(1)}ms`
    + ` loop_p99=${p99Ms.toFixed(1)}ms`
    + ` loop_max=${maxMs.toFixed(1)}ms`,
  );
  metricsPrintedAt = now;
  windowFrames = 0;
  windowAckCount = 0;
  windowAckTotalMs = 0;
  windowAckMaxMs = 0;
  eventLoopDelay.reset();
}, 5000).unref();

// Lockstep frame-level ACK (see DISPLAY_PROTOCOL.md "Flow control"): never
// more than one frame in flight, so a program can't race ahead of what the
// ESP32 has actually drawn. produceFrame(isFirstFrame) may return a
// FrameBuilder synchronously or a Promise<FrameBuilder> - either way exactly
// one frame is built and sent per ACK.
function runLockstep(socket, produceFrame, options = {}) {
  const { device = null, registry = null } = options;
  let awaitingAck = false;
  let frameSentAt = 0;
  socket.setNoDelay(true);
  socket.on('error', (err) => console.error('socket error:', err.message));
  socket.on('close', () => {
    if (device && registry) registry.disconnect(device, socket);
    console.log(`client disconnected${device ? `: ${device.id}` : ''}`);
  });

  function sendFrame(buf) {
    awaitingAck = true;
    frameSentAt = performance.now();
    socket.write(buf);
    totalFrames++;
    totalBytes += buf.length;
    windowFrames++;
    if (device && registry) {
      registry.applyFrame(device, buf);
      registry.recordFrame(device, buf.length);
    }
    frameBus.emit('frame', { deviceId: device?.id || null, buf });
  }

  async function sendNextFrame(isFirstFrame) {
    const buildStartedAt = performance.now();
    const fb = await produceFrame(isFirstFrame);
    lastBuildMs = performance.now() - buildStartedAt;
    fb.frameEnd();
    sendFrame(fb.toBuffer());
  }

  socket.on('data', (chunk) => {
    for (const byte of chunk) {
      if (!awaitingAck || byte !== ACK_BYTE) {
        console.warn('unexpected byte from client (protocol desync?):', byte);
        continue;
      }
      lastAckMs = performance.now() - frameSentAt;
      windowAckCount++;
      windowAckTotalMs += lastAckMs;
      windowAckMaxMs = Math.max(windowAckMaxMs, lastAckMs);
      if (device && registry) registry.recordAck(device, lastAckMs);
      awaitingAck = false;
      sendNextFrame(false).catch((err) => console.error('frame build error:', err));
    }
  });

  sendNextFrame(true).catch((err) => console.error('frame build error:', err));
}

function runSynthwave(socket, options = {}) {
  let iteration = 1;
  runLockstep(socket, (isFirstFrame) => {
    const fb = new FrameBuilder();
    if (isFirstFrame) {
      synthwave.drawSky(fb);
      synthwave.drawGround(fb);
    } else {
      synthwave.drawGroundLines(fb, iteration);
      iteration++;
    }
    return fb;
  }, options);
}

// htmlProgram: an already-started HtmlProgram instance (see
// programs/htmlProgram.js) - caller starts it once, typically at server
// startup, and reuses it across reconnects. This only drives the
// per-connection frame loop and resets diff state for the new connection.
function runHtmlProgram(socket, htmlProgram, options = {}) {
  htmlProgram.resetDiff();
  runLockstep(socket, () => htmlProgram.nextFrame(), options);
}

function runCanvasProgram(socket, canvasProgram, options = {}) {
  runLockstep(socket, () => canvasProgram.nextFrame(), options);
}

module.exports = {
  runLockstep, runSynthwave, runHtmlProgram, runCanvasProgram, frameBus,
};
