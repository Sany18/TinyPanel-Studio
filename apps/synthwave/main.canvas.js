/**
 * @tinypanel
 * @name Synthwave
 * @description Animated retro sun, mountains, and perspective grid
 * @width 160
 * @height 128
 * @orientation landscape-reversed
 * @fps 30
 * @wifiSleep false
 * @cpuMultiplier 0.5
 */

const WIDTH = 160;
const HEIGHT = 128;
const HORIZON = 64;
const GROUND = '#00000070';
const GRID = '#d90280';
const GRID_GLOW = '#4a0135';
const GRID_HAZE = '#9c0166';
const SKY = '#340038';
const SUN = '#fa9e00';
const MOUNTAIN = '#593a55';
const MOUNTAIN_DARK = '#4a083f';
const MOUNTAIN_SHADOW = '#5c051b';
const BUILDING = '#220c38';
const BUILDING_LIGHT = '#ffb454';
const BUILDING_LIGHT_DIM = '#a9702f';
const BEACON = '#ff2020';
const SUN_R = 28;

// A full flyover cycle: the plane is only actually drawn during the first
// PLANE_FLIGHT frames of each PLANE_CYCLE and stays off-screen the rest of
// the time, so it reads as a rare event rather than a looping animation.
const PLANE_CYCLE = 4500; // 30fps * 150s = spawns roughly every 2.5 minutes
// A cruising jet this high up visibly crawls across the sky - slower than
// something at ground-level scale would read as.
const PLANE_FLIGHT = 180; // ~6s to cross the sky
// How much longer the contrail lingers and dissolves after the plane has
// already crossed a given stretch of sky - a real cloud trail long outlives
// the jet that made it.
const PLANE_CLOUD_LIFETIME = 900; // 30fps * 30s

function lerpColor(from, to, t) {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t);
  };
  return `#${[channel(16), channel(8), channel(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// A dark, backlit silhouette - dim enough to read as "far away", but with
// enough contrast against the sky gradient that its shape actually shows.
const PLANE_BODY = '#3d1428';
// The contrail reads warmer and brighter than the jet that made it (sunlit
// ice crystals catching the sunset vs. a backlit airframe), so it fades
// from its own pale, sun-tinted color rather than the plane's.
const PLANE_CLOUD_COLOR = '#ffe9d1';

// The sky is a vertical gradient (SKY at the top fading to orange toward
// the horizon), not a flat color - so "fading into the background" only
// works if the trail fades toward whatever the gradient actually is at
// that row. Fading toward the flat SKY constant instead left old trail
// stuck at a dark purple that never matched the warmer sky lower down, so
// it looked like a stalled smear instead of dissolving.
function skyColorAt(y) {
  const t = Math.max(0, Math.min(1, y / D_HORIZON));
  return lerpColor(SKY, '#d16500', t);
}

// How much a stretch of trail has faded toward the sky, given how "old" it
// is (0 = just laid down, 1 = about to fully dissolve). Starts already well
// blended (0.4, so even freshly laid trail reads as thin and hazy, not a
// solid painted line) and the exponent front-loads the rest of the fade -
// most of it happens within the first couple of seconds so the tail
// actually dissolves as it's being laid down, instead of dragging behind
// the plane as one uniform ribbon for the whole flight.
function cloudBlendAt(ageFraction) {
  return 0.4 + 0.6 * ageFraction ** 0.3;
}

let D_HORIZON = HORIZON;
let skyGradient = null;
let gridHazeGradient = null;

// Walks the same Bresenham path ctx.drawLine uses internally, flanking each
// step with a dim pixel perpendicular to the line's own slope (sideways for
// steep lines, up/down for shallow ones). Because the halo is built from the
// exact path rather than a separately-rasterized shifted copy, it stays
// glued to the line instead of reading as a second, detached line.
//
// This only paints the dim halo - callers must run this for every grid line
// FIRST, then stroke every bright core in a separate pass afterwards. Near
// the horizon the horizontal lines land only 1-3px apart, so if each line's
// core were drawn right after its own halo, a later line's dim halo could
// land on an earlier line's bright core and overwrite it - the horizon
// would flicker between bright and dim as the lines scrolled. Doing all
// halos before any core guarantees cores always end up on top.
//
// minY clamps the halo to the grid's own territory: the topmost horizontal
// line sits exactly on the horizon, so its upper flank would otherwise land
// one row above it, painting a stray dim pixel into the sky/mountains where
// the ground hasn't started yet.
function glowHalo(x0, y0, x1, y1, minY = -Infinity) {
  x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const steep = -dy > dx;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0, y = y0;

  ctx.fillStyle = GRID_GLOW;
  while (true) {
    if (steep) {
      if (y >= minY) {
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
      }
    } else {
      if (y - 1 >= minY) ctx.fillRect(x, y - 1, 1, 1);
      if (y + 1 >= minY) ctx.fillRect(x, y + 1, 1, 1);
    }
    if (x === x1 && y === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
}

// Cheap deterministic pseudo-random in [0, 1) from an arbitrary seed - not
// Math.random, since the same frame number must always render the same
// scene (a redraw or a hardware reconnect can't change what already
// happened this cycle).
function hash01(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// A rare, distant plane crossing high above the mountains and the sun, with
// a short fading contrail. Each cycle gets its own direction and altitude
// from a hash of the cycle index, so successive flyovers don't all trace
// the same line.
// Nothing here persists between frames - render() gets called fresh each
// tick against a cleared canvas - so a lingering contrail has to be
// reconstructed from scratch every frame: walk every point along the
// flight path the plane has already passed through, and redraw each one
// faded by how long ago ("age") that happened.
// A tiny jet silhouette built from two triangles (a fuselage dart and a
// swept delta wing) around a local (forward, side) axis, then rotated by
// the flight's own heading - so it actually points the way it's flying
// instead of a fixed pixel dab that would look wrong once the flight path
// is diagonal.
function drawJet(cx, cy, heading, color) {
  ctx.fillStyle = color;
  const fwd = Math.cos(heading), side = Math.sin(heading);
  const pt = (f, s) => [cx + fwd * f - side * s, cy + side * f + fwd * s];

  const nose = pt(3, 0);
  const tailTop = pt(-2.5, 1);
  const tailBottom = pt(-2.5, -1);
  ctx.fillTriangle(nose[0], nose[1], tailTop[0], tailTop[1], tailBottom[0], tailBottom[1]);

  const wingFront = pt(0.5, 0);
  const wingLeft = pt(-2, 3);
  const wingRight = pt(-2, -3);
  ctx.fillTriangle(wingFront[0], wingFront[1], wingLeft[0], wingLeft[1], wingRight[0], wingRight[1]);

  return wingLeft;
}

function drawPlane(frame) {
  const cycleIndex = Math.floor(frame / PLANE_CYCLE);
  const t = frame % PLANE_CYCLE;
  if (t >= PLANE_FLIGHT + PLANE_CLOUD_LIFETIME) return;

  const seed = cycleIndex * 17.23 + 4.1;
  const leftToRight = hash01(seed) > 0.5;
  const yStart = 14 + Math.floor(hash01(seed + 1) * 10);
  // A shallow cruise climb or descent rather than a level flight path, like
  // the reference: a straight diagonal line, not a curve. Clamped so it
  // never flies off the top of the sky or down into the sun/mountains.
  const climb = (hash01(seed + 2) > 0.5 ? 1 : -1) * (6 + Math.floor(hash01(seed + 3) * 8));
  const yEnd = Math.max(4, Math.min(36, yStart + climb));

  const span = WIDTH + 24;
  const dx = leftToRight ? span : -span;
  const heading = Math.atan2(yEnd - yStart, dx);
  const positionAt = (flightT) => {
    const progress = flightT / PLANE_FLIGHT;
    const x = Math.round(leftToRight ? progress * span - 12 : span - 12 - progress * span);
    const y = Math.round(yStart + (yEnd - yStart) * progress);
    return [x, y];
  };

  // Only ages whose flightT falls inside [0, PLANE_FLIGHT) actually happened.
  const minAge = Math.max(0, t - PLANE_FLIGHT + 1);
  const maxAge = Math.min(PLANE_CLOUD_LIFETIME - 1, t);
  for (let age = minAge; age <= maxAge; age++) {
    const flightT = t - age;
    const [px, py] = positionAt(flightT);
    const ageFraction = age / PLANE_CLOUD_LIFETIME;
    ctx.fillStyle = lerpColor(PLANE_CLOUD_COLOR, skyColorAt(py), cloudBlendAt(ageFraction));
    // Real contrails start as a thin line right behind the engines and
    // billow outward the longer they've had to disperse - a crisp 1px dot
    // near the jet, growing into soft puffs toward the older, far end.
    const puff = Math.min(3, Math.floor(ageFraction * 6));
    if (puff > 0) ctx.fillCircle(px, py, puff);
    else ctx.fillRect(px, py, 1, 1);
  }

  if (t >= PLANE_FLIGHT) return; // the jet itself has already left the screen

  const [x, y] = positionAt(t);
  const wingtip = drawJet(x, y, heading, PLANE_BODY);

  // Wingtip nav light, blinking faster than the rooftop beacon.
  if (Math.sin(frame * 0.8) > 0.5) {
    ctx.fillStyle = BEACON;
    ctx.fillRect(Math.round(wingtip[0]), Math.round(wingtip[1]), 1, 1);
  }
}

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

function building(x, width, height, spire, beacon, phase) {
  ctx.fillStyle = BUILDING;
  ctx.fillRect(x, D_HORIZON - height, width, height);
  const tipX = x + Math.floor(width / 2);
  const tipY = D_HORIZON - height - spire;
  if (spire) {
    ctx.strokeStyle = BUILDING;
    ctx.drawLine(tipX, tipY, tipX, D_HORIZON - height);
  }
  // A slow-blinking aircraft warning light, like the real ones on tall
  // rooftop antennas - roughly a half-second on, half-second off at this
  // app's 30fps.
  if (beacon && Math.sin(phase * 0.1) > 0) {
    ctx.fillStyle = BEACON;
    ctx.fillRect(tipX, tipY, 1, 1);
  }
}

// A distant skyline tucked beside the mountains on each side - drawn before
// them so the nearer peaks overlap their base and push them back in depth,
// with a couple of lit windows standing in for city lights.
function drawCityscape(phase) {
  building(1, 6, 24, 4, false, phase);
  building(8, 5, 17, 0, false, phase);
  building(151, 7, 29, 5, true, phase);
  building(143, 5, 19, 0, false, phase);

  // A couple of windows burn dim (a lower-wattage lamp, or a room lit only
  // by a TV) instead of every lit window reading at the same brightness.
  const windows = [
    [3, D_HORIZON - 19, BUILDING_LIGHT], [3, D_HORIZON - 13, BUILDING_LIGHT_DIM], [4, D_HORIZON - 8, BUILDING_LIGHT],
    [10, D_HORIZON - 12, BUILDING_LIGHT], [9, D_HORIZON - 6, BUILDING_LIGHT_DIM],
    [153, D_HORIZON - 22, BUILDING_LIGHT_DIM], [154, D_HORIZON - 15, BUILDING_LIGHT], [153, D_HORIZON - 9, BUILDING_LIGHT],
    [145, D_HORIZON - 14, BUILDING_LIGHT], [144, D_HORIZON - 8, BUILDING_LIGHT_DIM],
  ];
  // One window per cluster stays lit permanently - the flicker sines are
  // offset per window but still drift in and out of phase with each other,
  // so occasionally every flickering window dips dark on the same frame and
  // a whole building cluster blinks out. A couple of steady lights keep the
  // skyline from ever going fully black.
  const STATIC_WINDOWS = new Set([2, 7]);
  // Each remaining window flips on/off on its own irregular cycle - two
  // sine waves at incommensurate frequencies, offset per window, so the
  // pattern drifts and never reads as a single synchronized blink like a
  // plain per-frame random roll would.
  windows.forEach(([wx, wy, color], i) => {
    ctx.fillStyle = color;
    if (STATIC_WINDOWS.has(i)) { ctx.fillRect(wx, wy, 1, 1); return; }
    const flicker = Math.sin(phase * 0.013 + i * 3.1) + Math.sin(phase * 0.031 + i * 1.7);
    if (flicker > 0.3) ctx.fillRect(wx, wy, 1, 1);
  });
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

// Amplitude/phase per frond, indexed to match frondAngles below: the two
// outer fronds hang loosest and swing widest in a gust, the near-upright
// center one barely moves, and staggered phases keep them from swaying in
// lockstep like a single rigid fan.
const FROND_WIND_AMP = [7, 4, 2, 4, 7];
const FROND_WIND_PHASE = [0, 1.1, 2.7, 4.2, 5.6];

function palm(x, baseY, height, lean, color, phase) {
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

  frondAngles.forEach((angle, i) => {
    const sway = Math.sin(phase / 20 + FROND_WIND_PHASE[i]) * FROND_WIND_AMP[i];
    frond(crownX, crownY, angle + sway, 14, 2.2, color);
  });
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

  drawPlane(state.frame);

  sunCuts(phase, skyGradient);
  drawCityscape(phase);
  drawMountains();
  palm(46, D_HORIZON - 1, 34, 7, MOUNTAIN_SHADOW, phase);

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, D_HORIZON, WIDTH, HEIGHT - D_HORIZON);

  // Ambient haze where the grid converges, fading into the dark ground -
  // reads as neon light bleeding off the lines near the vanishing point.
  if (!gridHazeGradient) {
    gridHazeGradient = ctx.createLinearGradient(0, D_HORIZON, 0, D_HORIZON + 16);
    gridHazeGradient.addColorStop(0, GRID_HAZE);
    gridHazeGradient.addColorStop(1, '#000000');
  }

  // Every grid line gets a dim halo glued to its own path, then every
  // bright core is stroked on top in its own pass - a cheap stand-in for
  // bloom on this display's flat-fill primitives. The halo/core split (see
  // glowHalo) keeps the densely-packed lines near the horizon from
  // flickering as they scroll.
  const rowY = (line) => Math.trunc((line + (phase % 10 * 0.1)) ** 2) + D_HORIZON;

  for (let line = 0; line <= 8; line++) glowHalo(0, rowY(line), WIDTH - 1, rowY(line), D_HORIZON);
  for (let line = 0; line <= 16; line++) {
    glowHalo(line * 30 - WIDTH, HEIGHT - 1, line * 10, D_HORIZON + 1, D_HORIZON);
  }

  ctx.strokeStyle = GRID;
  for (let line = 0; line <= 8; line++) ctx.drawLine(0, rowY(line), WIDTH - 1, rowY(line));
  for (let line = 0; line <= 16; line++) {
    ctx.drawLine(line * 30 - WIDTH, HEIGHT - 1, line * 10, D_HORIZON + 1);
  }
}
