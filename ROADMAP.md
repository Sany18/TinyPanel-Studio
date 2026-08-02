# ESP32 display platform

## Product idea

1. Use ESP32 displays as thin clients of a main PC/server.
2. Build display apps with familiar web-style technologies and APIs.
3. Support independent/offline apps that can be installed on ESP32 over Wi-Fi.

All three goals are feasible, but goal 3 has two distinct meanings:

- **Firmware OTA** replaces the complete firmware image. It supports arbitrary
  native Arduino/ESP-IDF applications, but only one installed firmware runs at
  a time and a broken image needs rollback/recovery.
- **App packages** keep a stable display runtime on ESP32 and upload assets,
  configuration, or interpreted scripts to LittleFS. This gives a safer app
  switcher and offline operation, but apps are limited to APIs exposed by the
  runtime and cannot be arbitrary native binaries.

The initial product should implement app packages first and retain signed OTA
for updating the runtime itself. Arbitrary native app OTA can be an advanced
developer feature later.

## Product decisions

- The production rendering API is Canvas-like JavaScript backed by a direct
  server-side framebuffer. General HTML/DOM/CSS rendering is out of the core
  scope; a Chromium adapter may remain an optional compatibility tool.
- Offline execution is optional per device. A server application or the Device
  Manager can explicitly switch a client between server-stream mode and an
  installed offline package.
- The server program includes a web-based **Device Studio** combining Device
  Manager, debugger, live preview, and code editor for 1..n clients. It is one
  product/runtime, while its UI and renderer remain internally decoupled so a
  slow browser tab cannot stall display streaming.
- The first implementation targets exactly one connected ESP32. The internal
  session/registry model remains multi-device-compatible, but device groups,
  per-device drafts, aggregate scheduling, and 1..n management UI are deferred
  until more physical clients are available for real testing.
- The platform will become a standalone open-source product rather than remain
  coupled to the parent Arduino sketch collection. Code editing is an advanced
  capability; the default user journey requires no programming.

## Standalone product and no-code experience

### Default user journey

1. Install and open Device Studio.
2. Select a supported controller and display profile.
3. Review the visual pin-mapping table and wiring diagram.
4. Connect the controller over USB and click Build/Flash.
5. Enter Wi-Fi/server settings through the setup wizard.
6. Select a ready-made application from the library and click Run.

The Canvas code editor remains available under an **Advanced** switch and is
not required for setup, firmware updates, application selection, diagnostics,
or normal operation.

### No-code application configuration

- Ready-made applications expose a JSON-schema-like settings definition in
  their manifest: colors, text, API URLs, refresh interval, units, layout
  options, and secrets/credentials where applicable.
- Device Studio generates forms from that definition and validates values
  before starting the app.
- The first no-code layer is template + properties, not free-form drag/drop.
  A visual scene/widget composer can follow after the app manifest and widget
  APIs are stable.
- App Library supports screenshots, descriptions, required capabilities,
  version, author, license, install/run actions, and safe defaults.

### Distribution

- Keep a monorepo with independently publishable components: firmware client,
  protocol, renderer/app SDK, server runtime, Device Studio, built-in apps, and
  documentation.
- Provide a local web/server distribution for developers and a packaged desktop
  application for non-technical users. The desktop package owns local Node
  services and USB access, avoiding Docker/serial permission setup.
- Optionally provide a hosted HTTPS firmware installer using Web Serial for
  Chromium-based browsers. Streaming apps still require a local server/runtime.
- Release signed desktop installers, checksums, versioned firmware binaries,
  and a one-command developer setup.

### Proposed standalone repository layout

```text
esp32-display-studio/
  apps/studio/              # built-in web/desktop UI
  packages/server/          # TCP data plane + management API
  packages/renderer/        # Canvas/RGB565/diff pipeline
  packages/protocol/        # shared protocol definitions and tooling
  packages/app-sdk/         # app lifecycle, manifest and settings APIs
  firmware/display-client/  # PlatformIO ESP32 runtime
  examples/apps/            # ready-to-run no-code-configurable apps
  docs/                     # setup, wiring, supported hardware
```

## Proposed architecture

### ESP32 runtime

- Persistent Wi-Fi/TCP client with reconnect and disabled modem sleep while
  streaming.
- Protocol handshake advertising display size, pixel format, protocol version,
  supported drawing opcodes, compression support, firmware version, and device
  ID.
- Stream mode for server-driven apps.
- Offline package mode backed by LittleFS for assets/configuration and,
  optionally, a constrained script or scene interpreter.
- Explicit, acknowledged mode transitions: `STREAM`, `OFFLINE(appId)`, and
  `SAFE/RECOVERY`. The device persists the selected fallback mode and reports
  its active/requested mode to the server.
- Offline mode stops frame streaming, not device management: networking and the
  lightweight control connection remain alive so the server can inspect the
  device and switch it back to `STREAM`. Offline drawing must yield regularly
  and cannot block the control/network task.
- A/B OTA partitions, image verification, automatic rollback, and a physical
  or timed recovery path.
- Runtime metrics: FPS, bytes, receive time, draw time, RSSI, reconnects, heap,
  and protocol errors.

### Server

- Device registry and per-device session/capability state.
- App registry with a manifest, entry point, dimensions, permissions, assets,
  and supported execution mode.
- One logical scene/framebuffer per app instance; independent diff state for
  every connected display.
- Fixed target cadence for animated apps. Never queue stale rendered frames:
  keep at most one frame in flight and render the newest state after ACK.
- A bounded current framebuffer for previews/debugging, never an unbounded
  history of encoded frames.

### Built-in Device Studio

- A built-in web application served by the display server. It uses the same
  documented management API that is available to automation, rather than
  reaching directly into renderer internals.
- Displays 1..n clients with identity, online state, active mode/app, firmware,
  dimensions/capabilities, RSSI, FPS, latency, heap, and errors.
- Receives a full current-frame snapshot on preview connect, then live diffs;
  preview never controls the display frame loop and stores no frame history.
- Assigns server apps, requests `STREAM`/`OFFLINE` transitions, configures FPS
  and device settings, installs packages, and performs signed runtime OTA.
- Uses authentication and role checks for package/OTA operations. Management
  commands are request/response operations with IDs, timeouts, and audit logs.

### Built-in app editor and live workflow

- Project/file browser, Canvas-like JavaScript editor, asset browser, console,
  diagnostics, formatter, and app manifest/settings editor in Device Studio.
- Select one or more target ESP32 clients and run a draft without installing or
  publishing it. A source change is debounced, validated, evaluated in an
  isolated app worker, rendered into the current framebuffer, diffed, and sent
  immediately to the selected devices.
- Preserve application state when safe through hot reload; provide an explicit
  full restart when module shape or manifest changes.
- Every source revision gets a monotonically increasing revision ID. When a new
  revision starts, pending work from older revisions is cancelled/coalesced so
  stale frames can never overwrite the newest edit.
- Syntax/runtime errors stop only the draft worker, keep the last valid frame
  on ESP32, and appear in the editor with stack trace and source location.
- Provide **Draft**, **Published**, and **Installed offline** states. Autosave
  writes drafts; publishing is explicit and produces a versioned, reproducible
  app package.
- Live preview can target a virtual framebuffer, a physical ESP32, or both.
  The physical-device view uses the server's actual current framebuffer and
  transport metrics, not an independent browser reimplementation.
- Per-device full-sync is available after reconnect, target change, renderer
  restart, or protocol error.

The server therefore has two independent planes:

- **Data plane:** latency-sensitive frames and ACKs between renderer and ESP32.
- **Control plane:** devices, editor drafts, apps, metrics, commands, packages,
  and OTA used by Device Studio and automation. A slow Studio browser tab must
  never stall rendering.

### App execution modes

1. **Canvas-like scene/vector API — primary**
   
   A JavaScript API inspired by Canvas 2D (`fillRect`, `line`, `text`, bitmap,
   paths where supported) emits compact drawing commands. Best for clocks,
   dashboards, charts, menus, and low traffic.

2. **Direct raster framebuffer — primary for animation**
   
   Apps render in Node using Canvas/Skia or directly into an RGB565 buffer.
   The server diffs the current and previous buffers and sends dirty regions.
   This avoids Chromium and PNG entirely.

3. **HTML/CSS compatibility — optional adapter**
   
   Not part of the production core. If retained, headless Chromium can adapt
   existing HTML to raw frames for development/migration; PNG screenshots are
   never the primary rendering path.

4. **Offline package — later**
   
   A declarative scene, assets, and optional constrained script run in the
   stable ESP32 runtime when the server is unavailable.

## Rendering optimization plan

### Baseline and instrumentation

- Keep the existing server ACK/build/event-loop metrics and ESP32
  receive/draw/RSSI metrics.
- Add per-frame changed-pixel/tile count, encoded size, compression time, and
  dropped/coalesced-frame counters.
- Create repeatable scenes: static clock, partial-update dashboard, scrolling
  text, and full-screen animation.

### Remove avoidable conversions

- Represent the canonical server framebuffer as RGB565 (`160 * 128 * 2 =
  40,960` bytes for the current panel).
- For Canvas rendering, acquire raw RGBA and convert directly to RGB565.
- Avoid `screenshot -> PNG encode -> PNG decode -> RGBA -> RGB565` except in
  arbitrary HTML compatibility mode.
- Reuse buffers instead of allocating buffers and 80 tile objects every frame.

### Improve diff and transport

- Keep 16x16 tiles as the simple baseline.
- Merge horizontally/vertically adjacent dirty tiles into dirty rectangles so
  the ESP32 performs fewer `setAddrWindow()`/SPI transactions.
- Add a variable-size `BLIT_RECT` opcode with explicit width, height, payload
  length, and bounds validation.
- Choose adaptively per frame between vector commands, dirty rectangles, and a
  full-screen blit.
- Benchmark lightweight RGB565 RLE first. Add a second codec only if measured
  network savings exceed ESP32 decode cost.
- Send changed regions in display scan order and retain frame-level ACK so old
  frames cannot build up.

### Protocol v2

- Connection preamble with magic, version, device/capabilities, and negotiated
  limits.
- Framed messages containing type, sequence number, payload length, and CRC.
- Explicit `FRAME_BEGIN`, `FRAME_END`, `FULL_SYNC`, `PING`, and error/reset
  messages.
- Maximum sizes and validation for every payload; unknown messages can be
  skipped safely by length.
- Optional authenticated pairing and encrypted transport for non-trusted LANs.
- Control messages for mode query/switch, app inventory/activation, metrics,
  package transfer status, and OTA status. Long transfers use a separate
  channel or are rate-limited so they cannot block frame ACKs.

## Delivery roadmap

### Phase 1 — stabilize the existing streamer

- Keep bulk TCP reads and bounded memory behavior.
- Add protocol/parser tests and a synthetic network-latency test.
- Make debug preview use the current framebuffer/full snapshot, followed by
  live diffs, so it can connect at any time without frame history.
- Add target FPS configuration and performance summaries.
- Replace the current debug page with the first built-in Device Studio screen:
  a read-only device list, live metrics, and framebuffer snapshot API.

**Done when:** synthwave runs for several hours without visible stalls,
unbounded memory growth, reconnect corruption, or stale-frame buildup.

### Phase 2 — fast server renderer

- Introduce a reusable RGB565 framebuffer and buffer pool.
- Add a Node Canvas/Skia renderer and Canvas-like app API.
- Implement dirty-rectangle merging and `BLIT_RECT`.
- Benchmark it against Puppeteer/PNG using the repeatable scenes.
- Add the editor MVP: file editing, autosave, isolated draft worker, diagnostics,
  target-device selector, debounced hot reload, revision cancellation, and
  immediate rendering on a physical ESP32.

**Done when:** partial UI updates remain compact and full-screen rendering is
limited mainly by Wi-Fi/SPI rather than PNG or allocation overhead, and a saved
Canvas app change appears reliably on the selected ESP32 without server restart.

### Phase 3 — app platform and Device Studio control

- Define an app manifest and lifecycle (`install`, `start`, `stop`, `tick`,
  input events, cleanup).
- Add server-side app discovery, selection, hot reload, and per-device config.
- Package assets locally and expose a small stable graphics/input SDK.
- Add the management API and Device Studio actions for app assignment,
  start/stop, settings, and per-device target FPS.
- Add versioned publish/install flows, asset management, console output, and
  rollback from a broken draft or published version.

**Done when:** a new clock/dashboard app can be added without editing server
core code or reflashing ESP32.

### Phase 4 — protocol v2 and multiple devices

- Implement capability negotiation, sequence numbers, CRC, full resync, and
  device identity.
- Maintain separate diff/session state per client and add bandwidth/FPS limits.
- Add pairing/authentication before exposing OTA or app installation.
- Separate frame streaming from management traffic and make mode changes
  acknowledged, observable, and safe to retry.

**Done when:** displays with different sizes or capabilities can safely run
different app instances from one server.

This phase is explicitly deferred. Do not add multi-device product complexity
to the single-device editor/runtime before at least two physical clients are
available for integration and load testing.

### Phase 5 — Wi-Fi installation and offline apps

- Add signed A/B OTA for the stable ESP32 runtime.
- Add transactional package upload to LittleFS: upload temporary package,
  verify hash/signature and space, then atomically activate it.
- Start with declarative scenes/assets; add a constrained script engine only if
  real applications require it.
- Provide rollback to the last working runtime/package and a recovery mode.
- Allow a server app or Device Studio to request offline activation and later
  return the device to streaming without reflashing it.

**Done when:** an interrupted or invalid upload cannot brick the device and an
installed package can display useful content while the server is offline.

## Feasibility and limits

| Goal | Feasible | Main constraint |
|---|---|---|
| ESP32 as PC/server client | Yes; working now | Wi-Fi latency and SPI throughput |
| Apps built with Canvas-style APIs | Yes | API is a defined subset, not a browser DOM |
| Fast Canvas/scene apps | Yes | API will be a useful subset, not a complete browser |
| Multiple simultaneous displays | Yes | Per-client diff state and aggregate bandwidth |
| Upload arbitrary native apps over Wi-Fi | Yes, via OTA | Security, rollback, one firmware image at a time |
| Install multiple switchable offline apps | Yes, with a runtime/package model | Flash/RAM limits and restricted app API |
| Run a full browser on ESP32-C3 | No | Insufficient RAM/CPU; browser remains server-side |
| Smooth full-screen 50 FPS raster streaming | Potentially, but not guaranteed | About 2 MB/s payload plus SPI and Wi-Fi overhead |

## Remaining decisions

1. Does "upload an app" include arbitrary native firmware for developers, or
   only safe app packages plus OTA updates of the stable runtime?
2. Which offline application model comes first: declarative scenes only or a
   constrained scripting engine?
3. Is the editor initially single-user/trusted-LAN only? Untrusted multi-user
   code requires process/container isolation; a Node worker alone is fault
   isolation, not a security boundary.
