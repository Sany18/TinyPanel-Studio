'use strict';

// Synthwave protocol demo: drawSky/drawGround/
// drawMountain/drawGroundLines/getStepMultiplier. Same constants, same call
// order/args - kept in lockstep with the .ino rather than "improved" so visual
// parity is easy to verify (see DISPLAY_PROTOCOL.md's verification steps).
//
// C's `int` assignment truncates toward zero and `int / int` truncates too;
// JS doesn't do either implicitly, so every place the .ino relies on that
// (pow(...) + maxY/2 assigned to an int, maxX/amount_of_lines, width/2, etc.)
// gets an explicit Math.trunc()/Math.floor() here to match - otherwise pixel
// positions drift from the firmware's C truncation.

const GROUND_COLOR = 0x2823;
const LINES_COLOR = 0x4866;
const SKY_COLOR = 0x0801;
const SUN_COLOR = 0x5183;

const maxY = 128;
const maxX = 160;

const stepsPerCycle = 10;

function getStepMultiplier(step) {
  const a = step % stepsPerCycle;
  return a * 0.1;
}

function drawMountain(fb, positionX, width, height, color) {
  const groundHeight = Math.floor(maxY / 2) - 1;
  fb.fillTriangle(
    positionX, groundHeight,
    positionX + Math.floor(width / 2), groundHeight - height,
    positionX + width, groundHeight,
    color
  );
}

function drawSky(fb) {
  // sky
  fb.fillRect(0, 0, maxX, Math.floor(maxY / 2), SKY_COLOR);

  // sun
  fb.fillCircle(Math.floor(maxX / 2), 50, 26, SUN_COLOR);

  // sun lines
  fb.fillRect(Math.floor(maxX / 2) - 26, 22, 53, 6, SKY_COLOR);
  fb.fillRect(Math.floor(maxX / 2) - 26, 32, 53, 4, SKY_COLOR);
  fb.fillRect(Math.floor(maxX / 2) - 26, 41, 53, 3, SKY_COLOR);
  fb.fillRect(Math.floor(maxX / 2) - 26, 50, 53, 2, SKY_COLOR);
  fb.fillRect(Math.floor(maxX / 2) - 26, 58, 53, 1, SKY_COLOR);

  // left mountains
  drawMountain(fb, Math.floor(maxX / 2) - 90, 50, 12, 0x4007);
  drawMountain(fb, Math.floor(maxX / 2) - 65, 30, 18, 0x4007);
  drawMountain(fb, Math.floor(maxX / 2) - 45, 20, 10, 0x3005);

  // right mountains
  drawMountain(fb, Math.floor(maxX / 2) + 22, 20, 10, 0x4007);
  drawMountain(fb, Math.floor(maxX / 2) + 50, 30, 20, 0x0801);
  drawMountain(fb, Math.floor(maxX / 2) + 35, 18, 5, 0x2001);
}

function drawGround(fb) {
  fb.fillRect(0, Math.floor(maxY / 2), maxX, Math.floor(maxY / 2), GROUND_COLOR);
}

function drawGroundLines(fb, iteration) {
  const amountOfLines = 16;
  const stepX = Math.floor(maxX / amountOfLines);

  for (let i = 0; i <= amountOfLines; i++) {
    const previousStepMultiplier = getStepMultiplier(iteration - 1);
    const currentStepMultiplier = getStepMultiplier(iteration);

    // remove previous lines
    const yPosPrev = Math.trunc(Math.pow(i + previousStepMultiplier, 2)) + Math.floor(maxY / 2);
    if (i <= amountOfLines / 2) {
      fb.drawLine(0, yPosPrev, maxX, yPosPrev, GROUND_COLOR);
    }

    // draw new lines
    const yPos = Math.trunc(Math.pow(i + currentStepMultiplier, 2)) + Math.floor(maxY / 2);
    if (i <= amountOfLines / 2) {
      fb.drawLine(0, yPos, maxX, yPos, LINES_COLOR);
    }

    fb.drawLine(stepX * i * 3 - maxX, maxY, stepX * i, Math.floor(maxY / 2) + 1, LINES_COLOR);
  }
}

module.exports = {
  maxX,
  maxY,
  drawSky,
  drawGround,
  drawGroundLines,
  getStepMultiplier,
};
