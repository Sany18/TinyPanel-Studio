# Application JSDoc configuration

TinyPanel Canvas applications keep their metadata and display preferences in
the `main.canvas.js` source file. A separate `manifest.json` is not required.
Applications live in the repository-level `apps/<app-id>/` directory.

## Complete example

Place one `@tinypanel` JSDoc block near the beginning of the file:

```js
/**
 * @tinypanel
 * @name Synthwave
 * @description Animated retro sun, mountains, and perspective grid
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 30
 * @wifiSleep false
 * @cpuMultiplier 1
 */

function render(ctx, state) {
  ctx.clear('#000000');
}
```

Only a JSDoc block containing `@tinypanel` is treated as application
configuration. Unknown tags are ignored.

## Parameters

| Tag | Type | Default | Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `@tinypanel` | marker | required for parsing | no value | Identifies the block as TinyPanel configuration. |
| `@name` | string | `Canvas App` | 1–100 characters, one line | Name shown in the app library and editor header. |
| `@description` | string | empty | 0–500 characters, one line | Short description shown under the application name. |
| `@width` | integer | `160` | 1–4096 | Logical display width in pixels. |
| `@height` | integer | `128` | 1–4096 | Logical display height in pixels. |
| `@orientation` | enum | `landscape` | see values below | Preferred display orientation. |
| `@fps` | number | `30` | 1–60 | Target maximum render and transport frame rate. |
| `@wifiSleep` | boolean | `false` | `true` or `false` | Enables ESP32 Wi-Fi modem sleep for this app. |
| `@cpuMultiplier` | number | `1` | `0.5` or `1` | Runs the ESP32 at half or full boot CPU frequency. On the 160 MHz ESP32-C3 these are the Wi-Fi-safe 80 and 160 MHz modes. |

Supported orientation values:

- `landscape`
- `landscape-reversed`
- `portrait`
- `portrait-reversed`

The current display firmware and Studio UI support the two landscape
rotations. Portrait values are reserved for compatible firmware and display
profiles.

## Frame-rate behavior

`@fps` is saved per application and applied automatically when the application
becomes active. It is a target upper limit, not a guaranteed measurement.
Rendering time, encoded frame size, network throughput, display write time,
and the frame ACK can reduce the observed frame rate.

Choose the lowest useful value. A mostly static dashboard such as Crypto
Tracker can use `@fps 1`, an animated UI can use `@fps 30`, and fast animation
can use `@fps 60` when the device and transport can sustain it.

An application's network refresh interval does not need to equal its render
rate. For example, an API can refresh once per minute while the UI renders at
30 FPS.

## Device power behavior

`@wifiSleep` and `@cpuMultiplier` are independent. A static dashboard can use
Wi-Fi modem sleep and half CPU frequency, while a latency-sensitive animation
can keep modem sleep disabled at full frequency:

```js
// Low-power dashboard
 * @wifiSleep true
 * @cpuMultiplier 0.5

// Smooth animation
 * @wifiSleep false
 * @cpuMultiplier 1
```

The current validated ESP32-C3 target boots at 160 MHz, so multiplier `0.5`
requests 80 MHz. These settings are sent when an application starts or its
configuration changes and require firmware that supports `SET_POWER_CONFIG`.

## Display dimensions

`@width` and `@height` describe the application's logical coordinate space and
should match the active firmware display profile. Changing these tags alone
does not reconfigure the physical panel. Use Hardware Setup and rebuild the
firmware when the display hardware or driver changes.

## Editing and persistence

Studio metadata and display-setting APIs update this JSDoc block directly.
Editing the tags manually and saving with Ctrl+S updates the active application
configuration along with its code.

Names and descriptions must fit on one JSDoc line and cannot contain `*/`.
Invalid values are rejected without replacing the last valid application.

## Legacy applications

Applications that still have `manifest.json` remain readable. Its name and
description are used only as fallback values when `main.canvas.js` has no
TinyPanel configuration block. New applications should use the JSDoc format.
