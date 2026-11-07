/**
 * Renders the committed reference and the generated preview in Chrome.
 *
 * This file is JavaScript. The Expo typecheck leaves checkJs off, so tsc
 * does not resolve puppeteer-core here. The package is loaded with
 * createRequire so a full-tree ESLint run does not treat it as a static
 * import. It is not an app dependency.
 * Run with Node 22: `node design-theme/screenshot.mjs`
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paletteCssVars, stoneDark, stoneLight } from "./src/tokens/primitives.ts";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = "/opt/cursor/artifacts/design-theme";
const chrome = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";

const boards = [
  ["stone theme sheet", "reference-theme-sheet.png"],
  ["today, stone light", "reference-today-light.png"],
  ["today, stone dark", "reference-today-dark.png"],
  ["stome · home", "reference-home.png"],
  ["stome · notes", "reference-notes.png"],
  ["stome · whiteboard", "reference-whiteboard.png"],
  ["stome · deck", "reference-deck.png"],
];

function fileUrl(file) {
  return `file://${path.join(root, file)}`;
}

async function readVars(frame, selector) {
  const names = Object.values(paletteCssVars);
  return frame.evaluate(
    ({ sel, names: keys }) => {
      const el = document.querySelector(sel);
      if (!el) return {};
      const style = getComputedStyle(el);
      const out = {};
      for (const name of keys) {
        const value = style.getPropertyValue(name).trim();
        if (value) out[name] = value;
      }
      return out;
    },
    { sel: selector, names },
  );
}

function assertPalette(label, actual, palette) {
  const mismatches = [];
  for (const [key, cssVar] of Object.entries(paletteCssVars)) {
    if (!(cssVar in actual)) continue;
    const got = actual[cssVar].toLowerCase();
    const want = palette[key].toLowerCase();
    if (got !== want) mismatches.push(`${cssVar} ${got} != ${want}`);
  }
  if (!actual["--canvas"]) throw new Error(`${label} did not resolve --canvas`);
  if (mismatches.length) {
    throw new Error(`${label}\n${mismatches.join("\n")}`);
  }
  console.log(`${label}: ${Object.keys(actual).length} custom properties match the tokens present`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files", "--font-render-hinting=none"],
  });

  try {
    mkdirSync(outDir, { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
    await page.goto(fileUrl("design-theme.html"), { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(
      () => {
        const frames = [...document.querySelectorAll("iframe")];
        return frames.length === 7 && frames.every((frame) => frame.getAttribute("src")?.startsWith("blob:"));
      },
      { timeout: 30000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const [title, filename] of boards) {
      const handle = await page.$(`iframe[title="${title}"]`);
      if (!handle) throw new Error(`missing iframe ${title}`);
      const frame = await handle.contentFrame();
      if (!frame) throw new Error(`no frame for ${title}`);
      await frame.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 20, {
        timeout: 15000,
      });
      await handle.screenshot({ path: path.join(outDir, filename) });
      console.log("wrote", filename);
      if (title === "stone theme sheet") {
        assertPalette("reference overcast", await readVars(frame, ".light"), stoneLight);
        assertPalette("reference dusk", await readVars(frame, ".dark"), stoneDark);
        const font = await frame.evaluate(() => {
          const h1 = document.querySelector("h1");
          const computed = h1 ? getComputedStyle(h1) : null;
          return {
            family: computed?.fontFamily ?? "",
            size: computed?.fontSize ?? "",
            weight: computed?.fontWeight ?? "",
            outfit: document.fonts.check("900 64px Outfit"),
            inter: document.fonts.check("16px Inter"),
          };
        });
        console.log("reference h1", JSON.stringify(font));
        if (!font.family.toLowerCase().includes("outfit")) {
          throw new Error(`theme sheet h1 did not resolve Outfit: ${font.family}`);
        }
      }
      if (title === "stome · home") {
        assertPalette("reference home", await readVars(frame, ".t"), stoneLight);
      }
      if (title === "today, stone dark") {
        assertPalette("reference today dark", await readVars(frame, ".t"), stoneDark);
      }
    }

    await page.goto(fileUrl("preview.html"), { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForSelector(".panel.light");
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
    await page.screenshot({ path: path.join(outDir, "generated-theme.png"), fullPage: true });
    console.log("wrote generated-theme.png");
    assertPalette("generated overcast", await readVars(page.mainFrame(), ".light"), stoneLight);
    assertPalette("generated dusk", await readVars(page.mainFrame(), ".dark"), stoneDark);
    const generatedFont = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const computed = h1 ? getComputedStyle(h1) : null;
      return {
        family: computed?.fontFamily ?? "",
        size: computed?.fontSize ?? "",
        weight: computed?.fontWeight ?? "",
        outfit: document.fonts.check("900 64px Outfit"),
        caveat: document.fonts.check("500 22px Caveat"),
      };
    });
    console.log("generated h1", JSON.stringify(generatedFont));
    if (!generatedFont.family.toLowerCase().includes("outfit")) {
      throw new Error(`preview h1 did not resolve Outfit: ${generatedFont.family}`);
    }
  } finally {
    await browser.close();
  }
}

main();
