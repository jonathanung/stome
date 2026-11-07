# Note import v1 — issue #17

## Scope decision (2026-11-07)

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

Markdown is implemented; its selection here remains the conservative
recommendation for #28, not completion of that issue's research gates. The
source-specific reports below supersede the original preliminary research
summary. OneNote and Freeform are research-only assessments of documented
routes, not claims of working importers. GoodNotes #19 still requires authentic
typed and handwritten export samples; neither #19 nor #28 can close on the
current evidence. No device sample tests are claimed. The Markdown tests use
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

## Pipeline and contract (#22, #23, #27)

Picker → bounded UTF-8 read → pure Markdown parser → review → `import.note`
operation → existing validate-and-commit boundary → SQLite. The parser takes
`{path, text}` and returns ordered `bodies`, inferred `subjects`, and warnings.
Other parsers can implement this same interface later; binary formats are
rejected by extension instead of guessed. No imported text is executed. The
parser never sends text to an AI provider. Only when a paired person presses
**Suggest rooms** on the room-mapping step does the app send each note's title
and an excerpt of at most 500 characters to the companion
(`import.suggestRooms`). In live mode the companion forwards that to Anthropic.
Suggestions change nothing until the person applies them, and the import
confirm stays the only writer. The full LLM-orchestrated import (#31) is still
a separate, unimplemented prototype.

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
