# TinyPanel Studio server

Node.js TCP server that streams binary draw commands to
[display client firmware](../firmware/display-client)
over the LAN, per [DISPLAY_PROTOCOL.md](../DISPLAY_PROTOCOL.md). The ESP32
does no drawing logic of its own - "programs" (what to actually draw, and
when) live here instead, so changing what's on screen doesn't require
reflashing the board.

The `synthwave` program needs nothing beyond Node's built-in `net` module -
one persistent raw TCP stream with a single client and tiny fixed-format
binary frames, no framework needed. The `html` program (see below) pulls in
`puppeteer` and `pngjs` to render and diff HTML/CSS pages.

## Run

```bash
node src/index.js
```

Listens on port `8765` by default (override with `DISPLAY_SERVER_PORT`).
Flash the ESP32 firmware first with `DISPLAY_SERVER_HOST`/`PORT` pointed at
this machine's LAN IP - the ESP32 connects out to this server, not the other
way around. Also starts a browser debug viewer at `http://localhost:8766` by
default - see "Debug viewer" below.

Runs the `synthwave` program by default. To stream a static HTML/CSS page
instead:

```bash
DISPLAY_SERVER_PROGRAM=html DISPLAY_SERVER_HTML_PATH=pages/clock.html node src/index.js
```

`DISPLAY_SERVER_HTML_PATH` defaults to `pages/clock.html` if omitted.

To run the direct RGB565 Canvas-like renderer (the preferred production path):

```bash
npm run start:canvas
```

## App library and Device Studio

Canvas applications live under `apps/<app-id>/`:

```text
apps/pixel-runner/
  manifest.json
  main.canvas.js
```

Open Device Studio at `http://localhost:8766` to select an application, create
a new one, edit its Canvas source, and see autosaved changes immediately on the
connected ESP32. The active application is switched without restarting the
server or reconnecting the display. `.active-app` is local runtime state and is
not committed.

The built-in editor uses locally bundled CodeMirror 6 with JavaScript syntax
highlighting, line numbers, code folding, bracket matching, search,
undo/redo, and Tab indentation. No editor assets are loaded from a CDN.
`npm start`, `npm run start:canvas`, and `npm run start:html` rebuild the browser
bundle automatically; use `npm run build:editor` to build it explicitly.

The current Canvas app contract is a global `render(ctx, state)` function.
`state` exposes `frame`, `time`, `width`, `height`, and `revision`. Invalid
source is rejected before saving; runtime errors preserve the last valid
framebuffer.

The Canvas API currently provides `clear`, `fillRect`, `drawLine`,
`fillCircle`, `fillTriangle`, and compact bitmap `drawText`. Apps with a
server-side data source receive its cached snapshot as `state.data`; network
requests never run inside `render()` or block the display ACK loop.

The built-in **Crypto Tracker** app ports the original BTCUSDT synthwave-style
candlestick widget to this model. Node polls Binance Futures, while the Canvas
app renders price, percentage change, candles, symbol/interval, and live/stale
status. Its manifest exposes symbol, interval, candle count, and poll interval
for the future generated settings UI.

### Optional diagnostics and firmware

Device Studio keeps diagnostics off by default. Enable each feature separately:

- **Transfer speed** calculates current application payload rate from device
  byte counters.
- **Serial Monitor** opens the configured USB serial port only while enabled
  and streams a bounded log into the browser.
- **Firmware build/flash** builds firmware versioned by
  `firmware/display-client/version.json`, archives the `.bin` under
  `firmware-builds/`, and can flash the connected ESP32 after confirmation.

Serial and firmware mutation endpoints are localhost-only. Flash automatically
stops Serial Monitor first so the two processes cannot compete for the USB
port. Override the default port with `DISPLAY_SERIAL_PORT`.

## Open-source support

This project is intended for open-source publication. If you find it useful,
support development at [donatello.to/hoxz](https://donatello.to/hoxz).

TinyPanel Studio is licensed under the repository's [MIT License](../LICENSE).

## Layout

- `src/protocol.js` - opcode constants + `FrameBuilder`, a small class whose
  methods (`fillRect`, `fillCircle`, `fillTriangle`, `drawLine`, `fillScreen`,
  `frameEnd`) each append the matching wire-format bytes from
  `DISPLAY_PROTOCOL.md` and return `this` for chaining. `toBuffer()` concats
  everything queued into one frame's worth of bytes.
- `src/programs/synthwave.js` - the built-in synthwave protocol demo. Its
  drawing functions take a
  `FrameBuilder` instead of calling `TFTscreen.*` directly.
- `src/programs/htmlProgram.js` - `HtmlProgram` renders a static HTML/CSS
  file (e.g. `pages/clock.html`) via headless Chromium (Puppeteer), converts
  each screenshot to RGB565, and diffs it tile-by-tile (16x16, 80 tiles
  total) against the previous frame so only changed tiles get sent as
  `BLIT_TILE` commands - see `DISPLAY_PROTOCOL.md`'s "Tile blit" section.
- `src/server.js` - `runLockstep(socket, produceFrame)` is the shared
  ACK-lockstep engine (`produceFrame` may be sync or return a `Promise`);
  `runSynthwave` and `runHtmlProgram` are both thin wrappers around it.
  Exactly one frame is ever in flight.
- `src/index.js` - `net.createServer(...)`, hands each connection to either
  `runSynthwave` or `runHtmlProgram` depending on `DISPLAY_SERVER_PROGRAM`.
- `pages/` - static HTML/CSS content for the `html` program (e.g.
  `clock.html`). Kept separate from `src/programs/` (JS driver modules) to
  avoid the two having the same name mean different things.
- `src/debugServer.js` + `debug/` - browser debug viewer, on by default (see
  "Debug viewer" below).

## Debug viewer

Mirrors the *exact bytes* being sent to the real ESP32 into a browser
`<canvas>`, decoded client-side (`debug/client.js`) with the same opcode
logic the `.ino`'s `dispatch()` uses - not a re-render, a byte-for-byte
replay of what's actually on the wire (including which tiles the diffing
in `htmlProgram.js` decided to skip). Only shows something once a real
client (the ESP32) is connected and being sent frames - it's a tap, not an
independent source.

The Device Studio retains one bounded RGB565 framebuffer per client rather than
frame history. A viewer connecting at any time receives one full snapshot and
then live diffs. Because the
debug view only updates when the real ESP32 does (same underlying
`frameBus` event), a stall on the physical panel and a stall in the debug
view are the same stall, not two independent problems - it confirms
*something* paused the lockstep loop, not *what*.

On by default at `http://localhost:8766` - idle cost is negligible (a
listening socket plus a no-op `EventEmitter` check per frame when no browser
tab is open, see `src/server.js`'s `frameBus`), so it's fine to leave it
running alongside either program. Override the port with
`DISPLAY_SERVER_DEBUG_PORT=<port>`, or disable entirely with
`DISPLAY_SERVER_DEBUG_PORT=0`.

## Adding a new program

Two ways to add a program:
- **Vector**: any function `(fb, ...) => void` that calls `FrameBuilder`
  methods - see `programs/synthwave.js`.
- **HTML/CSS**: any static file under `pages/`, pointed at via
  `DISPLAY_SERVER_HTML_PATH` - see `programs/htmlProgram.js`. No live
  dev-server/SSR support yet, static files only.

There's no program-selection *protocol* yet (selection is a startup env var,
not something the ESP32 or wire format knows about) - see
[DISPLAY_PROTOCOL.md](../DISPLAY_PROTOCOL.md)'s reserved `0xF1`-`0xFF` range
for where that would go if it's ever needed.
