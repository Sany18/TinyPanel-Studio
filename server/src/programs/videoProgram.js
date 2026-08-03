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
    this.timer = null;
    this.generatedFrame = 0;
    this.frames = [];
    this.waiters = [];
    this.lastError = null;
  }

  start() {
    if (this.process || this.timer) return;
    if (!this.source && this._startGeneratedClock()) return;
    const input = this.source
      ? ['-re', '-i', this.source]
      : ['-f', 'lavfi', '-i', `smptebars=size=160x128:rate=${this.fps}`];
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

  _startGeneratedClock() {
    let createCanvas;
    try {
      ({ createCanvas } = require('canvas'));
    } catch {
      return false;
    }
    const canvas = createCanvas(160, 128);
    const context = canvas.getContext('2d');
    const colors = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff'];
    const render = () => {
      context.fillStyle = '#05070c';
      context.fillRect(0, 0, 160, 128);
      const barWidth = Math.ceil(160 / colors.length);
      colors.forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(index * barWidth, 22, barWidth, 72);
      });
      context.fillStyle = '#111827';
      context.fillRect(0, 94, 160, 34);
      context.fillStyle = '#25324a';
      context.fillRect(this.generatedFrame % 160, 94, 2, 34);
      context.fillStyle = '#05070c';
      context.fillRect(0, 0, 160, 22);
      context.fillStyle = '#ffffff';
      context.font = 'bold 16px monospace';
      context.textBaseline = 'top';
      const time = new Date().toLocaleTimeString('uk-UA', { hour12: false });
      context.fillText(time, 39, 2);
      this.generatedFrame++;
      this._publish(canvas.toBuffer('image/jpeg', { quality: 0.72, chromaSubsampling: false }));
    };
    render();
    this.timer = setInterval(render, 1000 / this.fps);
    return true;
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
    if (!this.process && !this.timer) this.start();
    const jpeg = this.frames.shift() || await new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    return new FrameBuilder().jpegFrame(jpeg);
  }

  stop() {
    if (this.process) this.process.kill('SIGTERM');
    if (this.timer) clearInterval(this.timer);
    this.process = null;
    this.timer = null;
  }
}

module.exports = { MjpegParser, VideoProgram };
