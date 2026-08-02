'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DeviceRegistry } = require('../src/deviceRegistry');

function fakeSocket(address, port) {
  return {
    remoteAddress: address,
    remotePort: port,
    destroyed: false,
    destroy() { this.destroyed = true; },
  };
}

test('registers and serializes a client without exposing its socket', () => {
  const registry = new DeviceRegistry();
  const device = registry.register(fakeSocket('::ffff:192.168.1.20', 1234));
  registry.recordFrame(device, 386);
  registry.recordAck(device, 19.5);

  assert.deepEqual(registry.list().map(({ connectedAt, lastFrameAt, ...rest }) => rest), [{
    id: '192.168.1.20',
    address: '192.168.1.20',
    port: 1234,
    connected: true,
    mode: 'stream',
    program: null,
    frames: 1,
    bytes: 386,
    lastAckMs: 19.5,
    maxAckMs: 19.5,
  }]);
});

test('reconnect replaces an existing session for the same temporary ID', () => {
  const registry = new DeviceRegistry();
  const oldSocket = fakeSocket('192.168.1.20', 1000);
  const oldDevice = registry.register(oldSocket);
  const newSocket = fakeSocket('192.168.1.20', 2000);
  const newDevice = registry.register(newSocket);

  assert.equal(oldSocket.destroyed, true);
  registry.disconnect(oldDevice, oldSocket);
  assert.equal(registry.list()[0].connected, true);
  assert.equal(newDevice.port, 2000);
});
