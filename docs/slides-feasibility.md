# Slide workspace feasibility — #13 / #44

Checked against Expo SDK 58 on 2026-11-07. This is a feasibility note for the deferred spike, not a viewer implementation. The repository currently has only a `notes` table; Room, Chunk, and Annotation are planned in #35, and the shared write boundary is planned in #36.

## Recommendation

Start with **PDF import and page-by-page viewing on Expo web** using [React-PDF](https://github.com/wojtekmaj/react-pdf) (a React wrapper around Mozilla PDF.js). Render only the active page and an adjacent page if preloading proves useful. Place the Stome highlight/question layer over the page rather than writing marks into the PDF. React-PDF exposes `Document` and `Page`, including page count and text/annotation layers; its current browser and React requirements appear compatible with this repo's React 19 web target, but the worker setup and Metro web bundling still need a running proof of concept. Its current documentation requires Node 22.13 or newer; this worktree's `npm run lint` warns that the installed Node 22.11 is too old, so update the development runtime before trying the latest React-PDF. [PDF.js documents page rendering and viewport scaling](https://mozilla.github.io/pdf.js/examples/).

Treat PowerPoint (`.ppt`/`.pptx`) as a **conversion input**, not as a format the viewer opens directly. PDF.js is a PDF renderer. [LibreOffice Impress can open PowerPoint files](https://help.libreoffice.org/latest/en-US/text/shared/guide/ms_user.html), and [LibreOffice documents PDF export from the command line](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html). For the local-only product, the first workflow should ask the user to export a PDF before importing. An automated conversion service or bundled converter would be a separate product and deployment decision; conversion may also change fonts, layout, animations, or speaker notes, so test representative decks before promising fidelity.

## Options compared

| Option | Expo web | iOS/Android path | Main tradeoff |
| --- | --- | --- | --- |
| React-PDF / PDF.js in the web view | Direct page rendering, page count, optional text layer; supports a precisely sized overlay. [React-PDF docs](https://github.com/wojtekmaj/react-pdf) | React-PDF is a browser library; native would need a separate renderer, perhaps PDF.js inside a native WebView. [Expo SDK 58 WebView](https://docs.expo.dev/versions/v58.0.0/sdk/webview/) lists Android/iOS, not web. | Best web fit, but worker/bundler and touch overlay behavior require validation. |
| Convert each slide to an image, then display with `expo-image` | Straightforward page-by-page display and normalized overlay. | [Expo SDK 58 Image](https://docs.expo.dev/versions/v58.0.0/sdk/image/) supports Android, iOS, and web with caching. | Cross-platform display is simple, but conversion must happen elsewhere; no selectable/searchable text, more storage, and zoom quality depends on render resolution. |
| Browser's embedded PDF viewer | Potentially quick viewing in an iframe/object element. | No common embedded viewer across the native targets. | Viewer controls and page geometry are browser-owned, making reliable per-slide Stome highlights hard; do not use for annotation. |

The option assessments are architectural inferences from the linked capabilities. No PDF, PowerPoint, or annotation proof of concept was run in this spike.

## Import and anchor sketch

Use [Expo SDK 58 DocumentPicker](https://docs.expo.dev/versions/v58.0.0/sdk/document-picker/) for a user-initiated PDF selection. Its web result includes a browser `File`; on native, `copyToCacheDirectory: true` permits immediate FileSystem access. The picker needs a user gesture on web. Keep the source PDF in app-controlled storage for offline viewing; the exact web persistence mechanism needs a later spike.

When the Room/Chunk schema exists, create one stable chunk per page (ordered within the room), and retain an association between source document identity, page number, and chunk ID. A source-file hash plus page index can identify the imported page; a new import of an edited deck must be treated as a new revision rather than silently moving annotations. Attach each highlight/question annotation to that page's chunk. Store a highlight as normalized page coordinates (`x`, `y`, `width`, `height` in `[0,1]`, measured against the unrotated page) plus optional selected text/quote. The geometry stays aligned when the viewer resizes; text is useful as context for later AI questions. Rotation and crop changes need explicit coordinate transforms and tests. This is a proposed shape, not a change to #35's schema: #35 must define where annotation payloads and document/page identity live, and #36 must validate and commit these writes.

## Follow-on validation before production

1. Make a small Expo web proof of concept with a picked multi-page PDF, React-PDF worker configuration, one-page rendering, page navigation, and offline reload. Measure load and page-switch behavior on a low-end laptop and a phone browser.
2. Verify highlight overlay alignment at different viewport sizes, zoom levels, and rotated/cropped pages; test a text-heavy PDF and a scanned PDF.
3. Compare converted PowerPoint files with their originals, including fonts and unusual layouts. Decide whether user-exported PDF is sufficient before offering `.pptx` selection.
4. If native viewing becomes scheduled, compare PDF.js in `react-native-webview` with pre-rendered page images using the same annotation contract. Native is optional in the current foundation epic.

## Sources

- [Expo SDK 58 index](https://docs.expo.dev/versions/v58.0.0/) and [Expo documentation index/corrections](https://docs.expo.dev/llms.txt)
- [Expo SDK 58 DocumentPicker](https://docs.expo.dev/versions/v58.0.0/sdk/document-picker/), [Image](https://docs.expo.dev/versions/v58.0.0/sdk/image/), and [WebView](https://docs.expo.dev/versions/v58.0.0/sdk/webview/)
- [React-PDF project documentation](https://github.com/wojtekmaj/react-pdf) and [PDF.js examples](https://mozilla.github.io/pdf.js/examples/)
- [LibreOffice Office file support](https://help.libreoffice.org/latest/en-US/text/shared/guide/ms_user.html) and [command-line export](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)
