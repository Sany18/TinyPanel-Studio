'use strict';

const { spawn } = require('node:child_process');
const { FrameBuilder, MAX_JPEG_BYTES } = require('../protocol');

class MjpegParser {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 1));
        return;
      }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        if (start > 0) this.buffer = this.buffer.subarray(start);
        if (this.buffer.length > MAX_JPEG_BYTES) throw new RangeError('MJPEG frame exceeds protocol limit');
        return;
      }
      const frame = this.buffer.subarray(start, end + 2);
      if (frame.length <= MAX_JPEG_BYTES) this.onFrame(Buffer.from(frame));
      this.buffer = this.buffer.subarray(end + 2);
    }
  }
}

class VideoProgram {
  constructor({ source = null, fps = 20, ffmpeg = 'ffmpeg' } = {}) {
    this.source = source;
    this.fps = Math.max(1, Math.min(30, Number(fps) || 20));
    this.ffmpeg = ffmpeg;
    this.process = null;
    this.frames = [];
    this.waiters = [];
    this.lastError = null;
  }

  start() {
    if (this.process) return;
    const input = this.source
      ? ['-re', '-i', this.source]
      : ['-f', 'lavfi', '-i', `testsrc2=size=160x128:rate=${this.fps}`];
    const args = [
      '-hide_banner', '-loglevel', 'error', ...input,
      '-vf', 'scale=160:128:force_original_aspect_ratio=decrease,pad=160:128:(ow-iw)/2:(oh-ih)/2:black',
      '-an', '-r', String(this.fps), '-c:v', 'mjpeg', '-q:v', '7', '-f', 'image2pipe', 'pipe:1',
    ];
    const child = spawn(this.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    const parser = new MjpegParser((frame) => this._publish(frame));
    child.stdout.on('data', (chunk) => {
      try { parser.push(chunk); } catch (error) { this.lastError = error; child.kill(); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (message) => { this.lastError = new Error(message.trim()); });
    child.on('error', (error) => { this.lastError = error; this._rejectWaiters(error); });
    child.on('exit', (code, signal) => {
      if (this.process === child) this.process = null;
      if (code && !this.lastError) this.lastError = new Error(`ffmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`);
      this._rejectWaiters(this.lastError || new Error('video stream ended'));
    });
  }

  _publish(frame) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(frame);
    else {
      this.frames.length = 0;
      this.frames.push(frame);
    }
  }

  _rejectWaiters(error) {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async nextFrame() {
    if (!this.process) this.start();
    const jpeg = this.frames.shift() || await new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    return new FrameBuilder().jpegFrame(jpeg);
  }

  stop() {
    if (this.process) this.process.kill('SIGTERM');
    this.process = null;
  }
}

module.exports = { MjpegParser, VideoProgram };
