/**
 * @tinypanel
 * @name Synthwave
 * @description Animated retro sun, mountains, and perspective grid
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 30
 */

const WIDTH = 160;
const HEIGHT = 128;
const HORIZON = 64;
const GROUND = '#000000c0';
const GRID = '#d90280';
const SKY = '#340038';
const SUN = '#fa9e00';
const MOUNTAIN = '#593a55';
const MOUNTAIN_DARK = '#4a083f';
const MOUNTAIN_SHADOW = '#5c051b';
const SUN_R = 28;

let D_HORIZON = HORIZON;
let skyGradient = null;

function mountain(x, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillTriangle(
    x, D_HORIZON - 1,
    x + Math.floor(width / 2), D_HORIZON - 1 - height,
    x + width, D_HORIZON - 1,
  );
}

function drawMountains() {
  mountain(-10, 50, 12, MOUNTAIN_SHADOW);
  mountain(15, 30, 18, MOUNTAIN);
  mountain(35, 20, 10, MOUNTAIN_DARK);
  mountain(122, 20, 10, MOUNTAIN_SHADOW);
  mountain(145, 40, 5, MOUNTAIN_SHADOW);
  mountain(130, 30, 20, MOUNTAIN_DARK);
  mountain(100, 18, 5, MOUNTAIN);
}

// Trunk is a stack of rects that bend further off-axis the higher they go.
// Each frond is a pair of wedge-shaped triangles (wide at the crown,
// tapering to a point) bent partway along its length so it droops - more
// so near the horizontal, like a real palm's outer fronds.
function frond(cx, cy, angleDeg, length, width, color) {
  ctx.fillStyle = color;
  const angle = (angleDeg * Math.PI) / 180;
  const droop = 7 * (1 - Math.sin(angle));

  const midX = cx + Math.cos(angle) * length * 0.55;
  const midY = cy - Math.sin(angle) * length * 0.55;
  const tipX = cx + Math.cos(angle) * length;
  const tipY = cy - Math.sin(angle) * length + droop;

  const perp = angle + Math.PI / 2;
  const px = Math.cos(perp) * width;
  const py = -Math.sin(perp) * width;

  ctx.fillTriangle(cx - px, cy - py, cx + px, cy + py, midX, midY);
  ctx.fillTriangle(
    midX - px * 0.5, midY - py * 0.5,
    midX + px * 0.5, midY + py * 0.5,
    tipX, tipY,
  );
}

function palm(x, baseY, height, lean, color) {
  ctx.fillStyle = color;

  const trunkHeight = Math.round(height * 0.6);
  const segments = 4;
  const segHeight = trunkHeight / segments;
  const trunkWidths = [3, 3, 2, 2];

  for (let i = 0; i < segments; i++) {
    const bend = lean * ((i + 1) / segments) ** 2;
    const y = baseY - (i + 1) * segHeight;
    ctx.fillRect(x + bend, y, trunkWidths[i], segHeight + 1);
  }

  const crownX = x + lean;
  const crownY = baseY - trunkHeight;
  const frondAngles = [12, 50, 90, 130, 168];

  for (const angle of frondAngles) {
    frond(crownX, crownY, angle, 14, 2.2, color);
  }
  // Small canopy hub so the fronds read as leaves fanning out of a crown
  // rather than spikes meeting at a bare point.
  ctx.fillCircle(crownX, crownY, 3);
}

// Offset/height the cut lines were originally tuned at, for a 28px sun
// radius. Scaled by SUN_R / 28 below so they stay proportional if SUN_R
// ever changes.
const SUN_CUTS = [
  { offset: -43, height: 8 },
  { offset: -31, height: 5 },
  { offset: -21, height: 3 },
  { offset: -14, height: 2 },
  { offset: -8, height: 1 },
  { offset: -3, height: 1 },
];

function sunCuts(phase, gradient) {
  const wave = D_HORIZON + Math.sin(phase / 10) + 5;
  const leftSide = WIDTH / 2 - SUN_R;
  const rightSide = WIDTH / 2 + SUN_R;
  const scale = SUN_R / 28;

  ctx.fillStyle = SUN;
  ctx.fillCircle(80, D_HORIZON - 15, SUN_R);

  ctx.fillStyle = gradient;
  for (const { offset, height } of SUN_CUTS) {
    const cutHeight = Math.max(1, Math.round(height * scale));
    ctx.fillRect(leftSide, wave + offset * scale, rightSide, cutHeight);
  }
}

function render(ctx, state) {
  const phase = (state.frame % 1000);
  ctx.clear(SKY);

  // You can shift the camera vertically
  // const cameraShift = Math.sin(phase / 20) + 20;
  // D_HORIZON = HORIZON + cameraShift;
  D_HORIZON = HORIZON + 14;

  if (!skyGradient) {
    skyGradient = ctx.createLinearGradient(0, 0, 0, D_HORIZON);
    skyGradient.addColorStop(0, SKY);
    skyGradient.addColorStop(1, '#d16500');
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, WIDTH, D_HORIZON);

  sunCuts(phase, skyGradient);
  drawMountains();
  palm(46, D_HORIZON - 1, 34, 7, MOUNTAIN_SHADOW);

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, D_HORIZON, WIDTH, HEIGHT - D_HORIZON);

  ctx.strokeStyle = GRID;
  
  for (let line = 0; line <= 8; line++) {
    const y = Math.trunc((line + (phase % 10 * 0.1)) ** 2) + D_HORIZON;
    ctx.drawLine(0, y, WIDTH - 1, y);
  }
  
  for (let line = 0; line <= 16; line++) {
    ctx.drawLine(line * 30 - WIDTH, HEIGHT - 1, line * 10, D_HORIZON + 1);
  }
}
