import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { previewLede, renderPreview } from "./preview";
import {
  createTheme,
  navigationTheme,
  stoneDarkTheme,
  stoneLightTheme,
} from "./src/theme";
import {
  checkPalette,
  dailyComparison,
  dayTileRadius,
  grain,
  layout,
  paletteCssVars,
  paper,
  radius,
  shadowCss,
  sheet,
  space,
  stoneDark,
  stoneLight,
  type,
  type StonePalette,
} from "./src/tokens";

const root = path.dirname(fileURLToPath(import.meta.url));
const referencePath = path.join(root, "design-theme.html");
const reference = readFileSync(referencePath, "utf8");

function script(doc: string, kind: string): string {
  const marker = `<script type="${kind}">`;
  const start = doc.indexOf(marker);
  assert.ok(start >= 0, `missing ${kind}`);
  const from = start + marker.length;
  const end = doc.indexOf("</script>", from);
  assert.ok(end >= 0, `unclosed ${kind}`);
  return doc.slice(from, end).trim();
}

type ManifestEntry = { mime: string; compressed?: boolean; data: string };
type Manifest = Record<string, ManifestEntry>;

function decodeEntry(entry: ManifestEntry): Buffer {
  let buf = Buffer.from(entry.data, "base64");
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf;
}

const rootManifest = JSON.parse(script(reference, "__bundler/manifest")) as Manifest;
const rootTemplate = JSON.parse(script(reference, "__bundler/template")) as string;

function pageTemplate(title: string): string {
  const match = rootTemplate.match(
    new RegExp(`about:blank#([0-9a-f-]{36})" title="${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  assert.ok(match, `missing board ${title}`);
  const page = decodeEntry(rootManifest[match[1]]).toString("utf8");
  return JSON.parse(script(page, "__bundler/template")) as string;
}

function cssVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const part of block.split(";")) {
    const splitAt = part.indexOf(":");
    if (splitAt < 0) continue;
    const key = part.slice(0, splitAt).trim();
    const value = part.slice(splitAt + 1).trim();
    if (key.startsWith("--")) vars[key] = value;
  }
  return vars;
}

function classBody(css: string, className: string): string {
  const match = css.match(new RegExp(`\\.${className}\\{([^}]*)\\}`));
  assert.ok(match, `missing .${className}`);
  return match[1];
}

const themeTemplate = pageTemplate("stone theme sheet");
const homeTemplate = pageTemplate("stome · home");
const notesTemplate = pageTemplate("stome · notes");
const whiteboardTemplate = pageTemplate("stome · whiteboard");
const deckTemplate = pageTemplate("stome · deck");
const todayLight = pageTemplate("today, stone light");
const todayDark = pageTemplate("today, stone dark");

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

test("reference keeps font licenses and the seven boards", () => {
  assert.match(reference, /Copyright 2020 The Inter Project Authors/);
  assert.match(reference, /Copyright 2021 The Outfit Project Authors/);
  assert.match(reference, /Copyright 2014 The Caveat Project Authors/);
  assert.match(reference, /SIL OPEN FONT LICENSE Version 1\.1/);
  for (const title of [
    "stone theme sheet",
    "today, stone light",
    "today, stone dark",
    "stome · home",
    "stome · notes",
    "stome · whiteboard",
    "stome · deck",
  ]) {
    assert.match(rootTemplate, new RegExp(`title="${title}"`));
  }
  const license = readFileSync(path.join(root, "fonts/OFL.txt"), "utf8");
  assert.match(license, /The Inter Project Authors/);
  assert.match(license, /The Outfit Project Authors/);
  assert.match(license, /The Caveat Project Authors/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("light and dark palettes match the theme sheet", () => {
  const style = themeTemplate.match(/<style>([\s\S]*?)<\/style>/g)?.at(-1) ?? "";
  const light = cssVars(classBody(style, "light"));
  const dark = cssVars(classBody(style, "dark"));
  assert.equal(light["--shadow"], shadowCss.lightCard);
  assert.equal(dark["--shadow"], shadowCss.dark);
  assert.equal(light["--grain"], grain.lightBlend);
  assert.equal(dark["--grain"], grain.darkBlend);
  assert.equal(Number(light["--grainop"]), grain.lightOpacity);
  assert.equal(Number(dark["--grainop"]), grain.darkOpacity);
  for (const [key, cssVar] of Object.entries(paletteCssVars) as [keyof StonePalette, string][]) {
    assert.equal(light[cssVar], stoneLight[key], `light ${cssVar}`);
    assert.equal(dark[cssVar], stoneDark[key], `dark ${cssVar}`);
  }
});

test("app boards use the overcast palette and the measured layout", () => {
  for (const template of [homeTemplate, notesTemplate, whiteboardTemplate, deckTemplate, todayLight]) {
    assert.match(template, new RegExp(`--canvas:${stoneLight.canvas}`));
    assert.match(template, new RegExp(`--surface:${stoneLight.surface}`));
    assert.match(template, new RegExp(`--accent:${stoneLight.accent}`));
    assert.match(template, new RegExp(`--sf:${stoneLight.successFill}`));
    assert.match(template, new RegExp(`--wf:${stoneLight.warningFill}`));
    assert.match(template, new RegExp(`--df:${stoneLight.dangerFill}`));
  }
  assert.match(todayDark, new RegExp(`--canvas:${stoneDark.canvas}`));
  assert.match(todayDark, new RegExp(`--accent:${stoneDark.accent}`));
  assert.match(todayDark, /--shadow:none/);

  assert.match(homeTemplate, /grid-template-columns:248px/);
  assert.match(homeTemplate, /opacity: 0\.2/);
  assert.match(notesTemplate, /grid-template-columns:64px minmax\(0,1fr\) 360px/);
  assert.match(notesTemplate, /max-width:760px/);
  assert.match(notesTemplate, /padding:44px 56px/);
  assert.match(whiteboardTemplate, /--float:0 8px 28px rgba\(36,34,30,0\.16\)/);
  assert.match(whiteboardTemplate, /font:500 22px\/26px Caveat/);
  assert.match(deckTemplate, /grid-template-columns:64px 188px minmax\(0,1fr\) 360px/);
  assert.match(deckTemplate, /background:#f3f0e8/);
  assert.match(deckTemplate, /background:#e0dcd2/);

  assert.equal(layout.sidebar, 248);
  assert.equal(layout.rail, 64);
  assert.equal(layout.inspector, 360);
  assert.equal(layout.thumbs, 188);
  assert.equal(layout.paperMax, 760);
  assert.equal(layout.paperPadY, 44);
  assert.equal(layout.paperPadX, 56);
  assert.equal(paper.slide, "#f3f0e8");
  assert.equal(paper.slideHeader, "#e0dcd2");
  assert.match(todayLight, /border-radius:9px/);
  assert.equal(radius.goal, 9);
  assert.equal(radius.card, 24);
  assert.equal(radius.panel, 28);
  assert.equal(radius.lg, 14);
  assert.equal(space.card, 20);
  assert.equal(layout.control, 44);
});

test("type scale matches the sheet and the app boards", () => {
  assert.match(themeTemplate, /font: 900 64px\/68px Outfit, sans-serif/);
  assert.match(themeTemplate, /letter-spacing: -2px/);
  assert.match(themeTemplate, /font:600 11px\/14px Inter,sans-serif/);
  assert.match(themeTemplate, /letter-spacing:0\.8px/);
  assert.match(themeTemplate, /min-height:44px/);
  assert.match(themeTemplate, /border-radius:14px/);
  assert.match(themeTemplate, /font:600 17px\/24px Inter,sans-serif/);
  assert.match(themeTemplate, /border-radius:24px;padding:20px/);
  assert.match(themeTemplate, /border-radius:28px/);
  assert.match(homeTemplate, /font: 800 32px\/38px Outfit, sans-serif; letter-spacing: -0\.8px/);
  assert.match(homeTemplate, /font: 700 17px\/24px Outfit, sans-serif/);
  assert.match(homeTemplate, /font:900 26px\/32px Outfit,sans-serif/);
  assert.match(homeTemplate, /letter-spacing:-1px/);
  assert.match(notesTemplate, /font:400 17px\/28px Inter,sans-serif/);
  assert.match(notesTemplate, /font:700 22px\/28px Outfit,sans-serif/);
  assert.match(whiteboardTemplate, /font-size: 34px; line-height: 38px/);
  assert.match(deckTemplate, /font: 700 22px\/24px Caveat, cursive/);
  assert.match(deckTemplate, /800 30px\/36px Outfit/);

  assert.equal(type.display.fontSize, 64);
  assert.equal(type.display.lineHeight, 68);
  assert.equal(type.display.letterSpacing, -2);
  assert.equal(type.screenTitle.fontSize, 32);
  assert.equal(type.screenTitle.letterSpacing, -0.8);
  assert.equal(type.eyebrow.letterSpacing, 0.8);
  assert.equal(type.reading.lineHeight, 28);
  assert.equal(type.hand.fontSize, 22);
  assert.equal(type.handTitle.fontSize, 34);
  assert.equal(type.brand.letterSpacing, -1);
});

test("sheet chrome and the daily comparison swatches are recorded, not remixed", () => {
  assert.match(themeTemplate, /background: #b9b3a6/);
  assert.match(themeTemplate, /color: #3a3731/);
  assert.match(themeTemplate, /border: 1px solid #8f897c/);
  assert.match(themeTemplate, /#f7f7f5/);
  assert.match(themeTemplate, /#ffffff/);
  assert.match(themeTemplate, /#12a150/);
  assert.match(themeTemplate, /#0c0c0d/);
  assert.equal(sheet.background, "#b9b3a6");
  assert.equal(sheet.muted, "#3a3731");
  assert.equal(sheet.line, "#8f897c");
  assert.equal(dailyComparison.success, "#12a150");
  assert.match(themeTemplate, /opacity: 0\.28/);
  assert.equal(grain.sheetOpacity, 0.28);
  assert.equal(grain.appOpacity, 0.2);
});

test("extracted font files are the bytes embedded in the reference", () => {
  function nested(title: string, id: string): Buffer {
    const match = rootTemplate.match(
      new RegExp(`about:blank#([0-9a-f-]{36})" title="${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
    assert.ok(match);
    const page = decodeEntry(rootManifest[match[1]]).toString("utf8");
    const manifest = JSON.parse(script(page, "__bundler/manifest")) as Manifest;
    return decodeEntry(manifest[id]);
  }
  const files: [string, string, string][] = [
    ["fonts/inter-latin.woff2", "stone theme sheet", "145dbb73-334a-4aa8-941a-da4a828c4df1"],
    ["fonts/outfit-latin.woff2", "stone theme sheet", "62b9ae9a-2ee7-40af-815e-5f4405bcfb38"],
    ["fonts/caveat-500-latin.woff2", "stome · whiteboard", "1cc382d3-2c7a-4030-a9e8-0c1c6ae7e7e3"],
    ["fonts/caveat-700-latin.woff", "stome · deck", "00f6806f-b99c-491a-a2db-a3441da22c10"],
  ];
  for (const [file, title, id] of files) {
    const onDisk = readFileSync(path.join(root, file));
    const embedded = nested(title, id);
    assert.equal(createHash("sha256").update(onDisk).digest("hex"), createHash("sha256").update(embedded).digest("hex"), file);
  }
});

test("text clears 4.5:1 on the surfaces the sheet names, and status fills clear 3:1", () => {
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
        assert.ok(ratio >= 4.5, `${name} ${text} on ${background} is ${ratio.toFixed(2)}`);
      }
    }
    assert.ok(contrast(palette.accentForeground, palette.accent) >= 4.5, name);
    assert.ok(contrast(palette.successText, palette.successWash) >= 4.5, `${name} success`);
    assert.ok(contrast(palette.warningText, palette.warningWash) >= 4.5, `${name} warning`);
    assert.ok(contrast(palette.dangerText, palette.dangerWash) >= 4.5, `${name} danger`);
    assert.ok(contrast(palette.onFill, palette.successFill) >= 4.5, `${name} moss fill`);
    assert.ok(contrast(palette.onFill, palette.warningFill) >= 4.5, `${name} lichen fill`);
    assert.ok(contrast(palette.onFill, palette.dangerFill) >= 4.5, `${name} rust fill`);
    assert.ok(contrast(palette.borderStrong, palette.surface) >= 3, `${name} strong border`);
    assert.ok(contrast(palette.successFill, palette.canvas) >= 3, `${name} moss on canvas`);
    assert.ok(contrast(palette.warningFill, palette.canvas) >= 3, `${name} lichen on canvas`);
    assert.ok(contrast(palette.dangerFill, palette.canvas) >= 3, `${name} rust on canvas`);
  }
  assert.ok(contrast(paper.slideText, paper.slide) >= 4.5);
  assert.ok(contrast(paper.slideMuted, paper.slideHeader) >= 4.5);
});

test("theme objects and the navigation map follow the palette", () => {
  assert.equal(stoneLightTheme.scheme, "light");
  assert.equal(stoneLightTheme.color.bg.canvas, "#d8d3c8");
  assert.equal(stoneLightTheme.color.text.primary, "#24221e");
  assert.equal(stoneDarkTheme.color.accent.bg, "#e6e2d8");
  assert.equal(dayTileRadius(layout.habit), radius.tile);
  assert.equal(dayTileRadius(36), radius.goal);
  assert.deepEqual(checkPalette().failures, []);
  assert.equal(stoneLightTheme.shadow.card.shadowOpacity, 0.08);
  assert.equal(stoneLightTheme.shadow.card.shadowRadius, 12);
  assert.equal(stoneDarkTheme.shadow.card.elevation, 0);
  assert.equal(stoneDarkTheme.grain.blend, "screen");
  assert.equal(stoneLightTheme.text("screenTitle").fontFamily, "Outfit");
  assert.equal(stoneLightTheme.text("screenTitle").fontWeight, "800");
  assert.equal(stoneLightTheme.text("screenTitle").fontSize, 32);
  const expo = createTheme("dark", "expo");
  assert.equal(expo.text("screenTitle").fontFamily, "Outfit_800ExtraBold");
  assert.equal(expo.text("screenTitle").fontWeight, "normal");
  assert.equal(expo.text("hand").fontFamily, "Caveat_500Medium");
  const nav = navigationTheme(stoneLightTheme);
  assert.equal(nav.dark, false);
  assert.equal(nav.colors.background, stoneLight.canvas);
  assert.equal(nav.colors.card, stoneLight.surface);
  assert.equal(nav.colors.text, stoneLight.textPrimary);
  assert.equal(nav.colors.primary, stoneLight.accent);
  assert.equal(nav.colors.border, stoneLight.borderHairline);
  assert.equal(nav.colors.notification, stoneLight.dangerFill);
});

test("preview.html is generated from the tokens", () => {
  const committed = readFileSync(path.join(root, "preview.html"), "utf8");
  const generated = renderPreview();
  assert.equal(committed, generated);
  for (const hex of [...Object.values(stoneLight), ...Object.values(stoneDark), paper.slide, sheet.background]) {
    assert.ok(committed.includes(hex), hex);
  }
  const blanket =
    "every text token clears 4.5:1 on every background, borders and fills clear 3:1";
  assert.equal(themeTemplate.includes(blanket), true);
  assert.equal(generated.includes(blanket), false);
  assert.equal(generated.includes("every text token"), false);
  assert.equal(generated.includes("on every background"), false);
  assert.equal(generated.includes("borders and fills clear 3:1"), false);
  assert.match(
    generated,
    /primary, secondary, and tertiary text clear 4\.5:1 on canvas, surface, surface-alt, and inset/,
  );
  assert.match(generated, /hairline borders and disabled text do not meet those ratios/);
  assert.equal(generated.includes(previewLede), true);
  assert.equal(previewLede.includes(blanket), false);
});
