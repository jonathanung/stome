# PDF and DOCX parser runtime fixes

The selectable-text PDF and DOCX import paths use the same bounded pure-JavaScript
DEFLATE adapter in `src/import/inflate.ts`. It imports the explicit
`fflate/browser` entry, which avoids the package's Node worker entry. It does not
need `DecompressionStream`, `Blob`, a browser worker, an external service or a
new native module. The installed dependency is `fflate` 0.8.3, MIT licensed.
The package was installed through `npx expo install fflate` for this Expo SDK 58
project. [Library/API documentation](https://github.com/101arrowz/fflate).

This fixes a real platform gap: the former PDF and DOCX readers used browser
decompression streams and told native users to use the web app for ordinary
compressed files. Tests now remove both browser compression and Blob globals
and parse compressed PDF and DOCX fixtures through their normal parser routes.
That verifies the JavaScript dependency boundary; it is not a claim that a
physical iOS/Android picker or SQLite driver was exercised.

## Bounds and integrity

The inflater feeds 256 compressed bytes per synchronous streaming push to avoid
decoding an entire compression bomb before an output callback can enforce its
limit. Every callback counts actual output bytes before retaining them; the
result allocation uses that checked total, never an unchecked advertised size.
PDF calls retain the existing aggregate 64 MiB decompression budget, and DOCX
uses the selected entry's already bounded advertised size (at most 1 MiB).
PDF output is debited during decoding even when a damaged optional object stream
is rejected, so retrying other objects cannot restart a spent expansion budget.

PDF zlib streams have their header and Adler-32 checked. Up to eight trailing
PDF whitespace/NUL bytes are tolerated only when a valid checksum is found;
arbitrary trailing data and corrupt/truncated streams are rejected rather than
returning partial text as a successful import. DOCX ZIP entries additionally
check CRC-32 after either stored or raw-DEFLATE decoding. A malformed package
with a missing or invalid CRC is rejected. The existing synthetic DOCX builder
now writes real CRC values instead of zero; independent standard check vectors
verify the checksum helper.

The existing DOCX ZIP restrictions remain: no encrypted entries, ZIP64 or
data-descriptor/streaming layouts, and only `word/document.xml` is inflated.
Supporting more ZIP layouts needs a separate, bounded package-reader change;
this correction does not claim every DOCX writer is supported.

## Text preservation

PDF lines longer than one note body are split into as many chunks as needed,
with the one-based page heading repeated. The previous implementation sliced
off a long line's tail without reporting that loss. Tests include a 60,013
character line with a tail sentinel and a ToUnicode font mapping whose text
crosses a chunk boundary as surrogate pairs. Both are preserved exactly.

These corrections do not add OCR/handwriting recognition, vendor export
certification, PDF layout reconstruction, original-file retention or structured
per-chunk page metadata. Authentic GoodNotes sample validation stays on #19/#72;
original visual assets and their storage are handled separately in the shared
import integration.
