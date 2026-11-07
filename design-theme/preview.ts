/**
 * Builds preview.html from the tokens so the specimen cannot drift from the theme.
 * Open it next to design-theme.html. Grain filters are the ones from the sheet.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dailyComparison,
  grain,
  paper,
  sheet,
  stoneDark,
  stoneLight,
  type StonePalette,
} from "./src/tokens";

function vars(palette: StonePalette): string {
  return [
    `--canvas:${palette.canvas}`,
    `--surface:${palette.surface}`,
    `--alt:${palette.surfaceAlt}`,
    `--inset:${palette.inset}`,
    `--inverse:${palette.inverse}`,
    `--primary:${palette.textPrimary}`,
    `--secondary:${palette.textSecondary}`,
    `--tertiary:${palette.textTertiary}`,
    `--disabled:${palette.textDisabled}`,
    `--hair:${palette.borderHairline}`,
    `--strong:${palette.borderStrong}`,
    `--accent:${palette.accent}`,
    `--accentfg:${palette.accentForeground}`,
    `--sf:${palette.successFill}`,
    `--st:${palette.successText}`,
    `--sw:${palette.successWash}`,
    `--wf:${palette.warningFill}`,
    `--wt:${palette.warningText}`,
    `--ww:${palette.warningWash}`,
    `--df:${palette.dangerFill}`,
    `--dt:${palette.dangerText}`,
    `--dw:${palette.dangerWash}`,
    `--onfill:${palette.onFill}`,
  ].join(";");
}

function panel(scheme: "light" | "dark", title: string, palette: StonePalette): string {
  const grainId = scheme === "light" ? "lGrain" : "dGrain";
  const matrix =
    scheme === "light"
      ? "0 0 0 0 0.2 0 0 0 0 0.19 0 0 0 0 0.16 0 0 0 0.6 0"
      : "0 0 0 0 0.9 0 0 0 0 0.88 0 0 0 0 0.84 0 0 0 0.6 0";
  const backgrounds: [string, keyof StonePalette][] = [
    ["bg-canvas", "canvas"],
    ["bg-surface", "surface"],
    ["bg-surface-alt", "surfaceAlt"],
    ["bg-inset", "inset"],
    ["bg-inverse", "inverse"],
  ];
  const texts: [string, keyof StonePalette][] = [
    ["text-primary", "textPrimary"],
    ["text-secondary", "textSecondary"],
    ["text-tertiary", "textTertiary"],
    ["text-disabled", "textDisabled"],
  ];
  return `<section class="panel ${scheme}" aria-label="stone ${scheme}">
<svg class="grain" aria-hidden="true"><filter id="${grainId}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"></feTurbulence><feColorMatrix values="${matrix}"></feColorMatrix></filter><rect width="100%" height="100%" filter="url(#${grainId})"></rect></svg>
<div class="inner">
<h2>${title}</h2>
<p class="eyebrow">backgrounds</p>
<div class="grid">${backgrounds
    .map(
      ([name, key]) =>
        `<div class="sw"><div class="chip" style="background:${palette[key]}"></div><span class="nm">${name}</span><span class="hx">${palette[key]}</span></div>`,
    )
    .join("")}</div>
<p class="eyebrow">text, on surface</p>
<div class="grid">${texts
    .map(
      ([name, key]) =>
        `<div class="sw"><div class="aa" style="color:${palette[key]}">Aa</div><span class="nm">${name}</span><span class="hx">${palette[key]}</span></div>`,
    )
    .join("")}<div class="sw"><div class="aa" style="background:${palette.accent};color:${palette.accentForeground};border-color:${palette.accent}">Aa</div><span class="nm">accent bg / fg</span><span class="hx">${palette.accent} / ${palette.accentForeground}</span></div></div>
<p class="eyebrow">lines</p>
<div class="grid">
<div class="sw"><div class="chip" style="background:${palette.surface};border:2px solid ${palette.borderHairline}"></div><span class="nm">border-hairline</span><span class="hx">${palette.borderHairline}</span></div>
<div class="sw"><div class="chip" style="background:${palette.surface};border:2px solid ${palette.borderStrong}"></div><span class="nm">border-strong</span><span class="hx">${palette.borderStrong}</span></div>
<div class="sw"><div class="chip label" style="background:${palette.successFill};color:${palette.onFill};border-color:${palette.successFill}">label</div><span class="nm">status-on-fill</span><span class="hx">${palette.onFill}</span></div>
</div>
<p class="eyebrow">status · fill, text, wash</p>
<div class="grid thirds">
<div class="sw"><div class="stat"><span style="background:${palette.successFill};color:${palette.onFill}">moss</span><span style="background:${palette.successWash};color:${palette.successText}">done</span></div><span class="nm">success</span><span class="hx">${palette.successFill} · ${palette.successText} · ${palette.successWash}</span></div>
<div class="sw"><div class="stat"><span style="background:${palette.warningFill};color:${palette.onFill}">lichen</span><span style="background:${palette.warningWash};color:${palette.warningText}">at risk</span></div><span class="nm">warning</span><span class="hx">${palette.warningFill} · ${palette.warningText} · ${palette.warningWash}</span></div>
<div class="sw"><div class="stat"><span style="background:${palette.dangerFill};color:${palette.onFill}">rust</span><span style="background:${palette.dangerWash};color:${palette.dangerText}">missed</span></div><span class="nm">danger</span><span class="hx">${palette.dangerFill} · ${palette.dangerText} · ${palette.dangerWash}</span></div>
</div>
<p class="eyebrow">in use</p>
<div class="card">
<div class="split"><h3>read 20 pages</h3><span class="quiet">3 of 5</span></div>
<div class="row">
<div class="tile" style="background:${palette.accent}"></div>
<div class="tile" style="background:${palette.accent}"></div>
<div class="tile" style="background:${palette.accent}"></div>
<div class="tile" style="background:${palette.warningWash};border:1.5px solid ${palette.warningFill}"></div>
<div class="tile" style="background:${palette.inset}"></div>
<div class="tile ghost"></div>
<div class="tile ghost"></div>
</div>
<div class="row">
<span class="badge" style="background:${palette.successWash};color:${palette.successText}">on track</span>
<span class="badge" style="background:${palette.warningWash};color:${palette.warningText}">streak at risk</span>
<span class="badge" style="background:${palette.dangerWash};color:${palette.dangerText}">missed</span>
</div>
<div class="row">
<button class="btn" type="button" style="background:${palette.accent};color:${palette.accentForeground}">log today</button>
<button class="btn ghostbtn" type="button">edit goal</button>
<button class="btn" type="button" style="background:${palette.dangerFill};color:${palette.onFill}">delete</button>
</div>
</div>
</div>
</section>`;
}

/**
 * The sheet's own lede says every text token clears 4.5:1 on every background
 * and that borders and fills clear 3:1. checkPalette() does not support that.
 * This sentence is the generated preview only. design-theme.html keeps the
 * original wording.
 */
export const previewLede =
  "sarsen and chalk under an overcast sky. the neutrals are weathered stone, and status borrows from the field around it: moss for done, yellow lichen for at risk, iron rust for missed. emphasis is still inversion. primary, secondary, and tertiary text clear 4.5:1 on canvas, surface, surface-alt, and inset. accent foreground on accent, status text on its wash, and on-fill on status fills clear 4.5:1. strong borders clear 3:1 on surface, and status fills clear 3:1 on canvas. hairline borders and disabled text do not meet those ratios, and those reference colors stay.";

export function renderPreview(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stome design theme</title>
<style>
@font-face{font-family:Inter;src:url("fonts/inter-latin.woff2") format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:Outfit;src:url("fonts/outfit-latin.woff2") format("woff2");font-weight:700 900;font-display:swap}
@font-face{font-family:Caveat;src:url("fonts/caveat-500-latin.woff2") format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:Caveat;src:url("fonts/caveat-700-latin.woff") format("woff");font-weight:700;font-display:swap}
*{box-sizing:border-box}
body{margin:0;background:${sheet.background};color:#24221e;font-family:Inter,sans-serif}
.sheet{position:relative;width:1440px;box-sizing:border-box;padding:64px;display:flex;flex-direction:column;gap:40px;overflow:hidden}
.sheet>svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:multiply;opacity:${grain.sheetOpacity}}
header{position:relative;display:flex;justify-content:space-between;align-items:flex-end;gap:40px}
.kicker{margin:0;font:600 11px/14px Inter,sans-serif;letter-spacing:0.8px;color:${sheet.muted}}
h1{margin:0;font:900 64px/68px Outfit,sans-serif;letter-spacing:-2px}
.lede{margin:0;max-width:680px;font:400 17px/24px Inter,sans-serif;color:${sheet.muted}}
.intro{display:flex;flex-direction:column;gap:12px}
.compare{display:flex;gap:12px}
.swatchcol{display:flex;flex-direction:column;gap:6px;align-items:center}
.strip{display:flex;border-radius:14px;overflow:hidden;border:1px solid ${sheet.line}}
.strip i{width:40px;height:64px;display:block}
.swatchcol span{font:500 12px/16px Inter,sans-serif;color:${sheet.muted}}
.panels{position:relative;display:flex;gap:32px;align-items:stretch}
.light{${vars(stoneLight)};--shadow:0 2px 12px rgba(36,34,30,0.08);--grain:multiply;--grainop:${grain.lightOpacity}}
.dark{${vars(stoneDark)};--shadow:none;--grain:screen;--grainop:${grain.darkOpacity}}
.panel{position:relative;overflow:hidden;background:var(--canvas);color:var(--primary);border-radius:28px;flex:1;min-width:0}
.grain{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:var(--grain);opacity:var(--grainop)}
.inner{position:relative;padding:32px;display:flex;flex-direction:column;gap:24px}
.panel h2{margin:0;font:800 26px/32px Outfit,sans-serif;letter-spacing:-0.6px}
.eyebrow{font:600 11px/14px Inter,sans-serif;letter-spacing:0.8px;color:var(--tertiary);margin:0}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.thirds{grid-template-columns:repeat(3,1fr)}
.sw{display:flex;flex-direction:column;gap:6px}
.chip{height:64px;border-radius:14px;border:1px solid var(--hair)}
.nm{font:500 12px/16px Inter,sans-serif;color:var(--primary)}
.hx{font:400 12px/16px Inter,sans-serif;color:var(--tertiary);font-variant-numeric:tabular-nums}
.aa{height:64px;border-radius:14px;background:var(--surface);border:1px solid var(--hair);display:flex;align-items:center;justify-content:center;font:800 26px/32px Outfit,sans-serif}
.card{background:var(--surface);border-radius:24px;padding:20px;box-shadow:var(--shadow);border:1px solid var(--hair);display:flex;flex-direction:column;gap:16px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 8px;border-radius:999px;font:500 12px/16px Inter,sans-serif}
.tile{width:28px;height:28px;border-radius:7px}
.ghost{border:1px solid var(--hair)}
.btn{min-height:44px;padding:0 20px;border-radius:14px;border:0;font:600 17px/24px Inter,sans-serif}
.ghostbtn{background:transparent;color:var(--primary);border:1px solid var(--strong)}
.stat{display:flex;height:64px;border-radius:14px;overflow:hidden}
.stat span{flex:1;display:flex;align-items:center;justify-content:center;font:700 15px/20px Inter,sans-serif}
.label{display:flex;align-items:center;justify-content:center;font:600 15px/20px Inter,sans-serif}
.split{display:flex;justify-content:space-between;align-items:baseline}
h3{margin:0;font:700 22px/28px Outfit,sans-serif;letter-spacing:-0.4px;color:var(--primary)}
.quiet{font:400 15px/20px Inter,sans-serif;color:var(--tertiary)}
.surfaces{position:relative;display:grid;grid-template-columns:1.1fr 0.9fr 0.9fr;gap:16px}
.paper{background:${stoneLight.surface};border:1px solid ${stoneLight.borderHairline};border-radius:24px;box-shadow:0 2px 12px rgba(36,34,30,0.08);padding:28px 32px}
.paper h2{margin:0 0 8px;font:800 32px/38px Outfit,sans-serif;letter-spacing:-0.8px}
.paper p{margin:0 0 12px;font:400 17px/28px Inter,sans-serif}
mark{background:${stoneLight.warningWash};color:inherit;border-radius:4px;padding:1px 2px;box-shadow:inset 0 -2px 0 ${stoneLight.warningFill}}
.ask{display:flex;align-items:center;gap:12px;padding:8px 8px 8px 20px;background:${stoneLight.surface};border:1px solid ${stoneLight.borderHairline};border-radius:24px;box-shadow:0 2px 12px rgba(36,34,30,0.08)}
.ask span{flex:1;font:400 17px/24px Inter,sans-serif;color:${stoneLight.textTertiary}}
.ask button{min-height:44px;padding:0 18px;border-radius:14px;border:0;background:${stoneLight.accent};color:${stoneLight.accentForeground};font:600 15px/20px Inter,sans-serif}
.sticky{padding:14px 16px;border-radius:6px;font:500 22px/26px Caveat,cursive;color:${stoneLight.textPrimary};box-shadow:0 3px 8px rgba(36,34,30,0.14)}
.note{background:${stoneLight.surface};border:1px solid ${stoneLight.borderHairline};border-radius:20px;box-shadow:0 8px 28px rgba(36,34,30,0.16);padding:16px;display:flex;flex-direction:column;gap:10px;font:400 14px/20px Inter,sans-serif}
.q{align-self:flex-end;max-width:90%;background:${stoneLight.accent};color:${stoneLight.accentForeground};padding:10px 14px;border-radius:16px 16px 4px 16px;font:400 15px/21px Inter,sans-serif}
.slide{background:${paper.slide};border-radius:10px;box-shadow:0 8px 28px rgba(36,34,30,0.16);padding:28px 32px}
.slide b{display:block;font:800 30px/36px Outfit,sans-serif;color:${paper.slideText}}
.slide p{margin:8px 0 0;font:400 14px/19px Inter,sans-serif;color:${paper.slideText}}
.hd{margin-top:12px;background:${paper.slideHeader};color:${paper.slideMuted};font:600 13px/18px Inter,sans-serif;padding:8px 10px;border-radius:6px}
.col{display:flex;flex-direction:column;gap:12px}
.cap{font:600 11px/14px Inter,sans-serif;letter-spacing:0.8px;color:${sheet.muted};margin:0}
</style>
</head>
<body>
<div class="sheet">
<svg aria-hidden="true"><filter id="bgGrain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"></feTurbulence><feColorMatrix values="0 0 0 0 0.2 0 0 0 0 0.19 0 0 0 0 0.16 0 0 0 0.7 0"></feColorMatrix></filter><filter id="bgMottle"><feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="4" seed="7"></feTurbulence><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.38 0 0 0 0 0.28 0 0 0 1.4 -0.55"></feColorMatrix></filter><rect width="100%" height="100%" filter="url(#bgMottle)"></rect><rect width="100%" height="100%" filter="url(#bgGrain)"></rect></svg>
<header>
<div class="intro">
<svg width="72" height="48" viewBox="0 0 72 48" role="img" aria-label="trilithon mark"><rect x="4" y="2" width="64" height="11" rx="2" fill="${stoneLight.accent}"></rect><rect x="9" y="16" width="16" height="32" rx="2" fill="${stoneLight.accent}"></rect><rect x="47" y="16" width="16" height="32" rx="2" fill="${stoneLight.accent}"></rect></svg>
<p class="kicker">fork of daily · stonehenge</p>
<h1>daily stone</h1>
<p class="lede">${previewLede}</p>
</div>
<div class="compare">
<div class="swatchcol"><div class="strip"><i style="background:${dailyComparison.canvas}"></i><i style="background:${dailyComparison.surface}"></i><i style="background:${dailyComparison.success}"></i><i style="background:${dailyComparison.inverse}"></i></div><span>daily</span></div>
<div class="swatchcol"><div class="strip"><i style="background:${stoneLight.canvas}"></i><i style="background:${stoneLight.surface}"></i><i style="background:${stoneLight.successFill}"></i><i style="background:${stoneDark.canvas}"></i></div><span>stone</span></div>
</div>
</header>
<div class="panels">
${panel("light", "overcast", stoneLight)}
${panel("dark", "dusk", stoneDark)}
</div>
<section class="surfaces" aria-label="stome surfaces">
<div class="ask" style="grid-column:1 / -1"><span>ask anything across your notes, boards and decks</span><button type="button">ask</button></div>
<div class="col">
<p class="cap">notes</p>
<article class="paper">
<p class="kicker" style="color:${stoneLight.textTertiary}">biology 101 / notes</p>
<h2>cellular respiration</h2>
<p>it makes 4 atp but spends 2 getting started, so the net is <mark>2 atp</mark>, plus 2 nadh.</p>
</article>
</div>
<div class="col">
<p class="cap">whiteboard</p>
<div class="sticky" style="background:${stoneLight.warningWash}">per glucose the cycle runs twice!</div>
<div class="sticky" style="background:${stoneLight.successWash}">where does the co₂ we breathe out come from?</div>
<div class="note"><span class="badge" style="background:${stoneLight.dangerWash};color:${stoneLight.dangerText}">check this</span><span>citrate has 6 carbons: acetyl-coa (2) joins oxaloacetate (4).</span></div>
</div>
<div class="col">
<p class="cap">deck and ask thread</p>
<div class="slide"><b>Type I and Type II errors</b><p>false alarm</p><div class="hd">H₀ true</div></div>
<div class="q">why is glycolysis net 2 atp and not 4?</div>
</div>
</section>
</div>
</body>
</html>
`;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "preview.html");
  writeFileSync(dest, renderPreview());
}
