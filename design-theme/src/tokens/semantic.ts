import { stoneDark, stoneLight, type StonePalette } from "./primitives";

/**
 * Both schemes implement this shape. Adding a color means adding it here,
 * then filling both maps. A missing key is a type error.
 * Nested names follow the ported ui-component skill (`t.color.bg.surface`).
 */
export interface SemanticColors {
  bg: {
    canvas: string;
    surface: string;
    alt: string;
    inset: string;
    inverse: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    disabled: string;
    onFill: string;
  };
  border: {
    hairline: string;
    strong: string;
  };
  accent: {
    bg: string;
    fg: string;
  };
  status: {
    success: { fill: string; text: string; wash: string };
    warning: { fill: string; text: string; wash: string };
    danger: { fill: string; text: string; wash: string };
  };
}

export function semanticColors(palette: StonePalette): SemanticColors {
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
    border: {
      hairline: palette.borderHairline,
      strong: palette.borderStrong,
    },
    accent: {
      bg: palette.accent,
      fg: palette.accentForeground,
    },
    status: {
      success: { fill: palette.successFill, text: palette.successText, wash: palette.successWash },
      warning: { fill: palette.warningFill, text: palette.warningText, wash: palette.warningWash },
      danger: { fill: palette.dangerFill, text: palette.dangerText, wash: palette.dangerWash },
    },
  };
}

export const lightColors: SemanticColors = semanticColors(stoneLight);
export const darkColors: SemanticColors = semanticColors(stoneDark);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface PaletteCheck {
  failures: string[];
  notes: string[];
}

/**
 * Text on the sheet's surfaces must clear 4.5:1. Status text on wash, on-fill
 * on status fills, and strong borders must clear their stated ratios.
 * Hairline and disabled text are recorded as notes: the reference colors miss
 * 3:1 and 4.5:1, and this check does not recolor them.
 */
export function checkPalette(): PaletteCheck {
  const failures: string[] = [];
  const notes: string[] = [];
  const schemes = [
    ["light", stoneLight],
    ["dark", stoneDark],
  ] as const;
  const backgrounds = ["canvas", "surface", "surfaceAlt", "inset"] as const;
  const texts = ["textPrimary", "textSecondary", "textTertiary"] as const;
  for (const [name, palette] of schemes) {
    for (const background of backgrounds) {
      for (const text of texts) {
        const ratio = contrast(palette[text], palette[background]);
        if (ratio < 4.5) failures.push(`${name} ${text} on ${background} is ${ratio.toFixed(2)}`);
      }
    }
    const pairs: Array<[string, string, string, number]> = [
      ["accent foreground", palette.accentForeground, palette.accent, 4.5],
      ["success text", palette.successText, palette.successWash, 4.5],
      ["warning text", palette.warningText, palette.warningWash, 4.5],
      ["danger text", palette.dangerText, palette.dangerWash, 4.5],
      ["on-fill on moss", palette.onFill, palette.successFill, 4.5],
      ["on-fill on lichen", palette.onFill, palette.warningFill, 4.5],
      ["on-fill on rust", palette.onFill, palette.dangerFill, 4.5],
      ["strong border", palette.borderStrong, palette.surface, 3],
      ["moss on canvas", palette.successFill, palette.canvas, 3],
      ["lichen on canvas", palette.warningFill, palette.canvas, 3],
      ["rust on canvas", palette.dangerFill, palette.canvas, 3],
    ];
    for (const [label, fg, bg, minimum] of pairs) {
      const ratio = contrast(fg, bg);
      if (ratio < minimum) failures.push(`${name} ${label} is ${ratio.toFixed(2)}`);
    }
    const hair = contrast(palette.borderHairline, palette.surface);
    const disabled = contrast(palette.textDisabled, palette.surface);
    notes.push(`${name} hairline on surface ${hair.toFixed(2)}:1`);
    notes.push(`${name} disabled text on surface ${disabled.toFixed(2)}:1`);
  }
  return { failures, notes };
}
