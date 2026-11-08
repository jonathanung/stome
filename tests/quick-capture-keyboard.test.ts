import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  frameKeyboardOverlap,
  WEB_KEYBOARD_MIN_PX,
  visualViewportKeyboardOverlap,
} from '../src/features/capture/keyboard-inset.ts';

test('native sheet lifts by the keyboard when the edge-to-edge window does not resize', () => {
  // iPhone-sized full-screen sheet. Keyboard top sits 336px above the bottom.
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 844, keyboardScreenY: 508, keyboardHeight: 336 }), 336);
  // Android edge-to-edge: same coordinates, no adjustResize shrink.
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 800, keyboardScreenY: 480, keyboardHeight: 320 }), 320);
  // A sheet that starts below the status bar still clears the keyboard.
  assert.equal(frameKeyboardOverlap({ frameY: 40, frameHeight: 760, keyboardScreenY: 500, keyboardHeight: 300 }), 300);
});

test('native sheet does not add padding when the window already ends at the keyboard', () => {
  // adjustResize shrank the sheet to the keyboard top.
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 480, keyboardScreenY: 500, keyboardHeight: 320 }), 0);
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 800, keyboardScreenY: 800, keyboardHeight: 0 }), 0);
});

test('native sheet falls back to keyboard height when the screen position is missing', () => {
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 800, keyboardScreenY: 0, keyboardHeight: 280 }), 280);
  assert.equal(frameKeyboardOverlap({ frameY: Number.NaN, frameHeight: Number.NaN, keyboardScreenY: 100, keyboardHeight: 240 }), 240);
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 0, keyboardScreenY: 10, keyboardHeight: Number.NaN }), 0);
});

test('native overlap never exceeds the sheet', () => {
  assert.equal(frameKeyboardOverlap({ frameY: 0, frameHeight: 800, keyboardScreenY: 10, keyboardHeight: 4000 }), 790);
});

test('mobile web ignores browser chrome and a shorter window, and lifts for a keyboard', () => {
  assert.ok(WEB_KEYBOARD_MIN_PX > 80);
  // URL bar: visual viewport is a little shorter than the layout viewport.
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 844,
    viewportHeight: 760,
    viewportOffsetTop: 0,
  }), 0);
  // The window itself got shorter. Both viewports move together.
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 420,
    viewportHeight: 420,
    viewportOffsetTop: 0,
  }), 0);
  // Keyboard: layout height stays, visual viewport shrinks by more than chrome.
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 844,
    viewportHeight: 500,
    viewportOffsetTop: 0,
  }), 344);
});

test('mobile web does not lift twice when the browser already panned', () => {
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 844,
    viewportHeight: 500,
    viewportOffsetTop: 300,
  }), 0);
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 844,
    viewportHeight: 400,
    viewportOffsetTop: 80,
  }), 364);
});

test('visual viewport overlap ignores non-finite measurements', () => {
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: Number.NaN,
    viewportHeight: 400,
    viewportOffsetTop: 0,
  }), 0);
  assert.equal(visualViewportKeyboardOverlap({
    layoutHeight: 844,
    viewportHeight: Number.NaN,
    viewportOffsetTop: 0,
  }), 0);
});
