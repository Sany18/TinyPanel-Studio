'use strict';

const { duplexPair } = require('stream');
const { ACK_BYTE } = require('./protocol');

// Stands in for a physical ESP32 so Device Studio's debug/preview views and
// the canvas program's ACK-lockstep loop (see server.js's runLockstep) can
// run with no hardware attached. Two in-memory duplex streams (Node's
// stream.duplexPair - no real socket/TCP involved) replace the net.Socket a
// real display connection would hand to index.js's connection handler; the
// "device" side just echoes one ACK_BYTE back for every frame it receives,
// after ackDelayMs, standing in for real draw/SPI time.
function createVirtualDevice({ ackDelayMs = 16 } = {}) {
  const [serverSide, deviceSide] = duplexPair();

  // registry.register()/runLockstep only touch these few net.Socket members.
  serverSide.remoteAddress = 'sim';
  serverSide.remotePort = 0;
  serverSide.setNoDelay = () => {};

  deviceSide.on('data', () => {
    if (ackDelayMs > 0) setTimeout(() => deviceSide.write(Buffer.from([ACK_BYTE])), ackDelayMs);
    else deviceSide.write(Buffer.from([ACK_BYTE]));
  });
  deviceSide.on('error', () => {});

  return serverSide;
}

module.exports = { createVirtualDevice };
