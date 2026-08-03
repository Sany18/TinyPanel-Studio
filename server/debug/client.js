'use strict';

// Client-side mirror of the .ino's dispatch() - decodes the exact same
// opcode stream (see ../../DISPLAY_PROTOCOL.md) and draws to <canvas>
// instead of blitting over SPI. Keep this in sync with the .ino by hand;
// it's debug-only, so drift here doesn't affect the real protocol.

const canvas = document.getElementById('panel');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const devicesElement = document.getElementById('devices');
const simulateButton = document.getElementById('simulate-device');
const previewTitle = document.getElementById('preview-title');
const rulerX = document.getElementById('ruler-x');
const rulerY = document.getElementById('ruler-y');
const sourceEditor = new window.DeviceCodeEditor(document.getElementById('source'));
const editorStatus = document.getElementById('editor-status');
const editorTitle = document.getElementById('editor-title');
const problemsElement = document.getElementById('problems');
const problemsCount = document.getElementById('problems-count');
const problemsOutput = document.getElementById('problems-output');
const appsElement = document.getElementById('apps');
const newAppButton = document.getElementById('new-app');
const bandwidthValue = document.getElementById('bandwidth-value');
const editorThemeInput = document.getElementById('editor-theme');
const editorColorSchemeInput = document.getElementById('editor-color-scheme');
const editorSaveModeInput = document.getElementById('editor-save-mode');
const editorMenuToggle = document.getElementById('editor-menu-toggle');
const editorMenuPanel = document.getElementById('editor-menu-panel');
const serialToggle = document.getElementById('serial-toggle');
const serialStatus = document.getElementById('serial-status');
const serialLog = document.getElementById('serial-log');
const firmwareStatus = document.getElementById('firmware-status');
const firmwareLog = document.getElementById('firmware-log');
const appLog = document.getElementById('app-log');
const buildFirmwareButton = document.getElementById('build-firmware');
const flashFirmwareButton = document.getElementById('flash-firmware');
const workspaceFullscreenButton = document.getElementById('workspace-fullscreen');
const appModeButton = document.getElementById('app-mode');
const hardwareModeButton = document.getElementById('hardware-mode');
const appWorkspace = document.getElementById('app-workspace');
const hardwareWorkspace = document.getElementById('hardware-workspace');
const hardwareForm = document.getElementById('hardware-form');
const hardwareStatus = document.getElementById('hardware-status');
const hardwareController = document.getElementById('hardware-controller');
const hardwareDisplay = document.getElementById('hardware-display');
const hardwareBus = document.getElementById('hardware-bus');
const hardwareWidth = document.getElementById('hardware-width');
const hardwareHeight = document.getElementById('hardware-height');
const hardwareRotation = document.getElementById('hardware-rotation');
const hardwareColorOrder = document.getElementById('hardware-color-order');
const hardwareSpiFrequency = document.getElementById('hardware-spi-frequency');
const hardwareWifiSsid = document.getElementById('hardware-wifi-ssid');
const hardwareWifiPassword = document.getElementById('hardware-wifi-password');
const hardwareWifiStatus = document.getElementById('hardware-wifi-status');
const hardwareServerHost = document.getElementById('hardware-server-host');
const hardwareServerPort = document.getElementById('hardware-server-port');
let frameCount = 0;
let selectedDeviceId = null;
let eventSource = null;
let saveTimer = null;
let sourceLoaded = false;
let activeAppId = null;
let bandwidthSample = null;
let serialEvents = null;
let firmwareEvents = null;
let appLogEvents = null;
let appEvents = null;
let workspaceFullscreen = false;
let validationProblem = null;
let runtimeProblem = null;
let editorSaveMode = localStorage.getItem('tinypanel-editor-save-mode') || 'auto';
let studioMode = 'app';
let hardwareCatalog = null;

const TILE_SIZE = 16;
const TILES_X = 10;

function addRulerLabels(element, maximum, step, axis) {
  for (let value = 0; value <= maximum; value += step) {
    const label = document.createElement('span');
    label.className = 'ruler-label';
    label.textContent = value;
    label.style[axis] = `${value / maximum * 100}%`;
    element.appendChild(label);
  }
}

function configurePreviewSize(width, height) {
  canvas.width = width;
  canvas.height = height;
  canvas.style.aspectRatio = `${width} / ${height}`;
  rulerX.replaceChildren();
  rulerY.replaceChildren();
  const chooseStep = (maximum) => Math.max(1, Math.ceil(maximum / 8 / 5) * 5);
  addRulerLabels(rulerX, width, chooseStep(width), 'left');
  addRulerLabels(rulerY, height, chooseStep(height), 'top');
}

configurePreviewSize(160, 128);

function drawHardwarePreview() {
  const width = Math.max(16, Math.min(320, Number(hardwareWidth.value) || 160));
  const height = Math.max(16, Math.min(320, Number(hardwareHeight.value) || 128));
  configurePreviewSize(width, height);
  ctx.fillStyle = '#100020';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#30405c';
  const spacing = Math.max(8, Math.round(Math.min(width, height) / 8));
  for (let x = 0; x < width; x += spacing) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += spacing) ctx.fillRect(0, y, width, 1);
  previewTitle.textContent = `${hardwareDisplay.selectedOptions[0]?.textContent || 'Display'} — ${width}×${height}`;
  status.textContent = 'hardware profile preview';
}

function setStudioMode(mode) {
  studioMode = mode === 'hardware' ? 'hardware' : 'app';
  appModeButton.classList.toggle('active', studioMode === 'app');
  hardwareModeButton.classList.toggle('active', studioMode === 'hardware');
  appWorkspace.hidden = studioMode !== 'app';
  hardwareWorkspace.hidden = studioMode !== 'hardware';
  if (studioMode === 'hardware') {
    if (eventSource) { eventSource.close(); eventSource = null; }
    drawHardwarePreview();
  } else {
    configurePreviewSize(160, 128);
    const selected = (window.currentDevices || []).find((device) => device.id === selectedDeviceId);
    if (selected) selectDevice(selected);
    else { previewTitle.textContent = 'Live transport preview'; status.textContent = 'select a device'; }
  }
  localStorage.setItem('tinypanel-studio-mode', studioMode);
}

appModeButton.addEventListener('click', () => setStudioMode('app'));
hardwareModeButton.addEventListener('click', () => setStudioMode('hardware'));

function renderProblems() {
  const problems = [validationProblem, runtimeProblem].filter(Boolean);
  problemsElement.classList.toggle('has-errors', problems.length > 0);
  problemsCount.textContent = problems.length;
  problemsOutput.textContent = problems.map((problem) => {
    const heading = `${problem.kind}: ${problem.message}`;
    return problem.stack && !problem.stack.startsWith(problem.message)
      ? `${heading}\n${problem.stack}` : heading;
  }).join('\n\n');
}

function updateRuntimeProblem(devices) {
  const selected = devices.find((device) => device.id === selectedDeviceId && device.program === 'canvas');
  const canvasDevice = selected || devices.find((device) => device.connected && device.program === 'canvas');
  runtimeProblem = canvasDevice?.appError ? {
    kind: 'Runtime',
    message: canvasDevice.appError.message,
    stack: canvasDevice.appError.stack,
  } : null;
  renderProblems();
}

function setWorkspaceFullscreen(enabled) {
  workspaceFullscreen = enabled;
  document.body.classList.toggle('workspace-fullscreen', enabled);
  workspaceFullscreenButton.setAttribute('aria-pressed', String(enabled));
  workspaceFullscreenButton.textContent = enabled ? '×' : '⛶';
  const label = enabled ? 'Exit fullscreen workspace' : 'Fullscreen workspace';
  workspaceFullscreenButton.title = label;
  workspaceFullscreenButton.setAttribute('aria-label', label);
}

async function toggleWorkspaceFullscreen() {
  if (!workspaceFullscreen) {
    setWorkspaceFullscreen(true);
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen(); } catch (_) { /* CSS focus mode still works. */ }
    }
  } else {
    setWorkspaceFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  }
}

workspaceFullscreenButton.addEventListener('click', toggleWorkspaceFullscreen);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && workspaceFullscreen) setWorkspaceFullscreen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && workspaceFullscreen && !document.fullscreenElement) {
    setWorkspaceFullscreen(false);
  }
});

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

async function decodeFrame(bytes) {
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
    } else if (op === 0x06) { // SET_ROTATION (physical display only)
      i += 2;
    } else if (op === 0x07) { // SET_POWER_CONFIG (physical display only)
      i += 3;
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
    } else if (op === 0xe2) { // JPEG_FRAME
      const length = readU16(bytes, i + 1);
      const blob = new Blob([bytes.slice(i + 3, i + 3 + length)], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0, 160, 128);
      bitmap.close();
      i += 3 + length;
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
  let decodeQueue = Promise.resolve();
  eventSource.addEventListener('frame', (ev) => {
    const message = JSON.parse(ev.data);
    const bytes = Uint8Array.from(atob(message.frame), (c) => c.charCodeAt(0));
    decodeQueue = decodeQueue.then(() => decodeFrame(bytes)).then(() => {
      frameCount++;
      status.textContent = `live frames: ${frameCount}`;
    });
  });
  eventSource.onerror = () => {
    status.textContent = 'stream disconnected, retrying...';
  };
}

function selectDevice(device) {
  selectedDeviceId = device.id;
  if (studioMode === 'app') {
    previewTitle.textContent = `Live transport preview — ${device.id}`;
    connectStream(device.id);
  }
  renderDevices(window.currentDevices || []);
}

function renderDevices(devices) {
  window.currentDevices = devices;
  devicesElement.replaceChildren();
  if (simulateButton) {
    const simulated = devices.find((device) => device.simulated && device.connected);
    simulateButton.textContent = simulated ? 'Stop simulated device' : 'Simulate device (no ESP32)';
    simulateButton.classList.toggle('active', Boolean(simulated));
  }
  if (!devices.length) {
    devicesElement.textContent = 'no devices discovered';
    return;
  }
  for (const device of devices) {
    const button = document.createElement('button');
    button.className = `device${device.id === selectedDeviceId ? ' selected' : ''}`;
    const stateClass = device.connected ? 'online' : 'offline';
    const state = device.connected ? 'online' : 'offline';
    button.innerHTML = `<span class="${stateClass}">● ${state}</span> ${device.id}${device.simulated ? ' (simulated)' : ''}`
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

simulateButton?.addEventListener('click', async () => {
  const simulated = (window.currentDevices || []).find((device) => device.simulated && device.connected);
  simulateButton.disabled = true;
  try {
    await fetch('/api/devices/simulate', { method: simulated ? 'DELETE' : 'POST' });
    await refreshDevices();
  } catch (error) {
    devicesElement.textContent = `simulate device error: ${error.message}`;
  } finally {
    simulateButton.disabled = false;
  }
});

async function refreshDevices() {
  try {
    const response = await fetch('/api/devices', { cache: 'no-store' });
    const payload = await response.json();
    renderDevices(payload.devices);
    updateRuntimeProblem(payload.devices);
    const measuredDevice = payload.devices.find((device) => device.id === selectedDeviceId)
      || payload.devices.find((device) => device.connected);
    if (measuredDevice) {
      const now = performance.now();
      const bytes = measuredDevice.bytes;
      const frames = measuredDevice.frames;
      if (bandwidthSample?.deviceId === measuredDevice.id) {
        const elapsedSeconds = (now - bandwidthSample.at) / 1000;
        const bytesPerSecond = (bytes - bandwidthSample.bytes) / elapsedSeconds;
        const framesPerSecond = (frames - bandwidthSample.frames) / elapsedSeconds;
        bandwidthValue.textContent = `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`
          + ` · ${(bytesPerSecond * 8 / 1000).toFixed(0)} kbit/s`
          + ` · ${framesPerSecond.toFixed(1)} FPS`;
      }
      bandwidthSample = { deviceId: measuredDevice.id, bytes, frames, at: now };
    }
  } catch (error) {
    devicesElement.textContent = `device API error: ${error.message}`;
  }
}

refreshDevices();
setInterval(refreshDevices, 1000);

async function loadSource() {
  sourceLoaded = false;
  try {
    const response = await fetch('/api/apps/live/source', { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    const app = await response.json();
    sourceEditor.setValue(app.source);
    activeAppId = app.app?.id || activeAppId;
    editorTitle.textContent = app.app ? `${app.app.name} — Canvas draft` : 'Canvas app';
    sourceLoaded = true;
    editorStatus.className = '';
    editorStatus.textContent = `revision ${app.revision} · ${editorSaveMode === 'manual' ? 'Ctrl+S to apply' : 'autosave enabled'}`;
  } catch (error) {
    sourceLoaded = true;
    editorStatus.className = 'error';
    editorStatus.textContent = `cannot load live app: ${error.message}`;
  }
}

function watchApplicationFiles() {
  appEvents = new EventSource('/api/apps/events');
  appEvents.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    if (event.type === 'ready') return;
    if (event.type === 'external-error') {
      if (event.active || event.id === activeAppId) {
        validationProblem = { kind: 'External file', message: event.message };
        renderProblems();
        editorStatus.className = 'error';
        editorStatus.textContent = `external file error: ${event.message}`;
      }
      return;
    }
    if (event.type !== 'external-change') return;
    await refreshApps();
    if (event.active || event.id === activeAppId) {
      clearTimeout(saveTimer);
      validationProblem = null;
      renderProblems();
      await loadSource();
      editorStatus.textContent = `revision ${event.revision} · reloaded from disk`;
    }
  };
}

async function refreshApps() {
  try {
    const response = await fetch('/api/apps', { cache: 'no-store' });
    const payload = await response.json();
    activeAppId = payload.activeId;
    appsElement.replaceChildren();
    for (const app of payload.apps) {
      const row = document.createElement('div');
      row.className = 'app-row';
      const button = document.createElement('button');
      button.className = `app${app.active ? ' active' : ''}`;
      const name = document.createElement('span');
      name.textContent = app.name;
      const description = document.createElement('small');
      description.textContent = app.description || app.id;
      button.append(name, description);
      button.addEventListener('click', () => activateApp(app.id));
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'app-edit';
      editButton.title = `Edit ${app.name}`;
      editButton.setAttribute('aria-label', `Edit ${app.name}`);
      editButton.textContent = '✎';
      editButton.addEventListener('click', () => editApp(app));
      row.append(button, editButton);
      appsElement.appendChild(row);
    }
  } catch (error) {
    appsElement.textContent = `app API error: ${error.message}`;
  }
}

async function editApp(app) {
  const name = window.prompt('Application name', app.name);
  if (name === null) return;
  const description = window.prompt('Application description', app.description || '');
  if (description === null) return;
  try {
    const response = await fetch(`/api/apps/${encodeURIComponent(app.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'metadata update failed');
    if (app.id === activeAppId) {
      await loadSource();
    }
    await refreshApps();
  } catch (error) {
    editorStatus.className = 'error';
    editorStatus.textContent = error.message;
  }
}

async function activateApp(id) {
  if (id === activeAppId) return;
  clearTimeout(saveTimer);
  sourceLoaded = false;
  validationProblem = null;
  runtimeProblem = null;
  renderProblems();
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
    validationProblem = null;
    renderProblems();
    editorStatus.className = '';
    editorStatus.textContent = `revision ${result.revision} · rendered on connected Canvas devices`;
    await refreshApps();
  } catch (error) {
    validationProblem = { kind: 'Validation', message: error.message };
    renderProblems();
    editorStatus.className = 'error';
    editorStatus.textContent = error.message;
  }
}

sourceEditor.onChange(() => {
  if (!sourceLoaded) return;
  clearTimeout(saveTimer);
  editorStatus.className = '';
  if (editorSaveMode === 'manual') {
    editorStatus.textContent = 'unsaved changes · press Ctrl+S / Cmd+S to apply';
  } else {
    editorStatus.textContent = 'unsaved changes…';
    saveTimer = setTimeout(saveSource, 400);
  }
});

sourceEditor.onSave(() => {
  if (!sourceLoaded) return;
  clearTimeout(saveTimer);
  saveSource();
});

function optionList(select, items) {
  select.replaceChildren(...items.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    return option;
  }));
}

function setHardwareForm(profile, wifi = null) {
  hardwareController.value = profile.controller;
  hardwareDisplay.value = profile.display;
  hardwareBus.value = profile.bus;
  hardwareWidth.value = profile.width;
  hardwareHeight.value = profile.height;
  hardwareRotation.value = profile.rotation;
  hardwareColorOrder.value = profile.colorOrder;
  hardwareSpiFrequency.value = profile.spiFrequency;
  hardwareServerHost.value = profile.serverHost;
  hardwareServerPort.value = profile.serverPort;
  for (const input of hardwareForm.querySelectorAll('[data-pin]')) input.value = profile.pins[input.dataset.pin];
  if (wifi) {
    hardwareWifiSsid.value = wifi.ssid || '';
    hardwareWifiPassword.value = '';
    hardwareWifiStatus.textContent = wifi.configured ? 'Credentials configured' : 'Credentials required';
  }
}

function readHardwareForm() {
  const pins = {};
  for (const input of hardwareForm.querySelectorAll('[data-pin]')) pins[input.dataset.pin] = Number(input.value);
  return {
    controller: hardwareController.value,
    display: hardwareDisplay.value,
    bus: hardwareBus.value,
    width: Number(hardwareWidth.value),
    height: Number(hardwareHeight.value),
    rotation: Number(hardwareRotation.value),
    colorOrder: hardwareColorOrder.value,
    spiFrequency: Number(hardwareSpiFrequency.value),
    serverHost: hardwareServerHost.value,
    serverPort: Number(hardwareServerPort.value),
    pins,
    wifi: { ssid: hardwareWifiSsid.value, password: hardwareWifiPassword.value },
  };
}

async function loadHardwareProfile() {
  const response = await fetch('/api/hardware', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || !result.profile) throw new Error(result.error || 'hardware profile unavailable');
  hardwareCatalog = result.catalog;
  optionList(hardwareController, hardwareCatalog.controllers);
  optionList(hardwareDisplay, hardwareCatalog.displays);
  optionList(hardwareBus, hardwareCatalog.buses);
  setHardwareForm(result.profile, result.wifi);
}

hardwareDisplay.addEventListener('change', () => {
  const display = hardwareCatalog?.displays.find((item) => item.id === hardwareDisplay.value);
  if (display) { hardwareWidth.value = display.defaultWidth; hardwareHeight.value = display.defaultHeight; }
  drawHardwarePreview();
});
hardwareWidth.addEventListener('input', drawHardwarePreview);
hardwareHeight.addEventListener('input', drawHardwarePreview);

hardwareForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hardwareStatus.className = '';
  hardwareStatus.textContent = 'validating and generating firmware config…';
  try {
    const response = await fetch('/api/hardware', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readHardwareForm()),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'cannot save hardware profile');
    setHardwareForm(result.profile, result.wifi);
    drawHardwarePreview();
    hardwareStatus.textContent = 'saved · firmware build will use this profile';
  } catch (error) {
    hardwareStatus.className = 'error';
    hardwareStatus.textContent = error.message;
  }
});

loadSource();
refreshApps();
watchApplicationFiles();
loadHardwareProfile().then(() => setStudioMode(localStorage.getItem('tinypanel-studio-mode') || 'app'))
  .catch((error) => { hardwareStatus.className = 'error'; hardwareStatus.textContent = error.message; });

function appendLog(element, entry) {
  element.textContent += `[${entry.channel}] ${entry.line}\n`;
  const lines = element.textContent.split('\n');
  if (lines.length > 250) element.textContent = lines.slice(-250).join('\n');
  element.scrollTop = element.scrollHeight;
}

const savedEditorTheme = localStorage.getItem('tinypanel-editor-theme') || 'studio';
editorThemeInput.value = sourceEditor.setTheme(savedEditorTheme);
editorThemeInput.addEventListener('change', () => {
  const selected = sourceEditor.setTheme(editorThemeInput.value);
  editorThemeInput.value = selected;
  localStorage.setItem('tinypanel-editor-theme', selected);
});

const savedColorScheme = localStorage.getItem('tinypanel-editor-color-scheme') || 'monokai';
editorColorSchemeInput.value = sourceEditor.setColorScheme(savedColorScheme);
editorColorSchemeInput.addEventListener('change', () => {
  const selected = sourceEditor.setColorScheme(editorColorSchemeInput.value);
  editorColorSchemeInput.value = selected;
  localStorage.setItem('tinypanel-editor-color-scheme', selected);
});

editorSaveModeInput.value = editorSaveMode;
editorSaveModeInput.addEventListener('change', () => {
  editorSaveMode = editorSaveModeInput.value === 'manual' ? 'manual' : 'auto';
  localStorage.setItem('tinypanel-editor-save-mode', editorSaveMode);
  clearTimeout(saveTimer);
  editorStatus.textContent = editorSaveMode === 'manual'
    ? 'manual save enabled · Ctrl+S / Cmd+S applies changes'
    : 'autosave enabled';
});

function setEditorMenu(open) {
  editorMenuPanel.hidden = !open;
  editorMenuToggle.setAttribute('aria-expanded', String(open));
}

editorMenuToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  setEditorMenu(editorMenuPanel.hidden);
});
editorMenuPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => setEditorMenu(false));

serialToggle.addEventListener('click', async () => {
  const shouldStart = !serialEvents;
  if (shouldStart) {
    serialLog.textContent = '';
    serialEvents = new EventSource('/api/debug/logs?source=serial');
    serialEvents.onmessage = (event) => appendLog(serialLog, JSON.parse(event.data));
    const response = await fetch('/api/serial/start', { method: 'POST' });
    const result = await response.json();
    serialStatus.textContent = result.running ? `${result.port} @ ${result.baud}` : (result.error || 'failed');
    serialToggle.textContent = 'Stop monitor';
  } else {
    serialEvents.close();
    serialEvents = null;
    await fetch('/api/serial/stop', { method: 'POST' });
    serialStatus.textContent = 'stopped';
    serialToggle.textContent = 'Start monitor';
  }
});

async function openFirmwareLog() {
  if (!firmwareEvents) {
    firmwareLog.textContent = '';
    firmwareEvents = new EventSource('/api/debug/logs?source=firmware');
    firmwareEvents.onmessage = (event) => appendLog(firmwareLog, JSON.parse(event.data));
    const response = await fetch('/api/firmware');
    const info = await response.json();
    firmwareStatus.textContent = `v${info.version} · ${info.status}`;
  }
}

for (const tab of document.querySelectorAll('.dock-tab')) {
  tab.addEventListener('click', () => {
    for (const candidate of document.querySelectorAll('.dock-tab')) candidate.classList.toggle('active', candidate === tab);
    for (const pane of document.querySelectorAll('.dock-pane')) pane.hidden = pane.id !== tab.dataset.pane;
    if (tab.dataset.pane === 'firmware-pane') openFirmwareLog();
  });
}

appLogEvents = new EventSource('/api/debug/logs?source=app');
appLogEvents.onmessage = (event) => appendLog(appLog, JSON.parse(event.data));

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
