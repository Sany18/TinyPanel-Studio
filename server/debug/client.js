'use strict';

// Client-side mirror of the .ino's dispatch() - decodes the exact same
// opcode stream (see ../../DISPLAY_PROTOCOL.md) and draws to <canvas>
// instead of blitting over SPI. Keep this in sync with the .ino by hand;
// it's debug-only, so drift here doesn't affect the real protocol.

const canvas = document.getElementById('panel');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const devicesElement = document.getElementById('devices');
const previewTitle = document.getElementById('preview-title');
const sourceEditor = new window.DeviceCodeEditor(document.getElementById('source'));
const editorStatus = document.getElementById('editor-status');
const editorTitle = document.getElementById('editor-title');
const appsElement = document.getElementById('apps');
const newAppButton = document.getElementById('new-app');
const bandwidthToggle = document.getElementById('bandwidth-debug');
const bandwidthPanel = document.getElementById('bandwidth-panel');
const bandwidthValue = document.getElementById('bandwidth-value');
const serialToggle = document.getElementById('serial-debug');
const serialPanel = document.getElementById('serial-panel');
const serialStatus = document.getElementById('serial-status');
const serialLog = document.getElementById('serial-log');
const firmwareToggle = document.getElementById('firmware-debug');
const firmwarePanel = document.getElementById('firmware-panel');
const firmwareStatus = document.getElementById('firmware-status');
const firmwareLog = document.getElementById('firmware-log');
const buildFirmwareButton = document.getElementById('build-firmware');
const flashFirmwareButton = document.getElementById('flash-firmware');
let frameCount = 0;
let selectedDeviceId = null;
let eventSource = null;
let saveTimer = null;
let sourceLoaded = false;
let activeAppId = null;
let bandwidthSample = null;
let serialEvents = null;
let firmwareEvents = null;

const TILE_SIZE = 16;
const TILES_X = 10;

function rgb565to888(color) {
  const r = (color >> 11) & 0x1f;
  const g = (color >> 5) & 0x3f;
  const b = color & 0x1f;
  return [
    Math.round((r * 255) / 31),
    Math.round((g * 255) / 63),
    Math.round((b * 255) / 31),
  ];
}

function cssColor(color) {
  const [r, g, b] = rgb565to888(color);
  return `rgb(${r},${g},${b})`;
}

function readU16(bytes, i) {
  return (bytes[i] << 8) | bytes[i + 1];
}

function readI16(bytes, i) {
  const v = readU16(bytes, i);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function decodeFrame(bytes) {
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];

    if (op === 0x01) { // FILL_SCREEN
      ctx.fillStyle = cssColor(readU16(bytes, i + 1));
      ctx.fillRect(0, 0, 160, 128);
      i += 3;
    } else if (op === 0x02) { // FILL_RECT
      const x = readI16(bytes, i + 1);
      const y = readI16(bytes, i + 3);
      const w = readI16(bytes, i + 5);
      const h = readI16(bytes, i + 7);
      ctx.fillStyle = cssColor(readU16(bytes, i + 9));
      ctx.fillRect(x, y, w, h);
      i += 11;
    } else if (op === 0x03) { // FILL_CIRCLE
      const x0 = readI16(bytes, i + 1);
      const y0 = readI16(bytes, i + 3);
      const r = readI16(bytes, i + 5);
      ctx.fillStyle = cssColor(readU16(bytes, i + 7));
      ctx.beginPath();
      ctx.arc(x0, y0, r, 0, Math.PI * 2);
      ctx.fill();
      i += 9;
    } else if (op === 0x04) { // FILL_TRIANGLE
      const x0 = readI16(bytes, i + 1);
      const y0 = readI16(bytes, i + 3);
      const x1 = readI16(bytes, i + 5);
      const y1 = readI16(bytes, i + 7);
      const x2 = readI16(bytes, i + 9);
      const y2 = readI16(bytes, i + 11);
      ctx.fillStyle = cssColor(readU16(bytes, i + 13));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      i += 15;
    } else if (op === 0x05) { // DRAW_LINE
      const x0 = readI16(bytes, i + 1);
      const y0 = readI16(bytes, i + 3);
      const x1 = readI16(bytes, i + 5);
      const y1 = readI16(bytes, i + 7);
      ctx.strokeStyle = cssColor(readU16(bytes, i + 9));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, y0 + 0.5);
      ctx.lineTo(x1 + 0.5, y1 + 0.5);
      ctx.stroke();
      i += 11;
    } else if (op === 0xe0) { // BLIT_TILE
      const tileIndex = bytes[i + 1];
      const tileCol = tileIndex % TILES_X;
      const tileRow = Math.floor(tileIndex / TILES_X);
      const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
      for (let p = 0; p < TILE_SIZE * TILE_SIZE; p++) {
        const [r, g, b] = rgb565to888(readU16(bytes, i + 2 + p * 2));
        img.data[p * 4] = r;
        img.data[p * 4 + 1] = g;
        img.data[p * 4 + 2] = b;
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, tileCol * TILE_SIZE, tileRow * TILE_SIZE);
      i += 514;
    } else if (op === 0xe1) { // BLIT_RECT
      const x = bytes[i + 1];
      const y = bytes[i + 2];
      const width = bytes[i + 3];
      const height = bytes[i + 4];
      const img = ctx.createImageData(width, height);
      for (let p = 0; p < width * height; p++) {
        const [r, g, b] = rgb565to888(readU16(bytes, i + 5 + p * 2));
        img.data[p * 4] = r;
        img.data[p * 4 + 1] = g;
        img.data[p * 4 + 2] = b;
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, x, y);
      i += 5 + width * height * 2;
    } else if (op === 0xf0) { // FRAME_END
      i += 1;
    } else {
      console.warn('unknown opcode in debug stream, stopping decode:', op.toString(16));
      break;
    }
  }
}

function connectStream(deviceId) {
  if (eventSource) eventSource.close();
  frameCount = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  eventSource = new EventSource(`/stream?device=${encodeURIComponent(deviceId)}`);
  eventSource.addEventListener('frame', (ev) => {
    const message = JSON.parse(ev.data);
    const bytes = Uint8Array.from(atob(message.frame), (c) => c.charCodeAt(0));
    decodeFrame(bytes);
    frameCount++;
    status.textContent = `live frames: ${frameCount}`;
  });
  eventSource.onerror = () => {
    status.textContent = 'stream disconnected, retrying...';
  };
}

function selectDevice(device) {
  selectedDeviceId = device.id;
  previewTitle.textContent = `Live transport preview — ${device.id}`;
  connectStream(device.id);
  renderDevices(window.currentDevices || []);
}

function renderDevices(devices) {
  window.currentDevices = devices;
  devicesElement.replaceChildren();
  if (!devices.length) {
    devicesElement.textContent = 'no devices discovered';
    return;
  }
  for (const device of devices) {
    const button = document.createElement('button');
    button.className = `device${device.id === selectedDeviceId ? ' selected' : ''}`;
    const stateClass = device.connected ? 'online' : 'offline';
    const state = device.connected ? 'online' : 'offline';
    button.innerHTML = `<span class="${stateClass}">● ${state}</span> ${device.id}`
      + `<small>${device.program || 'no app'} · frames ${device.frames}`
      + ` · ACK ${device.lastAckMs === null ? '—' : device.lastAckMs.toFixed(1) + ' ms'}</small>`;
    button.addEventListener('click', () => selectDevice(device));
    devicesElement.appendChild(button);
  }
  if (!selectedDeviceId) {
    const firstOnline = devices.find((device) => device.connected);
    if (firstOnline) selectDevice(firstOnline);
  }
}

async function refreshDevices() {
  try {
    const response = await fetch('/api/devices', { cache: 'no-store' });
    const payload = await response.json();
    renderDevices(payload.devices);
    if (bandwidthToggle.checked && payload.devices[0]) {
      const now = performance.now();
      const bytes = payload.devices[0].bytes;
      if (bandwidthSample) {
        const bytesPerSecond = (bytes - bandwidthSample.bytes) * 1000 / (now - bandwidthSample.at);
        bandwidthValue.textContent = `${(bytesPerSecond / 1024).toFixed(1)} KiB/s · ${(bytesPerSecond * 8 / 1000).toFixed(0)} kbit/s`;
      }
      bandwidthSample = { bytes, at: now };
    }
  } catch (error) {
    devicesElement.textContent = `device API error: ${error.message}`;
  }
}

refreshDevices();
setInterval(refreshDevices, 1000);

async function loadSource() {
  try {
    const response = await fetch('/api/apps/live/source', { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    const app = await response.json();
    sourceEditor.setValue(app.source);
    activeAppId = app.app?.id || activeAppId;
    editorTitle.textContent = app.app ? `${app.app.name} — Canvas draft` : 'Canvas app';
    sourceLoaded = true;
    editorStatus.className = '';
    editorStatus.textContent = `revision ${app.revision} · autosave enabled`;
  } catch (error) {
    editorStatus.className = 'error';
    editorStatus.textContent = `cannot load live app: ${error.message}`;
  }
}

async function refreshApps() {
  try {
    const response = await fetch('/api/apps', { cache: 'no-store' });
    const payload = await response.json();
    activeAppId = payload.activeId;
    appsElement.replaceChildren();
    for (const app of payload.apps) {
      const button = document.createElement('button');
      button.className = `app${app.active ? ' active' : ''}`;
      button.innerHTML = `${app.name}<small>${app.description || app.id}</small>`;
      button.addEventListener('click', () => activateApp(app.id));
      appsElement.appendChild(button);
    }
  } catch (error) {
    appsElement.textContent = `app API error: ${error.message}`;
  }
}

async function activateApp(id) {
  if (id === activeAppId) return;
  clearTimeout(saveTimer);
  sourceLoaded = false;
  editorStatus.textContent = 'switching application…';
  try {
    const response = await fetch(`/api/apps/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'activation failed');
    await loadSource();
    await refreshApps();
  } catch (error) {
    editorStatus.className = 'error';
    editorStatus.textContent = error.message;
  }
}

newAppButton.addEventListener('click', async () => {
  const name = window.prompt('Application name');
  if (!name) return;
  const suggested = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = window.prompt('Application ID', suggested);
  if (!id) return;
  try {
    const response = await fetch('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'creation failed');
    activeAppId = result.app.id;
    await loadSource();
    await refreshApps();
  } catch (error) {
    editorStatus.className = 'error';
    editorStatus.textContent = error.message;
  }
});

async function saveSource() {
  editorStatus.className = '';
  editorStatus.textContent = 'validating and saving…';
  try {
    const response = await fetch('/api/apps/live/source', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: sourceEditor.getValue() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'save failed');
    editorStatus.className = '';
    editorStatus.textContent = `revision ${result.revision} · rendered on connected Canvas devices`;
  } catch (error) {
    editorStatus.className = 'error';
    editorStatus.textContent = error.message;
  }
}

sourceEditor.onChange(() => {
  if (!sourceLoaded) return;
  clearTimeout(saveTimer);
  editorStatus.className = '';
  editorStatus.textContent = 'unsaved changes…';
  saveTimer = setTimeout(saveSource, 400);
});

loadSource();
refreshApps();

function appendLog(element, entry) {
  element.textContent += `[${entry.channel}] ${entry.line}\n`;
  const lines = element.textContent.split('\n');
  if (lines.length > 250) element.textContent = lines.slice(-250).join('\n');
  element.scrollTop = element.scrollHeight;
}

bandwidthToggle.addEventListener('change', () => {
  bandwidthPanel.hidden = !bandwidthToggle.checked;
  bandwidthSample = null;
  bandwidthValue.textContent = 'sampling…';
});

serialToggle.addEventListener('change', async () => {
  serialPanel.hidden = !serialToggle.checked;
  if (serialToggle.checked) {
    serialLog.textContent = '';
    serialEvents = new EventSource('/api/debug/logs?source=serial');
    serialEvents.onmessage = (event) => appendLog(serialLog, JSON.parse(event.data));
    const response = await fetch('/api/serial/start', { method: 'POST' });
    const result = await response.json();
    serialStatus.textContent = result.running ? `${result.port} @ ${result.baud}` : (result.error || 'failed');
  } else {
    if (serialEvents) serialEvents.close();
    serialEvents = null;
    await fetch('/api/serial/stop', { method: 'POST' });
    serialStatus.textContent = 'stopped';
  }
});

firmwareToggle.addEventListener('change', async () => {
  firmwarePanel.hidden = !firmwareToggle.checked;
  if (firmwareToggle.checked) {
    firmwareLog.textContent = '';
    firmwareEvents = new EventSource('/api/debug/logs?source=firmware');
    firmwareEvents.onmessage = (event) => appendLog(firmwareLog, JSON.parse(event.data));
    const response = await fetch('/api/firmware');
    const info = await response.json();
    firmwareStatus.textContent = `v${info.version} · ${info.status}`;
  } else if (firmwareEvents) {
    firmwareEvents.close();
    firmwareEvents = null;
  }
});

async function firmwareOperation(operation) {
  buildFirmwareButton.disabled = true;
  flashFirmwareButton.disabled = true;
  firmwareStatus.textContent = `${operation} in progress…`;
  try {
    const response = await fetch(`/api/firmware/${operation}`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `${operation} failed`);
    const info = await (await fetch('/api/firmware')).json();
    firmwareStatus.textContent = `v${info.version} · ${operation} complete`;
  } catch (error) {
    firmwareStatus.textContent = error.message;
  } finally {
    buildFirmwareButton.disabled = false;
    flashFirmwareButton.disabled = false;
  }
}

buildFirmwareButton.addEventListener('click', () => firmwareOperation('build'));
flashFirmwareButton.addEventListener('click', () => {
  if (window.confirm('Flash the connected ESP32? Serial Monitor will be stopped.')) firmwareOperation('flash');
});
