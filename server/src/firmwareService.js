'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function findSerialPort() {
  if (process.platform === 'win32') return null;
  try {
    const names = fs.readdirSync('/dev');
    const preferred = names.find((name) => /^cu\.usbmodem/i.test(name))
      || names.find((name) => /^cu\.(usbserial|wchusbserial|SLAB_USBtoUART)/i.test(name))
      || names.find((name) => /^tty(USB|ACM)/i.test(name));
    return preferred ? path.join('/dev', preferred) : null;
  } catch (_) {
    return null;
  }
}

class LogStream extends EventEmitter {
  constructor(limit = 200) {
    super();
    this.limit = limit;
    this.lines = [];
  }

  write(channel, text) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      const entry = { at: new Date().toISOString(), channel, line };
      this.lines.push(entry);
      if (this.lines.length > this.limit) this.lines.shift();
      this.emit('line', entry);
    }
  }
}

class FirmwareService {
  constructor({ projectDir, pio = 'pio', env = 'esp32-c3-super-mini', spawnImpl = spawn }) {
    this.projectDir = projectDir;
    this.pio = pio;
    this.env = env;
    this.spawnImpl = spawnImpl;
    this.versionFile = path.join(projectDir, 'version.json');
    this.buildDir = path.join(projectDir, 'firmware-builds');
    this.log = new LogStream();
    this.status = 'idle';
    this.lastBuild = null;
    this.child = null;
  }

  describe() {
    const { version } = JSON.parse(fs.readFileSync(this.versionFile, 'utf8'));
    return { status: this.status, version, environment: this._environment(), lastBuild: this.lastBuild };
  }

  _environment() { return typeof this.env === 'function' ? this.env() : this.env; }

  async build() {
    if (this.child) throw new Error(`firmware service is busy: ${this.status}`);
    const environment = this._environment();
    const result = await this._run('building', ['run', '-e', environment]);
    const { version } = this.describe();
    const buildId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const source = path.join(this.projectDir, '.pio', 'build', environment, 'firmware.bin');
    fs.mkdirSync(this.buildDir, { recursive: true });
    const filename = `display-client-v${version}-${buildId}.bin`;
    const destination = path.join(this.buildDir, filename);
    fs.copyFileSync(source, destination);
    this.lastBuild = { version, buildId, filename, bytes: fs.statSync(destination).size };
    this.log.write('system', `versioned firmware saved: ${filename}`);
    return { ...result, build: this.lastBuild };
  }

  async flash() {
    if (this.child) throw new Error(`firmware service is busy: ${this.status}`);
    return this._run('flashing', ['run', '-e', this._environment(), '-t', 'upload']);
  }

  _run(status, args) {
    this.status = status;
    this.log.write('system', `${this.pio} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.pio, args, { cwd: this.projectDir, env: process.env });
      this.child = child;
      child.stdout?.on('data', (data) => this.log.write('stdout', data));
      child.stderr?.on('data', (data) => this.log.write('stderr', data));
      child.on('error', (error) => {
        this.child = null;
        this.status = 'error';
        this.log.write('system', error.message);
        reject(error);
      });
      child.on('close', (code) => {
        this.child = null;
        if (code === 0) {
          this.status = 'idle';
          resolve({ ok: true });
        } else {
          this.status = 'error';
          reject(new Error(`${this.pio} exited with code ${code}`));
        }
      });
    });
  }
}

class SerialMonitorService {
  constructor({ projectDir, port, baud = 115200, python = '/usr/bin/python3', spawnImpl = spawn }) {
    this.projectDir = projectDir;
    this.port = port;
    this.baud = baud;
    this.python = python;
    this.spawnImpl = spawnImpl;
    this.log = new LogStream(500);
    this.child = null;
  }

  describe() {
    return { running: Boolean(this.child), port: this.port || findSerialPort(), baud: this.baud };
  }

  start() {
    if (this.child) return this.describe();
    const port = this.port || findSerialPort();
    if (!port) throw new Error('ESP32 serial port was not found');
    const reader = path.join(__dirname, '..', 'scripts', 'serial_monitor.py');
    const args = [reader, port, String(this.baud)];
    const child = this.spawnImpl(this.python, args, { cwd: this.projectDir, env: process.env });
    this.child = child;
    this.log.write('system', `serial monitor started: ${port} @ ${this.baud}`);
    child.stdout?.on('data', (data) => this.log.write('serial', data));
    child.stderr?.on('data', (data) => this.log.write('stderr', data));
    child.on('error', (error) => this.log.write('system', error.message));
    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      this.log.write('system', `serial monitor stopped (${code})`);
    });
    return this.describe();
  }

  stop() {
    if (this.child) this.child.kill('SIGINT');
    return { ...this.describe(), stopping: Boolean(this.child) };
  }
}

module.exports = { FirmwareService, SerialMonitorService, LogStream, findSerialPort };
