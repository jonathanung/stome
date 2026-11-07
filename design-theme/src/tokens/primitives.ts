/**
 * Stone design tokens for Stome.
 *
 * Values are taken from the committed reference, design-theme/design-theme.html
 * (the "daily stone" sheet and the stome home, notes, whiteboard, and deck boards).
 * Do not restyle these to taste. Contrast checks live in design-theme/check-theme.mjs.
 */

export type ColorScheme = "light" | "dark";

export interface StonePalette {
  canvas: string;
  surface: string;
  surfaceAlt: string;
  inset: string;
  inverse: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  borderHairline: string;
  borderStrong: string;
  accent: string;
  accentForeground: string;
  successFill: string;
  successText: string;
  successWash: string;
  warningFill: string;
  warningText: string;
  warningWash: string;
  dangerFill: string;
  dangerText: string;
  dangerWash: string;
  onFill: string;
}

/** CSS custom properties used by the reference sheet, in palette-key order. */
export const paletteCssVars: Record<keyof StonePalette, string> = {
  canvas: "--canvas",
  surface: "--surface",
  surfaceAlt: "--alt",
  inset: "--inset",
  inverse: "--inverse",
  textPrimary: "--primary",
  textSecondary: "--secondary",
  textTertiary: "--tertiary",
  textDisabled: "--disabled",
  borderHairline: "--hair",
  borderStrong: "--strong",
  accent: "--accent",
  accentForeground: "--accentfg",
  successFill: "--sf",
  successText: "--st",
  successWash: "--sw",
  warningFill: "--wf",
  warningText: "--wt",
  warningWash: "--ww",
  dangerFill: "--df",
  dangerText: "--dt",
  dangerWash: "--dw",
  onFill: "--onfill",
};

/** Overcast. `.light` on the stone theme sheet. */
export const stoneLight: StonePalette = {
  canvas: "#d8d3c8",
  surface: "#e8e4da",
  surfaceAlt: "#cfc9bd",
  inset: "#c8c2b5",
  inverse: "#24221e",
  textPrimary: "#24221e",
  textSecondary: "#46423b",
  textTertiary: "#524d44",
  textDisabled: "#a39d90",
  borderHairline: "#c2bcaf",
  borderStrong: "#6a6458",
  accent: "#33302a",
  accentForeground: "#e8e4da",
  successFill: "#4a6e36",
  successText: "#365428",
  successWash: "#cdd5ba",
  warningFill: "#8a6410",
  warningText: "#5f4506",
  warningWash: "#e2d4a8",
  dangerFill: "#a3472a",
  dangerText: "#843219",
  dangerWash: "#e4cbbd",
  onFill: "#f3f0e8",
};

/** Dusk. `.dark` on the stone theme sheet. */
export const stoneDark: StonePalette = {
  canvas: "#1b1c1a",
  surface: "#252622",
  surfaceAlt: "#2f302b",
  inset: "#383933",
  inverse: "#e6e2d8",
  textPrimary: "#e6e2d8",
  textSecondary: "#bdb8ad",
  textTertiary: "#aaa59a",
  textDisabled: "#4c4b45",
  borderHairline: "#383933",
  borderStrong: "#8c887e",
  accent: "#e6e2d8",
  accentForeground: "#1b1c1a",
  successFill: "#8fb06a",
  successText: "#aecb8e",
  successWash: "#232d1c",
  warningFill: "#d6a63a",
  warningText: "#e8c46a",
  warningWash: "#312910",
  dangerFill: "#e27a52",
  dangerText: "#f2987c",
  dangerWash: "#382119",
  onFill: "#141412",
};

/**
 * Slide paper stays chalk in both schemes. The deck board hard-codes these
 * rather than using the scheme variables.
 */
export const paper = {
  slide: "#f3f0e8",
  slideHeader: "#e0dcd2",
  slideText: "#24221e",
  slideMuted: "#46423b",
  slideBorder: "#c2bcaf",
} as const;

/** Backdrop of the theme sheet itself, outside the overcast and dusk panels. */
export const sheet = {
  background: "#b9b3a6",
  muted: "#3a3731",
  line: "#8f897c",
} as const;

/**
 * The four daily swatches drawn next to stone on the sheet, for the fork
 * comparison only. Stome components do not paint with these.
 */
export const dailyComparison = {
  canvas: "#f7f7f5",
  surface: "#ffffff",
  success: "#12a150",
  inverse: "#0c0c0d",
} as const;

export interface StoneShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

const noShadow: StoneShadow = {
  shadowColor: "transparent",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
};

/**
 * Light elevations are the sheet card shadow plus the float, sticky, and
 * segment shadows from the whiteboard, deck, and notes boards.
 * Dusk sets `--shadow: none` and does not supply replacements, so every
 * dark elevation is flat.
 */
export const elevation: Record<ColorScheme, Record<"card" | "float" | "sticky" | "segment", StoneShadow>> = {
  light: {
    card: {
      shadowColor: "#24221e",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 2,
    },
    float: {
      shadowColor: "#24221e",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 28,
      elevation: 8,
    },
    sticky: {
      shadowColor: "#24221e",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 8,
      elevation: 3,
    },
    segment: {
      shadowColor: "#24221e",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 3,
      elevation: 1,
    },
  },
  dark: {
    card: noShadow,
    float: noShadow,
    sticky: noShadow,
    segment: noShadow,
  },
};

export const shadowCss = {
  lightCard: "0 2px 12px rgba(36,34,30,0.08)",
  lightFloat: "0 8px 28px rgba(36,34,30,0.16)",
  lightSticky: "0 3px 8px rgba(36,34,30,0.14)",
  lightSegment: "0 1px 3px rgba(36,34,30,0.12)",
  dark: "none",
} as const;

export const grain = {
  lightBlend: "multiply",
  lightOpacity: 0.22,
  darkBlend: "screen",
  darkOpacity: 0.1,
  /** Theme-sheet backdrop, separate from the panels. */
  sheetOpacity: 0.28,
  /** Home, notes, and the other app boards. */
  appOpacity: 0.2,
} as const;

export const space = {
  none: 0,
  hair: 1,
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 14,
  base: 16,
  card: 20,
  section: 24,
  block: 28,
  inner: 32,
  page: 40,
  paperY: 44,
  pageWide: 48,
  paperX: 56,
  sheet: 64,
} as const;

/**
 * Day tile radius is 2px per 8px of size. 28 → 7 and 36 → 9, which are the
 * habit tile and the today goal tile in the reference. Same rule as the
 * ported ui-component skill's DayTile.
 */
export function dayTileRadius(size: number): number {
  return (size / 8) * 2;
}

export const radius = {
  xs: 2,
  sm: 3,
  mark: 4,
  thumb: 6,
  tile: 7,
  goal: 9,
  md: 10,
  control: 12,
  lg: 14,
  bubble: 16,
  float: 20,
  card: 24,
  panel: 28,
  pill: 999,
} as const;

export const borderWidth = {
  hair: 1,
  node: 2,
  pin: 2,
  habitRisk: 1.5,
  highlight: 2,
} as const;

/** Measurements taken from the app boards, in px. */
export const layout = {
  sidebar: 248,
  rail: 64,
  inspector: 360,
  thumbs: 188,
  paperMax: 760,
  slideMax: 760,
  mainMax: 1160,
  control: 44,
  search: 40,
  navItem: 40,
  spaceRow: 36,
  tool: 36,
  chip: 32,
  segment: 32,
  habit: 28,
  pin: 32,
  thumbHeight: 132,
  annotationNote: 280,
  buttonPadX: 20,
  buttonCompactPadX: 18,
  buttonBarPadX: 16,
  mainPadY: 40,
  mainPadX: 48,
  mainGap: 28,
  gridGap: 16,
  paperPadY: 44,
  paperPadX: 56,
  slidePadY: 36,
  slidePadX: 44,
} as const;

export type FontWeight = "400" | "500" | "600" | "700" | "800" | "900";
export type FontFamilyRole = "sans" | "display" | "hand";

export interface TypeStyle {
  family: FontFamilyRole;
  weight: FontWeight;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

/**
 * Inter is the UI face, Outfit is the display face, Caveat is handwriting
 * on boards and slides. Sizes are the px values from the reference.
 */
export const type = {
  display: { family: "display", weight: "900", fontSize: 64, lineHeight: 68, letterSpacing: -2 },
  brand: { family: "display", weight: "900", fontSize: 26, lineHeight: 32, letterSpacing: -1 },
  screenTitle: { family: "display", weight: "800", fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  section: { family: "display", weight: "800", fontSize: 26, lineHeight: 32, letterSpacing: -0.6 },
  title: { family: "display", weight: "700", fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  actionTitle: { family: "display", weight: "700", fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  cardTitle: { family: "display", weight: "700", fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  slideTitle: { family: "display", weight: "800", fontSize: 30, lineHeight: 36, letterSpacing: 0 },
  body: { family: "sans", weight: "400", fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  reading: { family: "sans", weight: "400", fontSize: 17, lineHeight: 28, letterSpacing: 0 },
  bodySmall: { family: "sans", weight: "400", fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  ask: { family: "sans", weight: "400", fontSize: 15, lineHeight: 21, letterSpacing: 0 },
  caption: { family: "sans", weight: "400", fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  fine: { family: "sans", weight: "400", fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  search: { family: "sans", weight: "400", fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  annotation: { family: "sans", weight: "400", fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  slideBody: { family: "sans", weight: "400", fontSize: 14, lineHeight: 19, letterSpacing: 0 },
  label: { family: "sans", weight: "500", fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  meta: { family: "sans", weight: "500", fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  nav: { family: "sans", weight: "500", fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  chip: { family: "sans", weight: "500", fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  eyebrow: { family: "sans", weight: "600", fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  button: { family: "sans", weight: "600", fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  buttonCompact: { family: "sans", weight: "600", fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  hand: { family: "hand", weight: "500", fontSize: 22, lineHeight: 26, letterSpacing: 0 },
  handStrong: { family: "hand", weight: "700", fontSize: 22, lineHeight: 24, letterSpacing: 0 },
  handTitle: { family: "hand", weight: "700", fontSize: 34, lineHeight: 38, letterSpacing: 0 },
  handCaption: { family: "hand", weight: "700", fontSize: 18, lineHeight: 16, letterSpacing: 0 },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof type;

export const fontFamilyCss = {
  sans: "Inter, sans-serif",
  display: "Outfit, sans-serif",
  hand: "Caveat, cursive",
} as const;

/**
 * Weight-specific family names registered by @expo-google-fonts.
 * Android uses the family name for weight, so expo mode does not also set
 * a numeric fontWeight. Those packages are not installed here; the Expo
 * scaffold owns dependencies.
 */
export const expoFontFamilies = {
  sans: {
    "400": "Inter_400Regular",
    "500": "Inter_500Medium",
    "600": "Inter_600SemiBold",
    "700": "Inter_700Bold",
  },
  display: {
    "700": "Outfit_700Bold",
    "800": "Outfit_800ExtraBold",
    "900": "Outfit_900Black",
  },
  hand: {
    "500": "Caveat_500Medium",
    "700": "Caveat_700Bold",
  },
} as const;

export const cssFontFamilies = {
  sans: {
    "400": "Inter",
    "500": "Inter",
    "600": "Inter",
    "700": "Inter",
  },
  display: {
    "700": "Outfit",
    "800": "Outfit",
    "900": "Outfit",
  },
  hand: {
    "500": "Caveat",
    "700": "Caveat",
  },
} as const;

export type FontFamilies = {
  sans: Record<"400" | "500" | "600" | "700", string>;
  display: Record<"700" | "800" | "900", string>;
  hand: Record<"500" | "700", string>;
};

export type FontMode = "css" | "expo";
