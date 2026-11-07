# Import acceptance audit: #22, #23, #27 and #28

Audited 2026-11-07 against merged PR [#59](https://github.com/jonathanung/stome/pull/59),
main commit `bfd4678e1ca951a2e4a2cc881fb8541514852a19`. This is an evidence audit,
not a change to the issues' acceptance criteria or an authorization to start a
gated parser. Source line references below describe that commit.

## #22: shared pipeline architecture

**Recommendation: close #22 when this audit is merged.** Its three architecture
criteria are satisfied by the existing design, typed contracts and tests.
The issue depends on the Foundation **note chunk model**, not completion of
every navigation/theme task in epic #9. The model is already present in
[`src/data/models.ts`](../../src/data/models.ts#L20), backed by the schema and
write-boundary work tracked by closed #35 and #36. Epic #9 remaining open is
not a reason to design a second model or a second pipeline.

| Exact acceptance item | Evidence | Assessment |
| --- | --- | --- |
| Pipeline stages and parser interface documented | [Existing pipeline design](../note-import.md#pipeline-and-contract-22-23-27); [`ImportInput` and `ParsedNote`](../../src/import/markdown.ts#L5); [picker adapter](../../src/import/pick-notes.ts#L13); [review/save](../../src/features/import/note-import-screen.tsx#L68). | Met for the selected Markdown source. Binary parsers are future implementations, not claimed support. |
| Chunk/metadata mapping aligned with Foundation's note chunk model | [`Chunk`](../../src/data/models.ts#L20); [`import.note` payload](../../src/data/operations.ts#L15); [commit implementation](../../src/data/commit.ts#L226); [import provenance migration](../../src/db/schema.ts#L121). | Met. The mapping is made explicit below. |
| Error/partial-import handling defined | [Existing atomicity design](../note-import.md#atomicity-retries-and-conflicts-30); [per-file picker errors](../../src/import/pick-notes.ts#L16); [transaction boundary](../../src/data/commit.ts#L380); [rollback test](../../tests/import-commit.test.ts#L74). | Met. A file is atomic; a batch can contain individually successful, rejected or unconfirmed files. |

The stages and ownership are:

1. The file picker selects up to 20 files and reads at most 1 MiB per accepted
   `.md` file. Cancellation returns no new batch. A bad file produces a named
   error and does not stop the other files.
2. The pure format parser accepts `{ path: string, text: string }`. It returns
   `{ path, title, bodies: string[], subjects: string[], warnings: string[] }`.
   Its input and output have no platform/database dependency. `bodies` are
   ordered; empty bodies are omitted; per-body and per-note limits are enforced.
3. The picker adapter adds a SHA-256 fingerprint of the complete original text.
   The user reviews source collection/path, suggested subjects, chunks and a
   destination room before confirming each file.
4. The UI submits a confirmed `import.note` operation. Validation and saving
   occur through the shared commit boundary, not a parser-owned SQL connection.
5. One transaction saves the optional new room, chunks, subjects, provenance
   and operation record. On failure all writes for that file roll back.

| Parser/review value | Foundation storage/model |
| --- | --- |
| `bodies[i]` | `Chunk.body`, persisted in the existing `chunks.content` column. |
| Body order and selected room | New chunk positions append densely in that room; generated IDs identify the chunks. |
| Reviewed `subjects` | `Chunk.subjects`; both normalized subject rows and existing `subject_tags` are written. |
| Collection plus reviewed relative path | Stable source identity, stored as `Chunk.sourceLink`/`chunks.source_link` and the import provenance key. A temporary picker URI is not an identity. |
| Original-file SHA-256 | Import-source fingerprint, used to distinguish an identical retry from a changed source. |
| Import commit time | Foundation `createdAt`/`updatedAt`; provenance `imported_at`. Original source modification times are not retained by v1. |
| New/existing destination | `Chunk.roomId`; new rooms start at `stonehenge`. Imports do not award study rewards. |

Identical sources skip without modifying local notes, including locally edited
or deleted chunks. Changed sources produce a visible conflict; they do not
overwrite or append duplicate chunks. The user can intentionally choose a new
source identity to retain a separate copy. Source identity is scoped to a
collection/path, so global deduplication of overlapping content is not claimed.
The relevant integration tests are [atomic saving](../../tests/import-commit.test.ts#L23),
[retry/conflict behavior](../../tests/import-commit.test.ts#L37),
[boundary validation](../../tests/import-commit.test.ts#L60) and
[existing-room/deletion behavior](../../tests/import-commit.test.ts#L85).

## #23: Obsidian parser audit, still gated

Do not close #23 solely because PR #59 merged. Its explicit gates are #18,
#22 and #28; reconcile those first. The existing implementation has the
following evidence:

| Exact acceptance item | Evidence and limit |
| --- | --- |
| Parses headings, frontmatter, tags and wikilinks into chunks and metadata | [Parser](../../src/import/markdown.ts#L36) chunks at ATX headings outside code, reads a small frontmatter `tags`/`subjects` subset and inline hashtags, and preserves all frontmatter/wikilink text in chunk bodies. Subject strings become structured metadata. It does **not** return separate heading records, arbitrary YAML properties, or a structured wikilink target graph. The documented v1 design intentionally retains those references as text. |
| Handles attachments/embeds gracefully (skip or reference) | [Warnings](../../src/import/markdown.ts#L100) explain that links/embeds remain literal references and that attachments are not copied or resolved. |
| Tested against sample vaults | [Synthetic fixture test](../../tests/import-markdown.test.ts#L7) uses `tests/fixtures/import-vault/Biology/Cells.md`; separate cases cover fences, Unicode, size/path limits, malformed YAML and identity. These are synthetic test inputs, not evidence from an arbitrary real-user vault or third-party Obsidian plugins. |

Preserving a wikilink as a literal chunk reference is an implemented behavior;
it is not a structured link-resolution feature. The issue does not explicitly
require a separate link graph, so that would be a scope clarification rather
than an automatic new requirement. The closure comment should state the v1
interpretation and sample coverage plainly instead of claiming all Obsidian
metadata has been converted. Any broader YAML, link-resolution or vault-archive
work should remain separately scoped.

## #27: subject and structure inference audit, depends on #22

Do not start additional #27 implementation until #22 closes. Much of the
acceptance is already implemented, with one concrete mismatch between the
documented inference rule and the normal picker workflow:

| Exact acceptance item | Evidence and assessment |
| --- | --- |
| Inference rules documented per supported source | [Rules](../note-import.md#pipeline-and-contract-22-23-27) describe tags/subjects, hashtags and a supplied parent folder. Markdown is the only supported source. Headings determine chunk structure; notebook/API-based inference is not claimed. |
| User confirmation/override step before saving | [Review fields and confirmation](../../src/features/import/note-import-screen.tsx#L109) expose subjects, source path and destination; [boundary enforcement](../../src/data/commit.ts#L372) rejects unconfirmed imports. |
| Low-confidence results flagged rather than guessed silently | Every note is labeled "suggested subjects need review"; [parser warnings](../../src/import/markdown.ts#L47) flag complex/unclosed YAML, absent subjects and omitted over-limit suggestions. This is conservative review of **all** suggestions; there is no numeric confidence score or per-suggestion provenance. Such fields are enhancements, not stated acceptance requirements. |

The parser appends the parent folder to subject candidates when its input path
contains one ([line 118](../../src/import/markdown.ts#L118)). The platform adapter
always calls it with `asset.name` ([line 33](../../src/import/pick-notes.ts#L33)),
not a vault-relative path. Editing the source path later only updates the
draft's `path` ([line 112](../../src/features/import/note-import-screen.tsx#L112));
it does not rerun inference or update its subjects. Consequently, a user who
supplies `Biology/Cells.md` during review does not receive the documented
`Biology` folder suggestion in this workflow.

The smallest follow-up is to make that supplied-folder rule available during
review while preserving any manual subject override, or explicitly narrow the
documented user-facing rule to tags/hashtags and treat paths as identity only.
It should include a regression scenario that edits a reviewed path after file
selection and verifies both the resulting suggestion and preservation of user
subject edits. A general YAML parser or an LLM is not necessary for this gap.

### #27 follow-up (2026-11-07)

The historical picker-workflow gap above is addressed by
[`review-draft.ts`](../../src/import/review-draft.ts). The original file-derived
subjects form a fixed baseline. Changing the reviewed source path adds its
current parent folder, replaces an older folder suggestion, or removes that
suggestion when the path is a filename, blank or temporarily invalid. Invalid
paths still fail the existing source-identity validation when saving.

An explicit subject edit, including clearing the field, prevents subsequent
path changes from replacing that value. Suggestions use Foundation length/count
limits and case-insensitive deduplication; an omitted folder gets a visible
warning rather than silently disappearing. The existing no-subject warning now
specifies that it describes the file, so it remains accurate if a folder is
supplied later. The screen continues to label every suggestion for review and
requires confirmation before saving. No numeric confidence score or new
provenance schema is introduced.
Folders containing commas are omitted with a specific warning because the
review field is comma-separated; one folder cannot silently become multiple
saved subjects or exceed the subject count after serialization.

[`import-review.test.ts`](../../tests/import-review.test.ts) covers supplying,
changing and removing folders, backslash/whitespace normalization, incomplete
and invalid paths, duplicate subjects, subject limits, warning transitions and
preservation of manual overrides and unrelated draft state. This follow-up
does not resolve #23/#28's research gates or add a binary importer.

## #28 and parser readiness

#28 requires the feasibility outcomes from #18–21 and a decision recorded on
the parent epic. The merged document currently records a **conservative
Markdown recommendation** while explicitly saying research is incomplete;
that does not establish that the prerequisite issues have been completed.
In particular, #19 requires typed and handwritten GoodNotes export samples.
Only actual sample examination can check that acceptance item. A missing
sample should remain a named blocker, not be converted into a successful test.

After the research issues close, record the comparison and final selection on
#17, then close #28. #23 can be reconciled against its evidence only after that
and #22. #24–26 are deferred parsers under the Markdown-only v1 recommendation;
deferral does not mean their parser acceptance criteria have been implemented.

## Verification

This documentation-only change adds no production API, schema, dependency or
UI behavior. Verification uses the existing `npm run check` gate; its Node
SQLite tests do not exercise the Expo native driver or a device file picker.
The audit does not claim new visual, native-device, real-vault or binary-export
testing. Exact local results are recorded in the PR after the command finishes.
