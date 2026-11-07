# Obsidian Markdown feasibility — IMPORT.1 (#18)

Researched 2026-11-07. Research only; this document evaluates the importer
already merged in [PR #59](https://github.com/jonathanung/stome/pull/59).

## Recommendation for IMPORT.11 (#28)

The expanded user request also selects PDF, OneNote offline exports and Freeform
visual references; see the [current plan](../note-import.md#expanded-implementation-scope-2026-11-07).
Markdown keeps the same bounded behavior and evidence below. Its original
recommendation to exclude the other source routes is superseded; full vault/ZIP
and plugin compatibility remain outside the selected Markdown route.

Choose individual UTF-8 `.md` files for v1. Text can be retained without an
Obsidian runtime or network account. Limit the claim to a reviewed text import:
this is not full vault migration, attachment copying, link resolution, or
Obsidian plugin compatibility. Keep ZIP/directory traversal and rich rendering
outside this release. Effort/risk is **low/low** for this bounded route,
**medium/medium** for directory/ZIP import, and **high/high** for reproducing a
vault's rendered/plugin behavior. These are engineering estimates, not measured
delivery promises.

## Format and edge cases

A vault is an ordinary local folder containing Markdown notes and subfolders;
Obsidian's root `.obsidian` directory holds vault preferences/plugins rather than
study notes. Attachments are ordinary files, with configurable storage at the
root or beside/under notes. A future folder importer should retain those relative
paths and skip configuration/plugin content instead of executing it.
[Vault storage](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data),
[attachments](https://help.obsidian.md/attachments).

| Feature | Source format | v1 behavior and consequence |
| --- | --- | --- |
| Notes and folders | The reviewed parser accepts a relative `.md` path and UTF-8 text. | The picker supplies filenames, not a dependable vault-root hierarchy. Users supply a collection and may edit the source path. Two `Cells.md` files in different folders need distinct reviewed paths. |
| Headings | Markdown ATX headings (`#` through `######`). | Headings outside fenced code start chunks. Setext headings, callouts, tables, math and other syntax remain literal text; they are not semantic structure extraction. |
| Properties/frontmatter | Obsidian stores properties as YAML at the start of the file; its documented property system includes text, lists, numbers, booleans, dates and tags. | Preserve the entire frontmatter in the first chunk. Infer subjects only from simple `tags`/`subjects` scalars, comma lists or block lists. Do not claim general YAML parsing. Complex values, quoted commas, aliases, inline comments and malformed/unclosed blocks need user review. [Properties](https://help.obsidian.md/properties) |
| Wikilinks | `[[note]]`, `[[folder/note]]`, aliases after `|`, heading anchors after `#`, and block references after `#^`. Standard Markdown links may also be used. | Preserve the markup and show a warning. Do not resolve targets, expand aliases, rewrite links or fetch referenced notes. A preserved link string is not a working navigation link in stome. [Internal links](https://help.obsidian.md/links) |
| Embeds and attachments | `![[...]]` embeds another file or part of a note; attachments may be images, PDFs or other media. | Keep the reference and warn that linked notes/binaries are not copied. Recursive embeds cannot recurse because they are never expanded. Markdown image references also remain text. [Embed files](https://help.obsidian.md/embeds) |
| Tags | Obsidian supports inline tags and nested paths such as `#science/biology`, as well as the `tags` property. | The current importer suggests Unicode letters/numbers plus `_`, `/` and `-` outside fenced/inline code. It is a useful subset, not a complete Obsidian tag lexer. Suggestions are editable before saving. [Tags](https://help.obsidian.md/tags) |

The path validator rejects absolute paths, drive prefixes, empty path segments,
`..`, control characters and non-`.md` extensions. It normalizes separators;
source identity also includes a user-chosen collection. Limits are 1 MiB per
note, 200 chunks, 50,000 UTF-16 code units per chunk, 12 subjects and 40 characters
per subject. Long sections split without cutting a surrogate pair. These are
current stome constraints, verified against `src/import/markdown.ts` and
`src/data/operations.ts`, not Obsidian format limits.

## Samples and evidence

The sample vault tested is **synthetic**, maintained in this repository at
`tests/fixtures/import-vault/Biology/Cells.md`. It was not exported by the
Obsidian app. It contains frontmatter tags and a block-list subject, a folder,
three headings, an aliased wikilink, an image embed, an inline hashtag and a
fenced Markdown heading. The existing test asserts four chunks; expected
subjects are `biology`, `revision`, `cells`, `science`; it verifies preserved
frontmatter/embed/code and an attachment warning.

`tests/import-markdown.test.ts` additionally covers CRLF/BOM normalization,
Unicode, different fence delimiters, inline code, large sections, byte/chunk
limits, unsafe paths, invalid/empty text, complex/unclosed YAML and stable
collection/path identities. `npm run check` was run for this research branch;
the PR records its result. There are no real user vaults or plugin-generated
fixtures in this evidence set. The tests establish the narrow Markdown route,
not fidelity for every valid Obsidian vault.

## Before extending the route

A later vault importer should test a permitted real vault with duplicate
basenames, relative/encoded Markdown URLs, nested folders, missing attachments,
heading/block anchors, unknown properties and circular embeds. Define ZIP
expansion/count limits and preserve original paths before enabling archives.
Neither the present feasibility conclusion nor closing #18 should be read as
shipping those extensions.
