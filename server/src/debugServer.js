'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  frameBus, getCanvasFps, setCanvasFps, getDisplayRotation, setDisplayRotation,
  orientationToRotation,
} = require('./server');

const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };

function readJson(req, res, onValue) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 300 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      const result = onValue(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function rotationToOrientation(rotation) {
  return Number(rotation) === 1 ? 'landscape-reversed' : 'landscape';
}

// Opt-in HTTP+SSE viewer that mirrors the exact bytes sent to the real ESP32
// (see server.js's frameBus) into a browser <canvas>, decoded client-side
// with the same opcode logic the .ino's dispatch() uses - see debug/client.js.
// Not started unless explicitly requested (DISPLAY_SERVER_DEBUG_PORT).
function startDebugServer(port, registry, services = {}) {
  const server = http.createServer((req, res) => {
    try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/devices') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ devices: registry.list() }));
      return;
    }

    if (requestUrl.pathname === '/api/devices/simulate' && req.method === 'POST') {
      if (!isLoopback(req)) { json(res, 403, { error: 'simulated device requires localhost' }); return; }
      if (!services.virtualDevice) { json(res, 404, { error: 'virtual device unavailable' }); return; }
      json(res, 200, { device: registry.serialize(services.virtualDevice.start()) });
      return;
    }

    if (requestUrl.pathname === '/api/devices/simulate' && req.method === 'DELETE') {
      if (!isLoopback(req)) { json(res, 403, { error: 'simulated device requires localhost' }); return; }
      if (!services.virtualDevice) { json(res, 404, { error: 'virtual device unavailable' }); return; }
      json(res, 200, { stopped: services.virtualDevice.stop() });
      return;
    }

    if (requestUrl.pathname === '/api/debug/canvas-fps' && req.method === 'GET') {
      json(res, 200, { fps: getCanvasFps() });
      return;
    }

    if (requestUrl.pathname === '/api/debug/canvas-fps' && req.method === 'PUT') {
      readJson(req, res, ({ fps }) => ({ fps: setCanvasFps(fps) }));
      return;
    }

    if (requestUrl.pathname === '/api/debug/display-settings' && req.method === 'GET') {
      const config = services.appLibrary?.active?.config;
      json(res, 200, {
        fps: config?.fps ?? getCanvasFps(),
        rotation: config ? orientationToRotation(config.orientation) : getDisplayRotation(),
      });
      return;
    }

    if (requestUrl.pathname === '/api/debug/display-settings' && req.method === 'PUT') {
      readJson(req, res, ({ fps, rotation }) => {
        const config = services.appLibrary?.active?.config;
        if (!config) return {
          fps: fps === undefined ? getCanvasFps() : setCanvasFps(fps),
          rotation: rotation === undefined ? getDisplayRotation() : setDisplayRotation(rotation),
        };
        const values = {};
        if (fps !== undefined) values.fps = fps;
        if (rotation !== undefined) values.orientation = rotationToOrientation(rotation);
        const updated = Object.keys(values).length
          ? services.appLibrary.updateConfig(services.appLibrary.activeId, values)
          : config;
        setCanvasFps(updated.fps);
        setDisplayRotation(orientationToRotation(updated.orientation));
        return { fps: updated.fps, rotation: orientationToRotation(updated.orientation) };
      });
      return;
    }

    if (requestUrl.pathname === '/api/firmware' && req.method === 'GET') {
      json(res, 200, services.firmwareService?.describe() || { unavailable: true });
      return;
    }

    if (requestUrl.pathname === '/api/hardware' && req.method === 'GET') {
      json(res, 200, services.hardwareProfile?.describe() || { unavailable: true });
      return;
    }

    if (requestUrl.pathname === '/api/hardware' && req.method === 'PUT') {
      if (!isLoopback(req)) { json(res, 403, { error: 'hardware configuration requires localhost' }); return; }
      if (!services.hardwareProfile) { json(res, 404, { error: 'hardware configuration unavailable' }); return; }
      readJson(req, res, (value) => services.hardwareProfile.update(value));
      return;
    }

    if ((requestUrl.pathname === '/api/firmware/build' || requestUrl.pathname === '/api/firmware/flash')
        && req.method === 'POST') {
      if (!isLoopback(req)) { json(res, 403, { error: 'firmware operations require localhost' }); return; }
      if (!services.firmwareService) { json(res, 404, { error: 'firmware service unavailable' }); return; }
      const operation = requestUrl.pathname.endsWith('/build') ? 'build' : 'flash';
      if (operation === 'flash') services.serialMonitor?.stop();
      services.firmwareService[operation]().then(
        (result) => json(res, 200, result),
        (error) => json(res, 500, { error: error.message }),
      );
      return;
    }

    if (requestUrl.pathname === '/api/serial' && req.method === 'GET') {
      json(res, 200, services.serialMonitor?.describe() || { unavailable: true });
      return;
    }

    if ((requestUrl.pathname === '/api/serial/start' || requestUrl.pathname === '/api/serial/stop')
        && req.method === 'POST') {
      if (!isLoopback(req)) { json(res, 403, { error: 'serial monitor requires localhost' }); return; }
      if (!services.serialMonitor) { json(res, 404, { error: 'serial monitor unavailable' }); return; }
      const operation = requestUrl.pathname.endsWith('/start') ? 'start' : 'stop';
      json(res, 200, services.serialMonitor[operation]());
      return;
    }

    if (requestUrl.pathname === '/api/debug/logs') {
      const sourceName = requestUrl.searchParams.get('source');
      const source = sourceName === 'serial' ? services.serialMonitor?.log
        : sourceName === 'app' ? services.appLog : services.firmwareService?.log;
      if (!source) { res.writeHead(404); res.end('log unavailable'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      });
      for (const entry of source.lines) res.write(`data: ${JSON.stringify(entry)}\n\n`);
      const onLine = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
      source.on('line', onLine);
      req.on('close', () => source.off('line', onLine));
      return;
    }

    if (requestUrl.pathname === '/api/apps' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ apps: services.appLibrary?.list() || [], activeId: services.appLibrary?.activeId || null }));
      return;
    }

    if (requestUrl.pathname === '/api/apps/events' && req.method === 'GET') {
      if (!services.appLibrary) { res.writeHead(404); res.end('app library unavailable'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);
      const onChange = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      services.appLibrary.on('change', onChange);
      req.on('close', () => services.appLibrary.off('change', onChange));
      return;
    }

    if (requestUrl.pathname === '/api/apps' && req.method === 'POST') {
      if (!services.appLibrary) { res.writeHead(404); res.end('app library unavailable'); return; }
      readJson(req, res, (value) => services.appLibrary.create(value));
      return;
    }

    const metadataMatch = requestUrl.pathname.match(/^\/api\/apps\/([a-z0-9-]+)$/);
    if (metadataMatch && req.method === 'PUT') {
      if (!services.appLibrary) { res.writeHead(404); res.end('app library unavailable'); return; }
      readJson(req, res, (value) => services.appLibrary.updateMetadata(metadataMatch[1], value));
      return;
    }

    const activateMatch = requestUrl.pathname.match(/^\/api\/apps\/([a-z0-9-]+)\/activate$/);
    if (activateMatch && req.method === 'POST') {
      if (!services.appLibrary) { res.writeHead(404); res.end('app library unavailable'); return; }
      try {
        const result = services.appLibrary.activate(activateMatch[1]);
        setCanvasFps(result.app.fps);
        setDisplayRotation(orientationToRotation(result.app.orientation));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (requestUrl.pathname === '/api/apps/live/source' && req.method === 'GET') {
      if (!services.appLibrary) {
        res.writeHead(404); res.end('live app unavailable'); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(services.appLibrary.describe()));
      return;
    }

    if (requestUrl.pathname === '/api/apps/live/source' && req.method === 'PUT') {
      if (!services.appLibrary) {
        res.writeHead(404); res.end('live app unavailable'); return;
      }
      readJson(req, res, ({ source }) => services.appLibrary.update(source));
      return;
    }

    if (requestUrl.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');

      // Live-only: retaining every prior frame caused unbounded RAM growth.
      // Seed a late viewer from one bounded current-frame snapshot.
      const requestedDevice = requestUrl.searchParams.get('device');
      if (requestedDevice) {
        const device = registry.get(requestedDevice);
        if (device) {
          const snapshot = device.framebuffer.snapshotFrame();
          res.write(`event: frame\ndata: ${JSON.stringify({ deviceId: requestedDevice, frame: snapshot.toString('base64'), snapshot: true })}\n\n`);
        }
      }
      const onFrame = ({ deviceId, buf }) => {
        if (!requestedDevice || requestedDevice === deviceId) {
          res.write(`event: frame\ndata: ${JSON.stringify({ deviceId, frame: buf.toString('base64') })}\n\n`);
        }
      };
      frameBus.on('frame', onFrame);
      req.on('close', () => frameBus.off('frame', onFrame));
      return;
    }

    const file = requestUrl.pathname === '/' ? 'index.html'
      : requestUrl.pathname === '/preview' ? 'preview.html'
        : requestUrl.pathname.slice(1);
    const filePath = path.join(DEBUG_DIR, file);
    if (!filePath.startsWith(DEBUG_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
    } catch (error) {
      console.error('Device Studio request error:', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
    }
  });

  server.listen(port, () => {
    console.log(`debug viewer listening on :${port}`);
    console.log(`Device Studio: http://localhost:${port}`);
    console.log(`IDE preview:   http://localhost:${port}/preview`);
  });

  return server;
}

module.exports = { startDebugServer };
