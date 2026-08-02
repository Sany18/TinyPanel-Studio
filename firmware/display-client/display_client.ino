// Thin display client for the server/client graphics-streaming system: runs
// no drawing logic of its own. Connects to the TinyPanel Studio server over TCP and
// interprets the binary draw commands documented in ../DISPLAY_PROTOCOL.md,
// blitting them straight to the panel via Adafruit_GFX. Change what's on
// screen by changing the "program" running on the server - no reflash
// needed, unlike every other sketch in this repo.
//
// Current validated pin mapping: ESP32-C3 Super Mini + ST7735S over hardware SPI.
// (same panel, same hardware-SPI setup - see that sketch's comments for why
// hardware SPI is required: ESP32 has no fast digitalWrite() path for
// software SPI, ~46-62x slower, measured in ../../128_160_esp32c3_spi_benchmark).
//
// Pins:
//   CS -> GPIO0, RESET -> GPIO4, DC -> GPIO3, SDA/MOSI -> GPIO2, SCK -> GPIO1
//
// Copy secrets.h.example -> secrets.h and fill in your WiFi credentials.
// secrets.h is gitignored so credentials never get committed.
//
// Board must be flashed with "USB CDC On Boot: Enabled" for Serial to show
// up over the native USB port (arduino-cli fqbn suffix ":CDCOnBoot=cdc").

#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>
#include <WiFi.h>

#include "secrets.h"

#ifndef DISPLAY_FIRMWARE_VERSION
#define DISPLAY_FIRMWARE_VERSION "dev"
#endif

#define TFT_CS         0
#define TFT_RST        4
#define TFT_DC         3
#define TFT_MOSI_SDA   2
#define TFT_SCLK_SCL   1

#define TILE_SIZE   16
#define TILES_X     10 // 160 / 16
#define TILES_Y     8  // 128 / 16
#define TILE_COUNT  80 // TILES_X * TILES_Y

Adafruit_ST7735 TFTscreen = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// display_server's LAN address - plain, not secret (same style as
// This is a LAN address, not a secret; Wi-Fi credentials live in secrets.h.
const char* DISPLAY_SERVER_HOST = "192.170.60.234";
const int   DISPLAY_SERVER_PORT = 8765;
const unsigned long SERVER_RECONNECT_INTERVAL_MS = 2000;

WiFiClient client;
unsigned long lastServerConnectAttempt = 0;

// Wire protocol per ../DISPLAY_PROTOCOL.md: [opcode:1][payload...], all
// multi-byte fields big-endian, coords int16_t, color uint16_t (RGB565).
enum Opcode : uint8_t {
  OP_FILL_SCREEN   = 0x01,
  OP_FILL_RECT     = 0x02,
  OP_FILL_CIRCLE   = 0x03,
  OP_FILL_TRIANGLE = 0x04,
  OP_DRAW_LINE     = 0x05,
  OP_BLIT_TILE     = 0xE0,
  OP_BLIT_RECT     = 0xE1,
  OP_FRAME_END     = 0xF0,
};
const uint8_t ACK_BYTE = 0x06;

// Longest command (BLIT_TILE) is 514 bytes total (1 opcode + 1 tileIndex +
// 512 pixel bytes). rxLen/expectedLen must be wider than uint8_t (max 255)
// to count up to 514 without wrapping.
// BLIT_RECT is capped at one full-width 160x16 strip:
// opcode + x/y/w/h + 160*16 RGB565 pixels = 5125 bytes.
static uint8_t rxBuf[5125];
static uint16_t rxLen = 0;
static uint16_t expectedLen = 0; // 0 = "haven't read the opcode byte yet"
static bool readingRectHeader = false;

// Per-frame diagnostics. total includes TCP gaps and drawing; draw includes
// only dispatch()/SPI work. Printed after ACK so Serial cannot delay it.
static uint32_t frameStartedUs = 0;
static uint32_t frameDrawUs = 0;
static uint32_t frameBytes = 0;
static uint32_t statsFrames = 0;
static uint32_t statsTotalMaxUs = 0;
static uint32_t statsDrawMaxUs = 0;
static uint32_t statsNetworkMaxUs = 0;
static uint32_t statsBytes = 0;
static unsigned long statsStartedMs = 0;

// Explicit prototypes keep this sketch valid both through Arduino's .ino
// preprocessor and as a normal C++ translation unit under PlatformIO.
void connectWiFi();
void connectServer();
void pollServer();
void dispatch(const uint8_t* buf, uint16_t len);

void setup() {
  Serial.begin(115200);
  Serial.printf("display-client firmware %s\n", DISPLAY_FIRMWARE_VERSION);

  // GPIO1/GPIO2 aren't this board's default hardware-SPI pins, so route the
  // SPI peripheral to them explicitly via the GPIO matrix before initR().
  SPI.begin(TFT_SCLK_SCL, -1, TFT_MOSI_SDA, TFT_CS);

  TFTscreen.initR(INITR_BLACKTAB); // this panel is RGB-ordered (GREENTAB's BGR swap turns cyan into yellow)
  TFTscreen.setRotation(3); // panel is physically mounted flipped 180 from setRotation(1)'s assumption
  TFTscreen.fillScreen(ST7735_BLACK);
  statsStartedMs = millis();

  connectWiFi();
  connectServer();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!client.connected()) {
    if (millis() - lastServerConnectAttempt >= SERVER_RECONNECT_INTERVAL_MS) {
      connectServer();
    }
    return;
  }

  pollServer();
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.println(WiFi.status() == WL_CONNECTED ? "WiFi connected" : "WiFi connect timed out");

  // Default modem-sleep power save periodically parks the radio between
  // beacon wakeups, which stalls an active TCP stream for a burst of
  // frames every few seconds - exactly the periodic freeze this system
  // needs to avoid mid-animation. Not needed on battery-powered builds
  // where saving power matters more than latency.
  WiFi.setSleep(false);
}

void connectServer() {
  lastServerConnectAttempt = millis();
  Serial.print("Connecting to display server...");
  if (client.connect(DISPLAY_SERVER_HOST, DISPLAY_SERVER_PORT)) {
    client.setNoDelay(true);
    // Discard any partial command left over from a previous connection -
    // it's garbage now that the byte stream has restarted.
    rxLen = 0;
    expectedLen = 0;
    readingRectHeader = false;
    frameStartedUs = 0;
    frameDrawUs = 0;
    frameBytes = 0;
    Serial.println(" connected");
  } else {
    Serial.println(" failed");
  }
}

// Payload length (not including the opcode byte) for each opcode, or 0xFFFF
// for an unrecognized opcode (triggers a resync: drop the byte and keep
// scanning for a valid opcode). Must return a type wider than uint8_t -
// BLIT_TILE's 513-byte payload would otherwise truncate to 513 & 0xFF == 1.
uint16_t payloadLenForOpcode(uint8_t op) {
  switch (op) {
    case OP_FILL_SCREEN:   return 2;
    case OP_FILL_RECT:     return 10;
    case OP_FILL_CIRCLE:   return 8;
    case OP_FILL_TRIANGLE: return 14;
    case OP_DRAW_LINE:     return 10;
    case OP_BLIT_TILE:     return 513; // 1 (tileIndex) + 512 (pixel data)
    case OP_BLIT_RECT:     return 4; // initial x/y/w/h header; pixel length is dynamic
    case OP_FRAME_END:     return 0;
    default:               return 0xFFFF;
  }
}

int16_t readI16(const uint8_t* p) {
  return (int16_t)((p[0] << 8) | p[1]);
}

uint16_t readU16(const uint8_t* p) {
  return (uint16_t)((p[0] << 8) | p[1]);
}

// Command-accumulation state machine. Read directly into the remaining part
// of rxBuf instead of calling client.read() once per byte; TCP may split a
// command anywhere, so dispatch still happens only after it is complete.
void pollServer() {
  while (client.available()) {
    if (rxLen == 0) {
      int value = client.read();
      if (value < 0) return;
      rxBuf[0] = (uint8_t)value;
      rxLen = 1;
      if (frameStartedUs == 0) frameStartedUs = micros();
      uint16_t plen = payloadLenForOpcode(rxBuf[0]);
      if (plen == 0xFFFF) {
        rxLen = 0; // unknown opcode: drop and resync
        continue;
      }
      expectedLen = 1 + plen;
      readingRectHeader = rxBuf[0] == OP_BLIT_RECT;
    }

    if (rxLen < expectedLen) {
      size_t wanted = expectedLen - rxLen;
      size_t availableNow = client.available();
      size_t toRead = wanted < availableNow ? wanted : availableNow;
      if (toRead == 0) return;
      int count = client.read(rxBuf + rxLen, toRead);
      if (count <= 0) return;
      rxLen += count;
    }

    if (rxLen == expectedLen && readingRectHeader) {
      uint8_t x = rxBuf[1];
      uint8_t y = rxBuf[2];
      uint8_t w = rxBuf[3];
      uint8_t h = rxBuf[4];
      uint32_t fullLen = 5U + (uint32_t)w * h * 2U;
      if (w == 0 || h == 0 || h > TILE_SIZE || x + w > 160 || y + h > 128 || fullLen > sizeof(rxBuf)) {
        Serial.println("invalid BLIT_RECT; disconnecting to resync");
        client.stop();
        rxLen = expectedLen = 0;
        readingRectHeader = false;
        return;
      }
      expectedLen = (uint16_t)fullLen;
      readingRectHeader = false;
      continue;
    }

    if (rxLen == expectedLen) {
      frameBytes += rxLen;
      if (rxBuf[0] == OP_FRAME_END) {
        dispatch(rxBuf, rxLen);
      } else {
        uint32_t drawStartedUs = micros();
        dispatch(rxBuf, rxLen);
        frameDrawUs += micros() - drawStartedUs;
      }
      rxLen = 0;
    }
  }
}

void dispatch(const uint8_t* buf, uint16_t len) {
  switch (buf[0]) {
    case OP_FILL_SCREEN: {
      uint16_t color = readU16(&buf[1]);
      TFTscreen.fillScreen(color);
      break;
    }
    case OP_FILL_RECT: {
      int16_t x = readI16(&buf[1]);
      int16_t y = readI16(&buf[3]);
      int16_t w = readI16(&buf[5]);
      int16_t h = readI16(&buf[7]);
      uint16_t color = readU16(&buf[9]);
      TFTscreen.fillRect(x, y, w, h, color);
      break;
    }
    case OP_FILL_CIRCLE: {
      int16_t x0 = readI16(&buf[1]);
      int16_t y0 = readI16(&buf[3]);
      int16_t r  = readI16(&buf[5]);
      uint16_t color = readU16(&buf[7]);
      TFTscreen.fillCircle(x0, y0, r, color);
      break;
    }
    case OP_FILL_TRIANGLE: {
      int16_t x0 = readI16(&buf[1]);
      int16_t y0 = readI16(&buf[3]);
      int16_t x1 = readI16(&buf[5]);
      int16_t y1 = readI16(&buf[7]);
      int16_t x2 = readI16(&buf[9]);
      int16_t y2 = readI16(&buf[11]);
      uint16_t color = readU16(&buf[13]);
      TFTscreen.fillTriangle(x0, y0, x1, y1, x2, y2, color);
      break;
    }
    case OP_DRAW_LINE: {
      int16_t x0 = readI16(&buf[1]);
      int16_t y0 = readI16(&buf[3]);
      int16_t x1 = readI16(&buf[5]);
      int16_t y1 = readI16(&buf[7]);
      uint16_t color = readU16(&buf[9]);
      TFTscreen.drawLine(x0, y0, x1, y1, color);
      break;
    }
    case OP_BLIT_TILE: {
      uint8_t tileIndex = buf[1];
      uint8_t tileCol = tileIndex % TILES_X;
      uint8_t tileRow = tileIndex / TILES_X;
      int16_t x = tileCol * TILE_SIZE;
      int16_t y = tileRow * TILE_SIZE;

      // static, not stack - matches the gifFrameBuf precedent in
      // ../../128_160_esp32c3_spi_benchmark's playGifFrame(). Reconstructed
      // via readU16(), not writePixels()'s bigEndian flag - see
      // ../DISPLAY_PROTOCOL.md's "Tile blit" section for why.
      static uint16_t tileBuf[TILE_SIZE * TILE_SIZE];
      for (int i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        tileBuf[i] = readU16(&buf[2 + i * 2]);
      }

      TFTscreen.startWrite();
      TFTscreen.setAddrWindow(x, y, TILE_SIZE, TILE_SIZE);
      TFTscreen.writePixels(tileBuf, TILE_SIZE * TILE_SIZE);
      TFTscreen.endWrite();
      break;
    }
    case OP_BLIT_RECT: {
      uint8_t x = buf[1];
      uint8_t y = buf[2];
      uint8_t w = buf[3];
      uint8_t h = buf[4];
      uint16_t pixelCount = (uint16_t)w * h;
      static uint16_t rectBuf[160 * TILE_SIZE];
      for (uint16_t i = 0; i < pixelCount; i++) {
        rectBuf[i] = readU16(&buf[5 + i * 2]);
      }
      TFTscreen.startWrite();
      TFTscreen.setAddrWindow(x, y, w, h);
      TFTscreen.writePixels(rectBuf, pixelCount);
      TFTscreen.endWrite();
      break;
    }
    case OP_FRAME_END: {
      uint32_t totalUs = micros() - frameStartedUs;
      uint32_t networkUs = totalUs > frameDrawUs ? totalUs - frameDrawUs : 0;
      client.write(&ACK_BYTE, 1);

      statsFrames++;
      statsBytes += frameBytes;
      statsTotalMaxUs = max(statsTotalMaxUs, totalUs);
      statsDrawMaxUs = max(statsDrawMaxUs, frameDrawUs);
      statsNetworkMaxUs = max(statsNetworkMaxUs, networkUs);
      frameStartedUs = 0;
      frameDrawUs = 0;
      frameBytes = 0;

      unsigned long nowMs = millis();
      if (nowMs - statsStartedMs >= 5000) {
        Serial.printf("[perf] frames=%lu bytes=%lu total_max=%.1fms draw_max=%.1fms network_max=%.1fms rssi=%d\n",
          statsFrames, statsBytes, statsTotalMaxUs / 1000.0,
          statsDrawMaxUs / 1000.0, statsNetworkMaxUs / 1000.0,
          WiFi.RSSI());
        statsFrames = statsBytes = 0;
        statsTotalMaxUs = statsDrawMaxUs = statsNetworkMaxUs = 0;
        statsStartedMs = nowMs;
      }
      break;
    }
  }
}
