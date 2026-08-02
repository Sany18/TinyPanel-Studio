'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MjpegParser } = require('../src/programs/videoProgram');

test('extracts complete JPEG images from arbitrarily split MJPEG chunks', () => {
  const frames = [];
  const parser = new MjpegParser((frame) => frames.push(frame));
  const first = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const second = Buffer.from([0xff, 0xd8, 3, 4, 5, 0xff, 0xd9]);
  parser.push(Buffer.concat([Buffer.from('noise'), first.subarray(0, 3)]));
  parser.push(Buffer.concat([first.subarray(3), second, Buffer.from('tail')]));
  assert.deepEqual(frames, [first, second]);
});
