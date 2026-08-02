'use strict';

const { CanvasRenderer } = require('../render/canvas565');

// Minimal production-path example. The app redraws its logical scene while
// CanvasRenderer compares final RGB565 buffers and transmits only dirty tiles.
class CanvasDemo {
  constructor() {
    this.renderer = new CanvasRenderer();
    this.frame = 0;
  }

  nextFrame() {
    const x = this.frame % 190 - 15;
    const result = this.renderer.render((ctx) => {
      ctx.clear('#080018');
      ctx.fillStyle = '#ff3ca6';
      ctx.fillCircle(80, 64, 28);
      ctx.fillStyle = '#39d9ff';
      ctx.fillRect(x, 92, 16, 16);
      ctx.strokeStyle = '#6c63ff';
      for (let y = 96; y < 128; y += 8) ctx.drawLine(0, y, 159, y);
    });
    this.frame++;
    return result.frame;
  }
}

module.exports = { CanvasDemo };
