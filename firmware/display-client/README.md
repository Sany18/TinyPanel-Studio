# TinyPanel Studio display client

Thin display client for a server/client graphics-streaming system: this
firmware contains no drawing logic. It connects to
[TinyPanel Studio server](../../server) over TCP and interprets the binary draw
commands defined in [DISPLAY_PROTOCOL.md](../../DISPLAY_PROTOCOL.md), blitting
them straight to the panel via `Adafruit_GFX`. Unlike every other sketch in
this repo, changing what's on screen means changing the "program" running
on the server - no reflash needed.

The current target uses an ESP32-C3 Super Mini and ST7735S display. The server
contains a built-in synthwave program for protocol and animation testing.

Firmware 0.4 also accepts length-prefixed JPEG frames. `TJpg_Decoder` renders
decoded blocks directly to the display, so video does not require a full RGB565
framebuffer in RAM.

### Hardware

Display 1.8" TFT ST7735S 128x160 SPI:
[From Aliexpress](https://www.aliexpress.com/item/32817839166.html)

Arduino ESP32 C3 SUPER MINI:
[From Aliexpress](https://www.aliexpress.com/item/1005005877531694.html)

### Libs

- Adafruit GFX Library
- Adafruit ST7735 and ST7789 Library
- WiFi (ships with the ESP32 board core, no install needed)

### Pins

| ESP32-C3 SuperMini | TFT Display |
|---------------------|-------------|
| 5V                  | VCC         |
| G                   | GND         |
| GPIO0               | CS          |
| GPIO4               | RESET       |
| GPIO3               | AO (DC)     |
| GPIO2               | SDA (MOSI)  |
| GPIO1               | SCK (SCLK)  |
| 3V3                 | LED         |

### Setup

1. Copy `secrets.h.example` to `secrets.h` in this folder and fill in your WiFi
   SSID/password. `secrets.h` is gitignored.
2. Set `DISPLAY_SERVER_HOST`/`DISPLAY_SERVER_PORT` at the top of the `.ino`
   to the LAN address `display_server` is running on.
3. Install the libraries above via the Arduino IDE Library Manager.
4. Select board "ESP32C3 Dev Module", and enable **USB CDC On Boot** (Tools menu,
   or `arduino-cli` fqbn suffix `:CDCOnBoot=cdc`) so `Serial` output shows up
   over the native USB port for debugging.
5. Flash. Then start the [server](../../server) (`npm run start:canvas`)
   - the firmware connects out to it, not the other way around.

### How it works

- On boot, connects to WiFi, then connects out to `display_server` as a TCP
  client. If either connection drops, it retries on a throttled interval.
- Parses the binary opcode stream from the server (`FILL_SCREEN`,
  `FILL_RECT`, `FILL_CIRCLE`, `FILL_TRIANGLE`, `DRAW_LINE`) and calls the
  matching `Adafruit_GFX` primitive directly - no clamping/validation, it
  trusts the server. Full byte layout: [DISPLAY_PROTOCOL.md](../../DISPLAY_PROTOCOL.md).
- After each frame's commands, the server sends a `FRAME_END` marker and
  waits for a single ACK byte back before sending the next frame - this
  firmware sends that ACK right after dispatching `FRAME_END`, which is what
  keeps the animation from racing ahead of what's actually been drawn.
- Uses hardware SPI; software SPI is CPU-bound and substantially slower on
  ESP32 for this workload.
