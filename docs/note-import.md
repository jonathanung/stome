# Note import v1 — issue #17

## Expanded implementation scope (2026-11-07)

The user has now requested PDF and the other source exports in addition to
Markdown, and explicitly excluded handwriting recognition for now. This supersedes the earlier one-or-two-format, Markdown-first
recommendation below. It selects bounded **export routes** for implementation;
it does not claim that their parsers, assets or device paths have shipped.
The revised decision for #28 is recorded on parent #17 before #28 closes.

| Source | Selected route and reason | Fidelity and remaining validation |
| --- | --- | --- |
| Obsidian / Markdown | Keep individual UTF-8 `.md` imports and reconcile #23 against the existing parser/tests. This remains the lowest-effort text route. | Existing literal-markup behavior and vault/plugin limitations remain. Full vault/ZIP traversal is outside this expansion. |
| Generic PDF, including GoodNotes PDF exports (#24) | Extract selectable text per page and retain the original as a visual reference. One shared PDF engine avoids separate source-specific PDF implementations. | Positioned text can have incorrect reading order or omit ink. Files without usable text need a clear message or an explicit reference-only route, not fabricated extracted notes. Handwriting/OCR and GoodNotes-export fidelity are not established by this decision. |
| OneNote offline exports (#25) | Add DOCX, MHT/MHTML and HTML/HTM adapters; route PDF exports through the shared PDF engine. Offline files can be reviewed without registering an OAuth app or connecting a Microsoft account. | Preserve available typed structure and embedded resources, and warn about missing hierarchy, layout, ink or attachments. Export menus vary by client; this is not a promise that each client offers every format. Authentic notebook exports remain acceptance evidence for #25. |
| Freeform exports (#26) | Route whole-board/scene PDFs and user-provided PNG/JPEG artifacts into visual reference/background imports. | Preserve board/page/scene identity when supplied; exported pixels are not reconstructed editable shapes, connectors or strokes. Authentic board exports and crop/order checks remain acceptance evidence for #26. |

These choices follow the documented format routes in the source reports and
the new user direction. They accept visual references as a useful outcome when
faithful text or spatial reconstruction is unavailable. The earlier effort/risk
ratings remain relevant: Markdown is low effort/risk; PDF/visual attachments and
offline document packages need medium-to-high implementation and fidelity work.
Choosing them now does not retroactively turn that work or its sample tests into
completed evidence.

### Stages and completion gates

1. **Scope (#28):** record the selected routes, comparison and limitations here
   and on #17. Closed research #18/#20/#21 supplies the documented route analysis.
   #19 remains open for authentic typed/handwritten GoodNotes sample validation;
   its missing samples do not block engineering the explicitly requested generic
   PDF route. This is a revised scope/dependency decision, not a waiver of #19's
   acceptance criteria.
2. **Parser engines (#24/#25):** establish bounded binary/document inputs and a
   shared typed document result: `format`, `path`, `title`, `subjects`, ordered
   `chunks` with `body` and optional `page`/`section`, plus `warnings`. Original
   asset retention belongs to the picker/storage integration, not pure parsers.
   Test generic fixtures for parser behavior
   and distinguish them from actual GoodNotes/OneNote exports. Preserve useful
   original visuals; do not treat empty extracted text as success.
3. **Shared integration (#24/#26):** extend picking, review, durable local asset
   storage and the validate-and-commit boundary together. PDF pages and images
   must remain readable after restart; a cache URI alone is insufficient.
   Asset-only items need clear source/page labels, not fabricated recognized
   text. Bound asset sizes/counts and archive expansion, and define rollback and
   orphan cleanup when a reviewed import fails or is deleted.
4. **Review and verification:** show text beside its retained page/background,
   expose missing-content and reading-order warnings, and preserve subject/room
   overrides. Keep atomic per-source saves, source identity, repeat-import
   deduplication and conflict protection. Test the actual adapter, asset and
   persistence paths on supported platforms before advertising support there.
   A generic fixture or a successful bundle alone cannot validate an app's
   particular export settings or handwriting fidelity.

The user has explicitly deferred handwriting recognition: **no OCR is included**.
Do not claim recognition of handwritten or scanned words merely because an image
or an existing PDF text layer was preserved. No OCR/AI service is selected, no AI subscription or
credentials are needed for the selected local export routes, and no document is
uploaded as part of this scope decision. HTML/MHTML import is data conversion:
do not execute scripts or fetch remote resources implicitly.

Native `.one`, `.goodnotes` and Freeform board reconstruction are not selected.
The public `.one` specifications documented in the OneNote report do not amount
to an implemented parser. Graph OAuth/account access is also deferred until a
separate authenticated integration is explicitly built and verified. This
export-based plan makes no native-format or complete-notebook migration promise.

## Original Markdown-first decision (2026-11-07, superseded scope)

Ship individual UTF-8 Markdown files, including notes from Obsidian, first.
Select several `.md` files, preview their chunks and inferred subjects, then
confirm a destination room for each note. Folder/vault ZIP import is deferred.
The picker does not supply reliable vault-relative paths, so users supply a
collection name and may edit each source path before saving. Together these
form the stable source identity; cache URIs are never identities.

| Source | Evidence and fidelity | Effort / risk | Decision |
| --- | --- | --- | --- |
| Obsidian Markdown (#18) | Plain text, YAML properties, headings, tags, wikilinks, embeds. Original markup can be preserved without a renderer. | Low / low for individual files; medium for vaults and arbitrary YAML. | v1: Markdown files. |
| GoodNotes PDF (#19) | Editable PDFs preserve objects; searchable handwriting requires a flattened export with recognition enabled. Without a text layer we need OCR. Page layout and ink cannot be represented faithfully as text chunks. | High / high until typed and handwritten exports are tested. | Defer #24. |
| OneNote (#20) | Microsoft Graph exposes notebooks/sections/pages, needs delegated authentication (app-only auth retired). Desktop PDF export and web page-to-PDF routes exist; PDFs lose notebook hierarchy. No native `.one` parser selected. | High / medium-high for OAuth, HTML, images and ink. | Defer #25. |
| Freeform (#21) | Apple documents sending a board copy and exporting PDF. Board positions and connectors do not map cleanly to linear notes. Whiteboard mapping needs its own model. | High / high for PDF extraction or spatial preservation. | Defer #26. |

At the time of the original decision, Markdown was implemented and the
selection below was the conservative recommendation for #28. The
source-specific reports below supersede the original preliminary research
summary. OneNote and Freeform are research-only assessments of documented
routes, not claims of working importers. GoodNotes #19 still requires authentic
typed and handwritten export samples. The old #28 gate is superseded by the
expanded user-authorized plan above; #19's missing sample acceptance remains
unchanged. No device sample tests are claimed. The Markdown tests use
the explicitly synthetic `tests/fixtures/import-vault/` sample vault; they do
not establish compatibility with every Obsidian plugin.

Source research and sample evidence:

- [Obsidian feasibility (#18)](import/obsidian-feasibility.md)
- [GoodNotes feasibility (#19)](import/goodnotes-feasibility.md) and
  [sample report](import/goodnotes-sample-report.md)
- [OneNote feasibility (#20)](import/onenote-feasibility.md)
- [Freeform feasibility (#21)](import/freeform-feasibility.md)

Primary references (consulted 2026-11-07):

- [Obsidian internal links](https://help.obsidian.md/links)
- [Obsidian properties](https://help.obsidian.md/properties)
- [GoodNotes PDF export choices](https://support.goodnotes.com/hc/en-us/articles/8537070839183-Choose-Between-Editable-and-Flattened-PDF-Export)
- [OneNote Graph overview](https://learn.microsoft.com/en-us/graph/integrate-with-onenote)
- [OneNote web PDF export](https://support.microsoft.com/en-us/onenote/onenote-for-web-help-and-learning/export-notes-as-a-pdf-in-onenote-for-the-web)
- [Apple Freeform sharing/export](https://support.apple.com/en-gb/guide/iphone/iphcd5447866/ios)
- [Expo SDK 58 DocumentPicker](https://docs.expo.dev/versions/v58.0.0/sdk/document-picker/)
- [Expo SDK 58 FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/)

## Implemented Markdown pipeline and contract (#22, #23, #27)

Picker → bounded UTF-8 read → pure Markdown parser → review → `import.note`
operation → existing validate-and-commit boundary → SQLite. The parser takes
`{path, text}` and returns ordered `bodies`, inferred `subjects`, and warnings.
Other parsers can implement this same interface later; binary formats are
currently rejected by extension instead of guessed. The expanded binary/asset
contract above is planned, not present in this Markdown interface. No imported text is executed or
sent to an AI provider. #31 remains a separate, unimplemented prototype.

ATX headings outside fenced code start chunks. Long sections split at the
Foundation body limit, without splitting UTF-16 surrogate pairs. Empty chunks
are omitted; notes exceeding 200 chunks or 1 MiB of UTF-8 are rejected. Original
Markdown, YAML, wikilinks, embeds, and attachment references remain literal
text. Nothing tries to open a vault link, resolve an embed or copy a binary.
Warnings explain those limitations before saving. Frontmatter stays in the
first chunk so unrecognized or complex YAML never disappears.

Subject inference uses simple `tags`/`subjects` YAML scalars, inline lists and
block lists, inline hashtags outside code, then the parent folder (if supplied).
This is deliberately a small YAML subset, not a general YAML interpreter.
Complex YAML yields a warning. Names and subjects obey Foundation limits.
Suggestions are labeled for review and may be replaced with comma-separated
subjects. Because the picker supplies a filename, the user can add its folder
to the reviewed source path. Until subjects are manually edited, a valid path
change recomputes suggestions from the original file tags plus the current
parent folder; changing/removing the folder removes its previous automatic
suggestion. Incomplete or invalid paths do not produce a folder suggestion and
are still rejected on save. Folder names are normalized, deduplicated without
case sensitivity and omitted with a warning if subject limits are exceeded.
Because the review field uses commas to separate subjects, a folder containing
a comma is also omitted with a warning rather than being split into subjects.
Manually edited subjects, including an intentionally empty value, stay unchanged
when the path changes. Choosing another batch starts fresh suggestions.
Destination selection is explicit: use an existing room or name a
new one. No room assignment is silently inferred. No rewards are awarded and
existing room stages are unchanged (#29).
Chunk creation/update timestamps record the import time. Source-file modification
times are not used as study activity and are not preserved by this v1 model.

## Atomicity, retries and conflicts (#30)

Each confirmed note is one atomic `import.note` operation: optional room
creation, ordered chunks, subject rows, provenance and operation record either
all commit or all roll back. Multiple files are independent: a failed file does
not undo other files; each result stays visible and can be retried. User
confirmation is enforced at the boundary, including for human callers.

Provenance stores a collection/path identity, SHA-256 of the complete original
file, target room and chunk IDs. Each chunk retains a source URI and source
identity through the import record. Identical re-imports skip, even if the user
has subsequently edited/deleted chunks. Changed sources produce an explicit
conflict and never overwrite edits or add duplicate chunks. To intentionally
keep a separate copy, change the reviewed source path or collection. Re-import
after deleting the whole destination room is allowed (provenance cascades).
Renaming a source path is a new identity; cross-source overlapping text is not
globally deduplicated. A failed operation can reuse its ID; successful retries
use the write boundary's existing operation-ID idempotency.

## Validation and remaining work

Run `npm run check` for parser, migration and SQLite boundary integration tests,
typecheck, lint and write isolation checks. These tests use Node SQLite and do
not exercise Expo's native SQLite driver or a system file picker. Before release,
manually check iOS/Android/web: picker cancellation, UTF-8 multi-file selection,
large/rejected files, review overrides, duplicates, changed-source conflicts,
restart persistence and room deletion. Web SQLite may need the Expo documented
COOP/COEP hosting headers. Real export fixtures and vault/ZIP import remain open.

Validation on this branch (2026-11-07):

- `npm run check`: typecheck, lint, schema checks, all 36 application tests,
  all 15 harness tests and write isolation passed after integrating current main.
- `npx expo export --platform web`: passed, including SQLite WASM/worker assets.
- `npx expo export --platform android --platform ios --output-dir dist/native`:
  both Hermes bundles passed.
- Headless Chrome at 390 × 844 with COOP/COEP headers: system file input selected
  the synthetic Markdown fixture; all four chunks previewed; a reviewed room
  name saved; notes persisted across reload; identical import skipped; changed
  source showed a conflict. No uncaught browser errors. This exercises the Expo
  web SQLite driver, not the native driver. Native device testing remains open.
- Local Node was 26.7.0; CI pins the repository's declared Node 22.23.4. Node 22
  validation was not performed locally.

The feature branch was built in a separate worktree and integrated with current
main before opening its PR. The Router home preserves main's notes/harness
screen; `/import` exposes `NoteImportScreen`. The importer core does not depend
on the in-progress capture UI's store. Main's shipped v1/v2 SQL migrations are
unchanged: v3 adds revisions, anchors, normalized subjects and operation records;
v4 adds import provenance. Existing `content` and `subject_tags` columns are kept.
Legacy notes remain usable by the harness; existing notes are also snapshotted
once into the room workspace during upgrade. Subsequent legacy note edits and
room chunk edits are independent. Tests cover upgrading an existing v2 database
with rooms, tags, annotations and notes. The write guard explicitly allows the
pre-existing notes adapter and the separate harness database's existing owners.
