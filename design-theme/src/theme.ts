import {
  cssFontFamilies,
  elevation,
  expoFontFamilies,
  grain,
  layout,
  paper,
  radius,
  sheet,
  space,
  darkColors,
  lightColors,
  type,
  type ColorScheme,
  type FontFamilies,
  type FontMode,
  type FontWeight,
  type SemanticColors,
  type StoneShadow,
  type TypeRole,
  type TypeStyle,
} from "./tokens";

export interface ResolvedType {
  fontFamily: string;
  fontWeight: FontWeight | "normal";
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface StoneTheme {
  scheme: ColorScheme;
  fontMode: FontMode;
  color: SemanticColors;
  paper: typeof paper;
  sheet: typeof sheet;
  space: typeof space;
  radius: typeof radius;
  layout: typeof layout;
  type: typeof type;
  shadow: Record<"card" | "float" | "sticky" | "segment", StoneShadow>;
  grain: {
    blend: "multiply" | "screen";
    opacity: number;
    appOpacity: number;
  };
  fonts: FontFamilies;
  text: (role: TypeRole) => ResolvedType;
}

function familyName(style: TypeStyle, fonts: FontFamilies): string {
  if (style.family === "display") {
    if (style.weight !== "700" && style.weight !== "800" && style.weight !== "900") {
      throw new Error(`Outfit has no ${style.weight} in this theme`);
    }
    return fonts.display[style.weight];
  }
  if (style.family === "hand") {
    if (style.weight !== "500" && style.weight !== "700") {
      throw new Error(`Caveat has no ${style.weight} in this theme`);
    }
    return fonts.hand[style.weight];
  }
  if (
    style.weight !== "400" &&
    style.weight !== "500" &&
    style.weight !== "600" &&
    style.weight !== "700"
  ) {
    throw new Error(`Inter has no ${style.weight} in this theme`);
  }
  return fonts.sans[style.weight];
}

export function resolveType(role: TypeRole, fonts: FontFamilies, fontMode: FontMode): ResolvedType {
  const style = type[role];
  return {
    fontFamily: familyName(style, fonts),
    fontWeight: fontMode === "expo" ? "normal" : style.weight,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
  };
}

export function createTheme(scheme: ColorScheme, fontMode: FontMode = "css"): StoneTheme {
  const fonts = fontMode === "expo" ? expoFontFamilies : cssFontFamilies;
  const color = scheme === "dark" ? darkColors : lightColors;
  return {
    scheme,
    fontMode,
    color,
    paper,
    sheet,
    space,
    radius,
    layout,
    type,
    shadow: elevation[scheme],
    grain: {
      blend: scheme === "dark" ? "screen" : "multiply",
      opacity: scheme === "dark" ? grain.darkOpacity : grain.lightOpacity,
      appOpacity: grain.appOpacity,
    },
    fonts,
    text: (role) => resolveType(role, fonts, fontMode),
  };
}

export const stoneLightTheme = createTheme("light");
export const stoneDarkTheme = createTheme("dark");

/**
 * Plain color map shaped like a React Navigation theme. This module does not
 * import React Navigation; pass the result to its ThemeProvider once the
 * Expo scaffold has that dependency.
 */
export function navigationTheme(theme: StoneTheme) {
  return {
    dark: theme.scheme === "dark",
    colors: {
      primary: theme.color.accent.bg,
      background: theme.color.bg.canvas,
      card: theme.color.bg.surface,
      text: theme.color.text.primary,
      border: theme.color.border.hairline,
      notification: theme.color.status.danger.fill,
    },
  };
}
