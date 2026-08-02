'use strict';

const { EventEmitter } = require('events');
const { DisplayFramebuffer } = require('./displayFramebuffer');

function normalizeAddress(address) {
  return (address || 'unknown').replace(/^::ffff:/, '');
}

class DeviceRegistry extends EventEmitter {
  constructor() {
    super();
    this._devices = new Map();
  }

  register(socket) {
    // Protocol v1 has no device handshake yet. The LAN address is stable enough
    // for the Studio foundation; protocol v2 will replace this with device ID.
    const id = normalizeAddress(socket.remoteAddress);
    const previous = this._devices.get(id);
    if (previous?.socket && previous.socket !== socket) previous.socket.destroy();

    const device = {
      id,
      address: normalizeAddress(socket.remoteAddress),
      port: socket.remotePort,
      connectedAt: new Date().toISOString(),
      connected: true,
      mode: 'stream',
      program: null,
      frames: 0,
      bytes: 0,
      lastAckMs: null,
      maxAckMs: 0,
      lastFrameAt: null,
      framebuffer: new DisplayFramebuffer(),
      socket,
    };
    this._devices.set(id, device);
    this.emit('change', this.serialize(device));
    return device;
  }

  recordFrame(device, byteLength) {
    device.frames++;
    device.bytes += byteLength;
    device.lastFrameAt = new Date().toISOString();
  }

  applyFrame(device, frame) {
    device.framebuffer.applyFrame(frame);
  }

  recordAck(device, ackMs) {
    device.lastAckMs = ackMs;
    device.maxAckMs = Math.max(device.maxAckMs, ackMs);
  }

  disconnect(device, socket) {
    if (device.socket !== socket) return;
    device.connected = false;
    device.socket = null;
    this.emit('change', this.serialize(device));
  }

  serialize(device) {
    const { socket, framebuffer, programController, ...publicDevice } = device;
    if (programController?.lastError) publicDevice.appError = programController.lastError;
    if (programController?.loadedRevision) publicDevice.appRevision = programController.loadedRevision;
    if (programController?.dataStatus) publicDevice.dataStatus = programController.dataStatus;
    return publicDevice;
  }

  list() {
    return Array.from(this._devices.values(), (device) => this.serialize(device));
  }

  get(id) {
    return this._devices.get(id) || null;
  }
}

module.exports = { DeviceRegistry };
