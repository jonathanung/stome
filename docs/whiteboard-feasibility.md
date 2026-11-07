# Whiteboard feasibility note (#14 / #45)

Status: research spike only. This note does not select a production implementation or change the app schema.

## Recommendation

Start a small, shared web/iOS/Android proof of concept with **`react-native-svg`**. It supports all three targets in Expo SDK 58, is included in Expo Go, and gives each rectangle, line, path, and text label a separate renderable element. Build the pencil as a polyline or SVG path, arrows as a line plus arrowhead, and use a React Native `TextInput` over the selected label while editing. A gesture layer must translate pointer positions to board coordinates and handle selection, panning, and drawing. The existing app has neither a board route nor any canvas dependency, so this is a choice for a later spike implementation, not a claim of tested behavior in Stome.

| Option | Text, shapes, arrows, pencil | Web and mobile considerations | Main tradeoff |
| --- | --- | --- | --- |
| [`react-native-svg`](https://docs.expo.dev/versions/v58.0.0/sdk/svg/) | SVG `Text`, `Rect`, `Line`/`Polygon`, `Path` map directly to the tools. Use a `TextInput` overlay for editing. | Expo SDK 58 lists web, iOS, Android and Expo Go; its upstream project documents a web compatibility layer. | Many separate SVG elements and path updates may become costly on large boards; measure before committing to this renderer. |
| [`@shopify/react-native-skia`](https://docs.expo.dev/versions/v58.0.0/sdk/skia/) | Skia canvas can draw paths, shapes, and text; a separate `TextInput` is still needed for editing. | Expo SDK 58 lists web, iOS, Android and Expo Go, but [web setup](https://docs.expo.dev/versions/v58.0.0/sdk/skia/) must load CanvasKit. The [upstream v2 web guide](https://wcandillon.github.io/react-native-skia/v2/docs/getting-started/web/) describes its WASM asset and asynchronous loading. | Better candidate if dense freehand drawings overwhelm SVG, with more web setup and manual object hit testing. |

For either renderer, keep the board's object model independent of rendering. The app can change renderer later without rewriting saved strokes. Test mouse, touch, and stylus input; text entry; zoom/pan; and redraw of a board with hundreds of strokes before making the final choice. Expo's [gesture-handler SDK 58 page](https://docs.expo.dev/versions/v58.0.0/sdk/gesture-handler/) lists web and native support; verify the installed compatible version during an actual prototype, since this spike did not add it.

## Proposed persisted stroke

Represent one completed pencil stroke as one FND.1 `annotation` whose `type` is `stroke` and whose `chunk_id` references the owning chunk. Store this JSON as its content/payload **if FND.1 supplies a payload field**. Coordinates are in an unscaled board space, not screen pixels, so zoom and viewport size do not change saved geometry.

```json
{
  "v": 1,
  "kind": "pencil",
  "boardWidth": 1000,
  "boardHeight": 700,
  "points": [[120, 80], [123, 82], [128, 87]],
  "color": "#30343A",
  "width": 3
}
```

Validation should reject unsupported `v`/`kind`, nonfinite or out-of-bounds coordinates, empty or excessively long point lists, invalid colors, and nonpositive or unreasonable widths. The UI may simplify sampled points before saving. Keep stroke IDs, timestamps, and revision in the annotation row/operation contract rather than duplicate them in the JSON. If FND.1 has no content/payload column, add one through a later migration; do not put JSON into an unrelated field.

Persist create/update/delete via the FND.2 typed operation with an operation ID, expected revision, `source: human`, and the target chunk ID. FND.2 validates the chunk reference and payload, and commits atomically. AI-suggested edits remain uncommitted until explicit user confirmation, as required by #14 and FND.2. Undo should use another operation, not a direct SQL write.

## Schema decisions before production work

- FND.1 is still open; the checked-in database currently has only a `notes` table. Confirm the annotation payload shape when FND.1 lands.
- FND.1 defines **text chunks**, not board identity or persistent text/shape/arrow objects. A stroke annotation can attach to a chunk, but a free-standing board and its other object types require an explicit later schema decision. Do not overload the `stroke` type with every board object.
- Decide whether a board is owned by one chunk or needs a separate board record. This affects deletion, board-to-notes conversion, and which chunk receives AI context.

## Sources checked

- [Expo SDK 58 reference](https://docs.expo.dev/versions/v58.0.0/), [documentation index](https://docs.expo.dev/llms.txt), [SVG](https://docs.expo.dev/versions/v58.0.0/sdk/svg/), [Skia](https://docs.expo.dev/versions/v58.0.0/sdk/skia/), and [Gesture Handler](https://docs.expo.dev/versions/v58.0.0/sdk/gesture-handler/).
- [React Native SVG upstream usage](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md) and [Skia v2 web support](https://wcandillon.github.io/react-native-skia/v2/docs/getting-started/web/).
- [FND.1 #35](https://github.com/jonathanung/stome/issues/35) and [FND.2 #36](https://github.com/jonathanung/stome/issues/36).
