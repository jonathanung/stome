---
name: ui-component
description: Use when adding, changing, or reviewing anything visual in the daily app — a component in app/src/ui/, a screen in app/src/app/, a design token, colour, spacing, radius, typography, or theme behaviour. Also use when asked to "make it look like X", fix a dark mode issue, or adjust layout.
---

# Working in the daily design system

Read `docs/UI.md` for the full reference. This is the working procedure.

## Before writing anything

**Try composition first.** `Card` + `Stack` + `Text` covers most of what looks
like it needs a new primitive. A new component is justified when the same
composition appears three times, or when it carries behaviour (state, gesture,
accessibility wiring) that composition cannot.

**Check `/design` first** (`app/src/app/design.tsx`). The thing may already
exist.

## The design direction

Three decisions everything else follows from. Do not quietly break them.

1. **The accent is inversion, not a hue.** Emphasis means flipping ink and
   paper — a primary button is a solid block of ink on paper, or paper on ink
   in dark. One primary action per screen; everything else steps down.
2. **The DayTile is the signature.** One rounded square means one day, at every
   scale, including the dot on the "i" in the wordmark. Radius is proportional
   (2pt per 8pt of size).
3. **Colour is reserved for status.** The three status hues are desaturated —
   sage, clay, ochre, not emerald, red, amber. Colour never decorates.

## Rules

- **Semantic tokens only.** No hex codes, no magic numbers. If a value does not
  exist, add it to `tokens/primitives.ts` first, then alias it in
  `tokens/semantic.ts` for **both** themes.
- **Adding a colour means both maps.** `SemanticColors` makes omission a
  compile error. Do not cast around it.
- **No component imports a repository, the HTTP client, or navigation state.**
- **Spacing props are strings:** `p="4"`, `gap="3"`. `t.space[4]` still works
  inside stylesheets.

## Which styling API

**Utility props** for layout and one-off spacing:

```tsx
<Stack direction="row" gap="3" align="center" p="5" bg="surface" radius="card">
```

**`createStyles`** for structure, variants, or more than about four properties:

```tsx
const useStyles = createStyles((t) => ({
  header: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.card,
    paddingHorizontal: t.space[5],
  },
}));
```

Both read the same tokens. Neither is a fallback for the other.

## Quality floor — not optional

- **44pt touch targets.** Smaller visuals recover the difference with
  `hitSlop`, the way `Button size="sm"` does.
- **Reduced motion.** Gate every animation on `useReduceMotion()`.
- **Safe areas.** Use `Screen`; do not hand-roll insets.
- **Semantics.** Role, label, and state on every interactive element. Aggregate
  large collections into one label rather than exposing every child.
- **Both themes.**

## Procedure for a new component

1. One file in `app/src/ui/components/`, named export.
2. Variant maps, not boolean prop soup.
3. Export from `components/index.ts`.
4. **Add it to `app/src/app/design.tsx`, in every variant.** Not on that screen
   means not finished.
5. Verify:
   ```sh
   npm run app:lint && npm run app:typecheck
   ```
6. For anything non-trivial, confirm it bundles:
   ```sh
   cd app && npx expo export --platform ios --output-dir /tmp/expo-export
   ```

## What you cannot verify

You cannot confirm visual correctness from a terminal. When a change affects
appearance, say so plainly and ask the user to look at `/design` in both
themes. Do not claim it looks right.

Contrast is currently unverified across the ramp (tracked as an open issue) —
`text.tertiary` is the same value in both themes and is the likeliest failure.
If you are changing text colours, flag it.
