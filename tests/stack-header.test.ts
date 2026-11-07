import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stoneDark, stoneLight } from '../design-theme/src/tokens/primitives.ts';
import { stackHeaderOptions } from '../src/theme/stack-header.ts';

function paletteTheme(palette: typeof stoneLight) {
  return {
    color: {
      bg: { canvas: palette.canvas },
      text: { primary: palette.textPrimary },
    },
  };
}

test('stack header bar and title follow the active scheme', () => {
  const light = stackHeaderOptions(paletteTheme(stoneLight));
  assert.equal(light.headerTitle, 'stome');
  assert.equal(light.headerStyle.backgroundColor, stoneLight.canvas);
  assert.equal(light.headerTintColor, stoneLight.textPrimary);

  const dark = stackHeaderOptions(paletteTheme(stoneDark));
  assert.equal(dark.headerTitle, 'stome');
  assert.equal(dark.headerStyle.backgroundColor, stoneDark.canvas);
  assert.equal(dark.headerTintColor, stoneDark.textPrimary);
  assert.notEqual(dark.headerStyle.backgroundColor, '#f6f4ee');
  assert.notEqual(dark.headerStyle.backgroundColor, light.headerStyle.backgroundColor);
});
