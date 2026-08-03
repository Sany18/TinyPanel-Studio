# Display protocol

Binary command protocol between the [TinyPanel Studio server](./server) (Node.js,
the "program" runs here) and
[display client firmware](./firmware/display-client)
(ESP32-C3, thin display client — just interprets commands and blits to the
panel). This file is the single source of truth: the `.ino` and the `.js`
share no code, so both sides must match this spec exactly.

One persistent TCP connection, **ESP32 connects out to the server** (server
host/port are plain constants in the `.ino`; Wi-Fi credentials remain in the
gitignored `secrets.h` file.
`TCP_NODELAY` must be enabled on both ends (Nagle's algorithm would otherwise
hold the small ACK packet and throttle the frame rate — see Flow control
below).

## Framing

Every message is `[opcode:1][payload...]`. All multi-byte fields are
**big-endian**. Coordinates/sizes are **signed 16-bit** (`int16_t`), color is
**unsigned 16-bit** (`uint16_t`, RGB565) — matching `Adafruit_GFX`'s own
parameter types exactly, so the firmware dispatcher does zero clamping, just
reassembles bytes and calls straight through. Signed coordinates matter: the
synthwave demo's `drawGroundLines()` deliberately passes off-screen/negative
x values and relies on `Adafruit_GFX` to clip them.

## Opcodes

| Opcode | Name | Payload | Total bytes | Maps to |
|--------|------|---------|--------------|---------|
| `0x01` | `FILL_SCREEN` | `color:u16` | 3 | `fillScreen(color)` |
| `0x02` | `FILL_RECT` | `x,y,w,h:i16×4`, `color:u16` | 11 | `fillRect(x,y,w,h,color)` |
| `0x03` | `FILL_CIRCLE` | `x0,y0,r:i16×3`, `color:u16` | 9 | `fillCircle(x0,y0,r,color)` |
| `0x04` | `FILL_TRIANGLE` | `x0,y0,x1,y1,x2,y2:i16×6`, `color:u16` | 15 | `fillTriangle(x0,y0,x1,y1,x2,y2,color)` |
| `0x05` | `DRAW_LINE` | `x0,y0,x1,y1:i16×4`, `color:u16` | 11 | `drawLine(x0,y0,x1,y1,color)` |
| `0x06` | `SET_ROTATION` | `rotation:u8` (`1` or `3`) | 2 | landscape orientation |
| `0x07` | `SET_POWER_CONFIG` | `wifiSleep:u8`, `cpuPercent:u8` (`50` or `100`) | 3 | Wi-Fi modem sleep and CPU multiplier |
| `0x08`–`0xDF` | *reserved* | — | — | future opcodes |
| `0xE0` | `BLIT_TILE` | `tileIndex:u8`, `pixels:u16×256` | 514 | bulk tile blit (see Tile blit below) |
| `0xE1` | `BLIT_RECT` | `x,y,w,h:u8×4`, `pixels:u16×w×h` | `5 + 2*w*h` | horizontal dirty strip |
| `0xE2` | `JPEG_FRAME` | `length:u16`, `jpeg:u8×length` | `3 + length` | full 160×128 JPEG frame |
| `0xE3`–`0xEF` | *reserved* | — | — | future opcodes |
| `0xF0` | `FRAME_END` | none | 1 | frame boundary (see Flow control) |
| `0xF1`–`0xFF` | *reserved* | — | — | future connection-level control (handshake, ping) |

Max JPEG payload is 32768 bytes, which sizes the ESP32-side receive buffer.
Normal 160×128 video frames are considerably smaller. `rxLen`/`expectedLen`
must be wider than `uint8_t` (max 255).

## Flow control

A single `ACK_BYTE = 0x06` travels in the **opposite** direction (ESP32 →
server). It's a separate one-directional signal, not part of the
server→ESP32 opcode space, so it cannot collide with command opcodes traveling
in the other direction.

**Lockstep frame-level ACK**: after a frame's draw opcodes, the server
appends `FRAME_END` and writes no more bytes until it receives `ACK_BYTE`
back. The ESP32 sends `ACK_BYTE` immediately after dispatching `FRAME_END`,
then keeps parsing. This bounds frames-in-flight to exactly 1 — draw
commands are cheap to *receive* but not instant to *execute* (SPI blit), so
an un-gated sender could race ahead of what's physically on screen.

## Parsing notes (ESP32 side)

Commands will not reliably arrive in one `client.available()`/`read()`
chunk. Use a small accumulation state machine: read the opcode byte, look up
its expected payload length, then bulk-read as many currently available bytes
as fit in the remainder of that command. Dispatch only when the full command
is buffered, then reset. Reset the accumulator on every (re)connect —
a partial command left over from a dropped connection is garbage afterward.

## Tile blit (BLIT_TILE)

The panel's 160×128 area is divided into a fixed grid of 16×16-pixel tiles:
`TILE_SIZE=16`, `TILES_X=10` (160/16), `TILES_Y=8` (128/16), `TILE_COUNT=80`.
Tiles are indexed row-major, 0–79:

```text
tileIndex = tileRow * TILES_X + tileCol   (tileRow: 0-7, tileCol: 0-9)
x = tileCol * TILE_SIZE
y = tileRow * TILE_SIZE
```

Payload layout (513 bytes, not counting the opcode byte):
- byte 0: `tileIndex` (`u8`, valid range 0–79; values ≥80 are undefined
  behavior — the firmware trusts the sender, same convention as every other
  opcode)
- bytes 1–512: 256 pixels, row-major within the tile (left-to-right,
  top-to-bottom), each pixel `u16` RGB565 big-endian. Pixel at tile-local
  `(row, col)` sits at payload offset `1 + (row*16 + col)*2`.

Firmware handling reconstructs each pixel via the same big-endian `readU16()`
byte-reassembly every other opcode already uses (**not** via `writePixels()`'s
`bigEndian=true` parameter — that flag means something different: whether the
in-memory `uint16_t` buffer is pre-byte-swapped, not whether the wire bytes
were big-endian; verified directly against `Adafruit_SPITFT.cpp`: on ESP32
hardware SPI, `writePixels(..., bigEndian=false)` — the default — expects
correctly-valued native-endian `uint16_t`s and does its own swap for the bus,
which is exactly what `readU16()` reconstruction produces), then issues the
whole tile in one bulk transfer:

```cpp
TFTscreen.startWrite();
TFTscreen.setAddrWindow(x, y, TILE_SIZE, TILE_SIZE);
TFTscreen.writePixels(tileBuf, TILE_SIZE * TILE_SIZE);
TFTscreen.endWrite();
```

`BLIT_TILE` remains the smallest fixed raster command and is retained for
compatibility. The Canvas renderer prefers vector opcodes for supported solid
primitives and emits `BLIT_RECT` when browser Canvas features require raster
fallback.

## Dirty rectangle blit (BLIT_RECT)

`BLIT_RECT` merges horizontally adjacent dirty 16x16 tiles into one SPI
transaction. Its five-byte header is `[0xE1][x:u8][y:u8][w:u8][h:u8]`, followed
by `w*h` row-major big-endian RGB565 pixels. Current protocol limits are
`1 <= w <= 160`, `1 <= h <= 16`, and the rectangle must remain inside 160x128.
The 16-pixel height cap bounds both the receive buffer and native pixel buffer
on ESP32. A full frame is eight 160x16 strips rather than 80 tile transactions.

Unlike fixed-size opcodes, the ESP32 parser first accumulates the five-byte
header, validates dimensions and buffer bounds, then calculates
`expectedLen = 5 + 2*w*h`. Invalid rectangles terminate the TCP connection so
the next connection starts from an unambiguous command boundary.

## JPEG frame (JPEG_FRAME)

`JPEG_FRAME` carries one complete baseline JPEG image. Its header is
`[0xE2][length:u16 big-endian]`, followed by exactly `length` bytes beginning
with JPEG SOI (`FF D8`) and ending with EOI (`FF D9`). The current limit is
32 KiB. Firmware decodes MCU blocks with `TJpg_Decoder` and writes those blocks
directly to the ST7735, avoiding a full uncompressed framebuffer in RAM.

This command is intended for video and photographic content. Canvas scenes
continue to prefer vector commands, with `BLIT_RECT` as their compatibility
fallback.
