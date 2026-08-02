'use strict';

const fs = require('fs');
const vm = require('vm');
const { PNG } = require('pngjs');
const { CanvasRenderer } = require('./server/src/render/canvas565');

const source = fs.readFileSync('./apps/synthwave/main.canvas.js', 'utf8');

const context = vm.createContext({ Math, Date, console });
const script = new vm.Script(
  `'use strict';\n${source}\nglobalThis.__render = render;`,
  { filename: 'main.canvas.js' },
);
script.runInContext(context);

const renderer = new CanvasRenderer();
context.ctx = renderer.canvas;

const frames = [0, 40];
frames.forEach((frame, i) => {
  context.state = { frame, time: Date.now(), width: renderer.width, height: renderer.height };
  new vm.Script('__render(ctx, state)').runInContext(context);

  const image = renderer.nativeContext.getImageData(0, 0, renderer.width, renderer.height);
  const scale = 3;
  const png = new PNG({ width: renderer.width * scale, height: renderer.height * scale });
  for (let y = 0; y < renderer.height; y++) {
    for (let x = 0; x < renderer.width; x++) {
      const srcIdx = (y * renderer.width + x) * 4;
      const r = image.data[srcIdx]; const g = image.data[srcIdx + 1];
      const b = image.data[srcIdx + 2]; const a = image.data[srcIdx + 3];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = x * scale + sx; const py = y * scale + sy;
          const idx = (py * png.width + px) * 4;
          png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = a;
        }
      }
    }
  }
  const out = `/private/tmp/claude-501/-Users-alex-allProjs-TinyPanel-Studio/fc7593b1-f808-4861-8d37-3c59db020e77/scratchpad/synthwave-frame${i}.png`;
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
});
