import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { stoneDark, stoneLight, type StonePalette } from '../design-theme/src/tokens/primitives.ts';
import type { SemanticColors } from '../design-theme/src/tokens/semantic.ts';
import { harnessContrastPairs } from '../src/features/ask/harnessColors.ts';

/** Same mapping as `semanticColors` in the theme package, kept local because
 * Node's type stripper cannot resolve the package's extensionless imports. */
function semanticColors(palette: StonePalette): SemanticColors {
  return {
    bg: {
      canvas: palette.canvas,
      surface: palette.surface,
      alt: palette.surfaceAlt,
      inset: palette.inset,
      inverse: palette.inverse,
    },
    text: {
      primary: palette.textPrimary,
      secondary: palette.textSecondary,
      tertiary: palette.textTertiary,
      disabled: palette.textDisabled,
      onFill: palette.onFill,
    },
    border: { hairline: palette.borderHairline, strong: palette.borderStrong },
    accent: { bg: palette.accent, fg: palette.accentForeground },
    status: {
      success: { fill: palette.successFill, text: palette.successText, wash: palette.successWash },
      warning: { fill: palette.warningFill, text: palette.warningText, wash: palette.warningWash },
      danger: { fill: palette.dangerFill, text: palette.dangerText, wash: palette.dangerWash },
    },
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test('harness and citation text clear 4.5:1 on their rendered surfaces in both schemes', () => {
  const schemes = [
    ['light', semanticColors(stoneLight)],
    ['dark', semanticColors(stoneDark)],
  ] as const;
  for (const [scheme, colors] of schemes) {
    for (const pair of harnessContrastPairs(colors)) {
      const ratio = contrast(pair.foreground, pair.background);
      assert.ok(
        ratio >= 4.5,
        `${scheme} ${pair.name}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('the harness panel and citation list contain no hardcoded hex colors', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const files = [
    'src/screens/HarnessPanel.tsx',
    'src/features/ask/AnswerCitations.tsx',
    'src/features/ask/harnessColors.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.equal(
      /#[0-9a-f]{3,8}\b/i.test(source),
      false,
      `${file} contains a hardcoded hex color; use a semantic theme token`,
    );
  }
});

test('every Text in the harness panel takes a themed style', () => {
  // An unstyled React Native Text renders black, which disappears on the dark
  // scheme. The contrast pairs above cannot see a Text that has no style.
  const root = path.resolve(import.meta.dirname, '..');
  const source = readFileSync(path.join(root, 'src/screens/HarnessPanel.tsx'), 'utf8');
  const unstyled = [...source.matchAll(/<Text\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => !/\bstyle=/.test(tag));
  assert.deepEqual(unstyled, [], 'every <Text> in HarnessPanel needs a style with a harness colour');
});
