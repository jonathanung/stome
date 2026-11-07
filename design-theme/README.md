# Design theme

Stone is Stome’s design theme: weathered sarsen neutrals, with moss, yellow lichen, and iron rust for status. Emphasis is inversion. It is a fork of the daily palette, and the daily swatches stay on the comparison strip only.

The source of the values is [`design-theme.html`](design-theme.html), the supplied reference. It is committed whole, including the SIL Open Font License notice, the Inter, Outfit, and Caveat copyright lines, and the embedded font files. [`preview.html`](preview.html) is generated from the tokens so the specimen and the React Native theme cannot drift apart.

## Skills

There is no skill named design-theme. Daily itself (`https://github.com/jonathanung/daily`) is not visible with this environment’s credentials. The skills port that did land is on `main`, under `.claude/skills/`. The one that applies here is [`.claude/skills/ui-component/SKILL.md`](../.claude/skills/ui-component/SKILL.md). The others (`api-endpoint`, `epic-decompose`, `issue-create`, `issue-handler`, `issue-orchestrator`, `sync-invariants`) are about issues and sync, not the palette.

From that skill, this theme keeps:

- Semantic tokens for both schemes, so a missing color is a type error (`SemanticColors` in `src/tokens/semantic.ts`). Raw values live in `src/tokens/primitives.ts`.
- Components read `theme.color.bg.surface`, `theme.space`, and `theme.radius`. They do not contain hex.
- Accent is inversion. Status color is moss, lichen, and rust, which is this reference’s sage / ochre / clay.
- `DayTile` uses the skill’s radius: 2px for every 8px of size. A 28px tile is 7px, a 36px tile is 9px, matching the sheet and the today board.
- Touch targets are at least 44. Chips and segment labels are 32px tall and recover the rest with `hitSlop`.
- `createStyles`, `Stack` (`gap` and `p` take space names), and `useReduceMotion` are the skill’s styling and motion hooks. Nothing in this package animates yet.
- `checkPalette()` is the contrast check the issue-handler skill asks for when tokens move.

`docs/UI.md` and Daily’s `app/src/ui/tokens/*` were not in the port, so the numeric space scale those files would define (`t.space[4]`) is not copied. Space keys here are the measurements from the reference (`card` is 20, `inner` is 32). This package stays in `design-theme/` until the Expo scaffold exists. It does not create `app/src/ui/`, which is where the skill says those tokens live in Daily, because that tree belongs to the scaffold branch.

## Color

Two schemes, overcast and dusk. Names follow the sheet (`bg-canvas`, `text-primary`, `border-hairline`, and the status triplet fill / text / wash).

| Token | Overcast | Dusk | Sheet variable |
| --- | --- | --- | --- |
| canvas | `#d8d3c8` | `#1b1c1a` | `--canvas` |
| surface | `#e8e4da` | `#252622` | `--surface` |
| surfaceAlt | `#cfc9bd` | `#2f302b` | `--alt` |
| inset | `#c8c2b5` | `#383933` | `--inset` |
| inverse | `#24221e` | `#e6e2d8` | `--inverse` |
| textPrimary | `#24221e` | `#e6e2d8` | `--primary` |
| textSecondary | `#46423b` | `#bdb8ad` | `--secondary` |
| textTertiary | `#524d44` | `#aaa59a` | `--tertiary` |
| textDisabled | `#a39d90` | `#4c4b45` | `--disabled` |
| borderHairline | `#c2bcaf` | `#383933` | `--hair` |
| borderStrong | `#6a6458` | `#8c887e` | `--strong` |
| accent / accentForeground | `#33302a` / `#e8e4da` | `#e6e2d8` / `#1b1c1a` | `--accent` / `--accentfg` |
| success fill / text / wash | `#4a6e36` / `#365428` / `#cdd5ba` | `#8fb06a` / `#aecb8e` / `#232d1c` | `--sf` / `--st` / `--sw` |
| warning fill / text / wash | `#8a6410` / `#5f4506` / `#e2d4a8` | `#d6a63a` / `#e8c46a` / `#312910` | `--wf` / `--wt` / `--ww` |
| danger fill / text / wash | `#a3472a` / `#843219` / `#e4cbbd` | `#e27a52` / `#f2987c` / `#382119` | `--df` / `--dt` / `--dw` |
| onFill | `#f3f0e8` | `#141412` | `--onfill` |

Status language from the sheet: moss is done, lichen is at risk, rust is missed.

Slide paper does not invert. The deck board paints it as chalk in both schemes: slide `#f3f0e8`, slide header `#e0dcd2`, slide text `#24221e`, slide header text `#46423b`, slide border `#c2bcaf`.

The sheet backdrop, outside the panels, is `#b9b3a6` with muted text `#3a3731` and a `#8f897c` rule. The daily comparison strip is `#f7f7f5`, `#ffffff`, `#12a150`, `#0c0c0d`.

### Contrast

Checked in `check-theme.ts` against WCAG relative luminance.

Primary, secondary, and tertiary text each clear 4.5:1 on canvas, surface, surface-alt, and inset, in both schemes. Accent foreground on accent clears 4.5:1. Status text on its wash clears 4.5:1, and on-fill on moss, lichen, and rust fills clears 4.5:1. Strong borders clear 3:1 on surface (4.62:1 overcast, 4.31:1 dusk). Those three fills clear 3:1 on canvas. Slide text on slide paper is 13.94:1.

Two reference colors do not meet the sheet’s prose and were kept anyway:

- Hairline on surface is 1.49:1 overcast and 1.31:1 dusk. It is a quiet edge, not a text border.
- Disabled text on surface is 2.13:1 overcast and 1.74:1 dusk.

## Type

Inter is UI text. Outfit is display. Caveat is handwriting on boards and slides. The files under `fonts/` are the latin subsets embedded in the reference, with the OFL in `fonts/OFL.txt` and again in the HTML comment.

| Role | Face | Size / line | Tracking |
| --- | --- | --- | --- |
| display | Outfit 900 | 64 / 68 | -2 |
| brand | Outfit 900 | 26 / 32 | -1 |
| screenTitle | Outfit 800 | 32 / 38 | -0.8 |
| section | Outfit 800 | 26 / 32 | -0.6 |
| title | Outfit 700 | 22 / 28 | -0.4 |
| actionTitle | Outfit 700 | 17 / 24 | 0 |
| cardTitle | Outfit 700 | 17 / 22 | 0 |
| slideTitle | Outfit 800 | 30 / 36 | 0 |
| body | Inter 400 | 17 / 24 | 0 |
| reading | Inter 400 | 17 / 28 | 0 |
| bodySmall | Inter 400 | 15 / 22 | 0 |
| ask | Inter 400 | 15 / 21 | 0 |
| button | Inter 600 | 17 / 24 | 0 |
| buttonCompact | Inter 600 | 15 / 20 | 0 |
| eyebrow | Inter 600 | 11 / 14 | 0.8 |
| label, badge | Inter 500 | 12 / 16 | 0 |
| nav | Inter 500 | 14 / 20 | 0 |
| chip | Inter 500 | 13 / 18 | 0 |
| hand | Caveat 500 | 22 / 26 | 0 |
| handStrong | Caveat 700 | 22 / 24 | 0 |
| handTitle | Caveat 700 | 34 / 38 | 0 |

`handCaption` is Caveat 700 at 18px. On the whiteboard that size inherits the node caption’s 16px line box.

## Space, radius, elevation

Spacing used by the boards, in px: 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 44, 48, 56, 64. Cards are padded 20. Panels are padded 32. The sheet page is padded 64. Note paper is padded 44 by 56, up to 760 wide. Home content is padded 40 by 48.

Radii: mark 4, thumb and sticky 6, habit tile 7, today goal tile 9, controls 10–14, bubbles 16, floating annotation 20, cards 24, sheet panels 28, pills 999. Buttons are at least 44 tall. Icon buttons are 44. The sidebar is 248, the icon rail is 64, the ask column is 360, and slide thumbnails are 188.

Light card shadow is `0 2px 12px rgba(36,34,30,0.08)`. Floating bars use `0 8px 28px rgba(36,34,30,0.16)`. Stickies use `0 3px 8px rgba(36,34,30,0.14)`. The selected segment uses `0 1px 3px rgba(36,34,30,0.12)`. Dusk sets `--shadow: none` and does not define the other three, so dark elevation is flat.

Grain on the panels is multiply at 0.22 in overcast and screen at 0.10 in dusk. The sheet backdrop is multiply at 0.28. App boards use multiply at 0.20. The fractal noise itself is the SVG filter in the reference and in `preview.html`.

## React Native

Import from `design-theme/src` once the Expo app exists:

```tsx
import { ThemeProvider, Screen, Card, StoneText, Button } from "../design-theme/src";

export function Root() {
  return (
    <ThemeProvider scheme="system" fontMode="expo">
      <Screen>
        <Card>
          <StoneText role="screenTitle">good morning</StoneText>
          <Button label="ask" />
        </Card>
      </Screen>
    </ThemeProvider>
  );
}
```

Primitives: `Screen`, `Surface`, `Card`, `StoneText`, `Eyebrow`, `Button`, `IconButton`, `Badge`, `Chip`, `HabitTile`, `TrilithonMark`, `NavRow`, `SearchField`, `AskComposer`, `SegmentedControl`, `Highlight`, `QuestionBubble`, `AnswerBubble`, `StickyNote`, `AnnotationNote`, `SlideFrame`, `Hairline`, `GrainOverlay`.

`navigationTheme(theme)` returns a plain `{ dark, colors }` object in the shape React Navigation expects. It does not import that library.

### Scaffold

This branch does not add `package.json`, an Expo app entry, or SQLite. Those belong to the scaffold work. Until that lands:

- Load Inter, Outfit, and Caveat before first paint. `fontMode="expo"` expects the family names from `@expo-google-fonts/inter`, `@expo-google-fonts/outfit`, and `@expo-google-fonts/caveat` (`Inter_400Regular`, `Outfit_800ExtraBold`, `Caveat_500Medium`, and the other weights listed in `expoFontFamilies`). Numeric `fontWeight` is left at `normal` so Android does not synthesize a second bold on top of a weight-specific family.
- `fontMode="css"` keeps `Inter` / `Outfit` / `Caveat` plus a numeric weight. That matches the reference CSS and is what iOS can do when the family is registered under those names.
- Wrap the root in `ThemeProvider`. Pass `navigationTheme(useStoneTheme())` into React Navigation only after that dependency exists.
- `GrainOverlay` does not invent a noise bitmap. Pass a texture as its child if a screen needs the sheet’s grain. Opacity and blend mode come from the theme.

### Adaptations

- The trilithon uses `accent`, so dusk inverts. The light app boards hard-code `#33302a` because those boards are overcast only.
- Note highlights use a bottom border. The reference uses `box-shadow: inset 0 -2px 0`.
- A disabled button uses inset fill and `textDisabled`. The sheet specifies the disabled text color and does not draw a disabled button.
- Dark float, sticky, and segment shadows are flat, following dusk’s `--shadow: none`.

## Checks

From the repo root, with Node 22:

```sh
npx tsx --test design-theme/check-theme.ts
npx tsx design-theme/preview.ts
```

`check-theme.ts` decodes the reference, compares both palettes and the layout measurements to the tokens, checks the font-file bytes, checks contrast, and checks that `preview.html` was generated from the same tokens. Regenerate the preview with the second command after any token edit, then re-run the test.

Chrome screenshots are `node design-theme/screenshot.mjs`. The tool is JavaScript and loads `puppeteer-core` at runtime, so the root `tsc` program does not resolve that package. Install it only to run the script (`npm install --no-save puppeteer-core` in a scratch directory, then `NODE_PATH` pointed at it). It is not an app dependency. There is no iOS simulator or Android emulator here, so the components were not launched on a device.
