# GoodNotes PDF sample investigation — #19

Inspected on 2026-11-07 with Python 3.8 and `pypdf==5.0.1`, installed under the
ignored local `.expo/` directory. Neither this tooling nor downloaded PDFs are
application dependencies or committed assets. No OCR was run.

## Candidate inspected, not accepted as a GoodNotes export

- Original publication: [derSteh's GoodNotes 5 workflow handout](https://fortbildungen.dersteh.de/wp-content/uploads/2021/06/Goodnotes5_Handout_derSteh-1.pdf).
- Download: 2,443,452 bytes; six pages.
- SHA-256: `27d610cece71b568cf50fce2875fdd2f90dca3965bc9089554f7d5177013aa57`.
- PDF producer: `macOS Version 11.4 (Build 20F71) Quartz PDFContext`.
- No PDF `/Creator` entry identifying GoodNotes.
- Creation/modification metadata: `D:20210616085150Z00'00'`.

The original publication concerns GoodNotes and visibly illustrates typed and
handwritten material. That does not establish that the document itself is a
direct GoodNotes export, identify the export settings or distinguish an embedded
screenshot from exported note content. Quartz metadata alone is insufficient
authentication. It therefore cannot fulfill #19's typed/handwritten export tests.
No original document content is reproduced in this repository.

| One-based page | Media box, PDF points | Extracted characters (including whitespace) |
| --- | --- | --- |
| 1 | 841.89 × 595.276 | 159 |
| 2 | 595.276 × 841.89 | 192 |
| 3 | 841.89 × 595.276 | 152 |
| 4 | 841.89 × 595.276 | 81 |
| 5 | 841.89 × 595.276 | 175 |
| 6 | 841.89 × 595.276 | 53 |

`PdfReader` emitted seven warnings about incorrectly pointing objects (58, 61,
76, 78, 80, 100 and 131, each with offset zero), then recovered enough to iterate
the six pages. Text extraction returned nonempty strings on each page, with
some merged spacing. These findings show only that this candidate's text layer
is readable with this desktop tool. They do not establish completeness, OCR
accuracy, original reading order or feasibility in the Expo native/web runtime.

## Other public leads

The search also found GoodNotes-compatible blank planner/flashcard templates,
screenshots in documentation, and third-party native-file converters. A PDF
designed to be imported *into* GoodNotes is not an export *from* GoodNotes.
Likewise, a converter-generated PDF would test the converter rather than the
vendor export. These were not substituted for the required sample pair.

Another candidate, [a GoodNotes 5 guide on Maria Morales' site](https://mariamorales.net/wp-content/uploads/2023/09/guia-goodnptes-5.pdf),
was identified but not inspected. It is not counted as sample evidence.

## Repeat the inspection locally

For an already obtained PDF, the following research-only snippet prints metadata,
hash, page dimensions and text counts without copying full note contents:

```python
import hashlib
from pathlib import Path
from pypdf import PdfReader

path = Path("sample.pdf")
reader = PdfReader(str(path))
print(hashlib.sha256(path.read_bytes()).hexdigest())
print(dict(reader.metadata or {}))
for number, page in enumerate(reader.pages, 1):
    print(number, float(page.mediabox.width), float(page.mediabox.height),
          len(page.extract_text() or ""))
```

This is an inspection protocol, not a production importer or an automated
acceptance test. Complete the export matrix and visible-ground-truth comparison
in [the feasibility report](goodnotes-feasibility.md) before closing #19.
