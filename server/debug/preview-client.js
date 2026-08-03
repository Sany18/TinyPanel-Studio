'use strict';

const canvas = document.getElementById('panel');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const canvasWrap = document.getElementById('canvas-wrap');
const gridToggle = document.getElementById('grid-toggle');
const requestedDevice = new URLSearchParams(location.search).get('device');
let selectedDevice = requestedDevice;
let eventSource = null;
let frameCount = 0;

function setGridVisible(visible) {
  canvasWrap.classList.toggle('grid-hidden', !visible);
  gridToggle.setAttribute('aria-pressed', String(visible));
  gridToggle.title = visible ? 'Hide preview grid' : 'Show preview grid';
  localStorage.setItem('tinypanel-preview-grid', visible ? 'on' : 'off');
}

setGridVisible(localStorage.getItem('tinypanel-preview-grid') !== 'off');
gridToggle.addEventListener('click', () => {
  setGridVisible(gridToggle.getAttribute('aria-pressed') !== 'true');
});

function addLabels(element, maximum, step, axis) {
  for (let value = 0; value <= maximum; value += step) {
    const label = document.createElement('span');
    label.className = 'ruler-label';
    label.textContent = value;
    label.style[axis] = `${value / maximum * 100}%`;
    element.appendChild(label);
  }
}
addLabels(document.getElementById('ruler-x'), 160, 20, 'left');
addLabels(document.getElementById('ruler-y'), 128, 16, 'top');

function rgb565(color) {
  const r = (color >> 11) & 0x1f; const g = (color >> 5) & 0x3f; const b = color & 0x1f;
  return [Math.round(r * 255 / 31), Math.round(g * 255 / 63), Math.round(b * 255 / 31)];
}
function color(color565) { const [r, g, b] = rgb565(color565); return `rgb(${r},${g},${b})`; }
function u16(bytes, index) { return (bytes[index] << 8) | bytes[index + 1]; }
function i16(bytes, index) { const value = u16(bytes, index); return value >= 0x8000 ? value - 0x10000 : value; }

async function decode(bytes) {
  for (let index = 0; index < bytes.length;) {
    const op = bytes[index];
    if (op === 0x01) {
      ctx.fillStyle = color(u16(bytes, index + 1)); ctx.fillRect(0, 0, 160, 128); index += 3;
    } else if (op === 0x02) {
      ctx.fillStyle = color(u16(bytes, index + 9));
      ctx.fillRect(i16(bytes, index + 1), i16(bytes, index + 3), i16(bytes, index + 5), i16(bytes, index + 7)); index += 11;
    } else if (op === 0x03) {
      ctx.fillStyle = color(u16(bytes, index + 7)); ctx.beginPath();
      ctx.arc(i16(bytes, index + 1), i16(bytes, index + 3), i16(bytes, index + 5), 0, Math.PI * 2); ctx.fill(); index += 9;
    } else if (op === 0x04) {
      ctx.fillStyle = color(u16(bytes, index + 13)); ctx.beginPath();
      ctx.moveTo(i16(bytes, index + 1), i16(bytes, index + 3));
      ctx.lineTo(i16(bytes, index + 5), i16(bytes, index + 7));
      ctx.lineTo(i16(bytes, index + 9), i16(bytes, index + 11)); ctx.closePath(); ctx.fill(); index += 15;
    } else if (op === 0x05) {
      ctx.strokeStyle = color(u16(bytes, index + 9)); ctx.beginPath();
      ctx.moveTo(i16(bytes, index + 1) + 0.5, i16(bytes, index + 3) + 0.5);
      ctx.lineTo(i16(bytes, index + 5) + 0.5, i16(bytes, index + 7) + 0.5); ctx.stroke(); index += 11;
    } else if (op === 0x06) {
      index += 2;
    } else if (op === 0x07) {
      index += 3;
    } else if (op === 0xe0 || op === 0xe1) {
      const tile = op === 0xe0; const x = tile ? bytes[index + 1] % 10 * 16 : bytes[index + 1];
      const y = tile ? Math.floor(bytes[index + 1] / 10) * 16 : bytes[index + 2];
      const width = tile ? 16 : bytes[index + 3]; const height = tile ? 16 : bytes[index + 4];
      const pixelStart = index + (tile ? 2 : 5); const image = ctx.createImageData(width, height);
      for (let pixel = 0; pixel < width * height; pixel++) {
        const [r, g, b] = rgb565(u16(bytes, pixelStart + pixel * 2)); const target = pixel * 4;
        image.data[target] = r; image.data[target + 1] = g; image.data[target + 2] = b; image.data[target + 3] = 255;
      }
      ctx.putImageData(image, x, y); index += (tile ? 2 : 5) + width * height * 2;
    } else if (op === 0xe2) {
      const length = u16(bytes, index + 1);
      const blob = new Blob([bytes.slice(index + 3, index + 3 + length)], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0, 160, 128);
      bitmap.close();
      index += 3 + length;
    } else if (op === 0xf0) index++;
    else break;
  }
}

function connect(device) {
  if (eventSource) eventSource.close();
  selectedDevice = device; frameCount = 0; ctx.clearRect(0, 0, 160, 128);
  eventSource = new EventSource(`/stream?device=${encodeURIComponent(device)}`);
  let decodeQueue = Promise.resolve();
  eventSource.addEventListener('frame', (event) => {
    const payload = JSON.parse(event.data);
    const bytes = Uint8Array.from(atob(payload.frame), (character) => character.charCodeAt(0));
    decodeQueue = decodeQueue.then(() => decode(bytes)).then(() => {
      status.textContent = `${device} · ${++frameCount} frames`;
    });
  });
  eventSource.onerror = () => { status.textContent = `${device} · reconnecting…`; };
}

async function discover() {
  try {
    const devices = (await (await fetch('/api/devices', { cache: 'no-store' })).json()).devices;
    const target = requestedDevice
      ? devices.find((device) => device.id === requestedDevice && device.connected)
      : devices.find((device) => device.connected);
    if (target && (!eventSource || target.id !== selectedDevice)) connect(target.id);
    if (!target && !eventSource) status.textContent = requestedDevice ? `${requestedDevice} is offline` : 'waiting for a device…';
  } catch (error) { status.textContent = error.message; }
}

discover();
setInterval(discover, 1000);
