# iPad Freeform feasibility — IMPORT.4 (#21)

Researched 2026-11-07. Research only. No Apple Account was accessed and no board
was exported or parsed on a device.

## Expanded-scope decision (2026-11-07)

The user now selects the lower-fidelity-risk route described by this research:
whole-board/scene PDFs and user-provided PNG/JPEG artifacts as retained visual
references/backgrounds for #26. See the
[expanded plan](../note-import.md#expanded-implementation-scope-2026-11-07).
This supersedes the original deferral below; it does not establish an editable
Freeform board importer or a new Apple native-format contract. Generic PDF/image
engineering may proceed while actual board samples, scene order, crop bounds
and preserved image quality remain explicit #26 acceptance work. Handwriting
recognition/OCR is excluded for now; visible handwriting is not recognized text. Apple Account access and
temporary board-copy links are not required for the selected local artifacts.

## Original recommendation for IMPORT.11 (#28, superseded scope)

Defer the Freeform parser (#26) from v1. **Visual reference import is feasible;
faithful structured-note or editable-whiteboard import is not established.**
If revisited, prefer one exported PDF scene/page as an immutable whiteboard
background, retaining board/scene/page references. That route preserves a
visual aid without claiming it reconstructed objects. It still needs a PDF
viewer, a persisted attachment/background model and sample exports; none is
part of the current text-chunk importer. The whiteboard spike in
`docs/whiteboard-feasibility.md` is relevant follow-up context.

## Export/share routes and fidelity

Apple's [iPad sharing/export guide](https://support.apple.com/guide/ipad/send-a-copy-or-pdf-ipadfde4a50f/ipados)
documents the following routes:

| Route | What the recipient gets | Consequence for stome |
| --- | --- | --- |
| PDF: entire board | The board exported as a single PDF page. | A bounded visual snapshot of a spatial canvas. It is not a typed list of objects or connections. |
| PDF: scenes | One scene per PDF page. | A useful user-chosen order and grouping. It could provide page provenance for a later importer. |
| PNG | Apple suggests a screenshot, or copying selected items and pasting them into another app as PNG. | A raster image, not a documented full-board structured image export API. Text extraction would need OCR and review. |
| Send a Copy | An iCloud link to a separate board copy; sender must be online and signed into iCloud. The copy link can be downloaded within 30 days. | A Freeform-to-Freeform sharing route. It is not a stable local source identity or evidence of a documented third-party board parser. |
| Share sheet | Choose an app/contact or Save to Files for the exported artifact. | Transports the chosen PDF/image/link; it does not convert board objects to stome's schema. |

Apple's [scenes guide](https://support.apple.com/en-ie/guide/ipad/ipad9c7aadac/ipados)
describes saved board views that users can label/reorder and export together or
individually. Exported scenes use device sizing by default, with an option for
the original capturing-device framing. A later sample protocol should record
those settings so cropping and overlapping views are not mistaken for missing
content or duplicate notes. These guides do not guarantee a selectable PDF text
layer, correct OCR, attachment embedding, editable connectors or recoverable
stroke geometry. Those remain untested properties.

## Notes versus whiteboard mapping

The following are design inferences from the export routes and current stome
models, not claims measured on a sample board:

- A linear note importer must invent reading order for separate spatial groups.
  It can lose meaning when arrows, relative positions or drawn equations carry
  the relationship. Page-local extracted text alone should not silently become
  authoritative study content.
- An immutable PDF/image background is the lower-fidelity-risk whiteboard
  option: show the artifact and allow new stome strokes on top. Existing board
  items would remain part of the background, not editable stome shapes.
- Recovering editable text boxes, sticky notes, ink and connectors needs a
  documented interchange contract or a proven parser for actual artifacts.
  This research found no such contract in the cited Apple user guides. It does
  not assert that a native format is impossible or nonexistent.
- A shared or copy link should be stored only as optional provenance. Its
  access/lifetime can change; the downloaded artifact would need a local stable
  identity for deduplication.

## Effort/risk and next evidence

| Candidate | Estimated effort | Fidelity/implementation risk |
| --- | --- | --- |
| Scene PDF/image as whiteboard background | Medium-high | Medium after a viewer/attachment model exists; page dimensions, zoom and rendering still need tests. |
| PDF/image to note text | High | High: missing text layers, OCR, cropping and spatial reading order. |
| Native editable board reconstruction | Very high/unknown | High: no validated public interchange/parser route or sample contract. |

Ratings are engineering estimates. #21 requests format/fidelity/mapping research;
it does not require building a parser. #26 additionally requires tested sample
boards and is not satisfied by this document.

Before declaring the expanded visual-reference lane complete, export a permitted board containing typed
text, handwriting, shapes, connectors, an image and a file attachment as a
whole-board PDF, scene PDF and PNG. Record iPadOS/Freeform versions and framing
options; inspect text layers, image quality, page sizes, clipping and attachment
behavior. Test both a text-heavy board and a spatial diagram. The new scope has
chosen visual-reference/background preservation; do not infer authoritative
linear notes or editable board objects from that choice. Existing research is
evidence for the route, not proof that those acceptance tests have passed.
