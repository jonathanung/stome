# GoodNotes PDF feasibility — IMPORT.2 (#19)

Research date: 2026-11-07. Parent: [note import #17](https://github.com/jonathanung/stome/issues/17).
This is research, not a production parser or a claim that GoodNotes is supported.

## Finding and v1 recommendation

GoodNotes PDF import is technically plausible for pages containing usable text,
but **not sufficiently verified to select for v1**. Keep the existing Markdown
scope and defer the gated GoodNotes parser (#24). Do not close #19: the required
typed and handwritten GoodNotes export samples have not been obtained and tested.
This is an evidence gap, not proof that PDF extraction is impossible.

| Route | Expected fidelity, based on vendor documentation | Effort / risk assessment |
| --- | --- | --- |
| PDF with selectable typed text | Text may be extracted per page; layout, reading order, tables and headings still need review. | Medium effort / medium risk; native and web extraction need separate verification. |
| Flattened PDF with handwriting recognition enabled | GoodNotes can include recognized handwriting as searchable/copyable text. Recognition can misread words, notation or languages. | Medium-high effort / high semantic risk until authentic samples and ground truth are compared. |
| Editable PDF handwriting, image-only pages, or flattened PDF without recognized text | Visible ink is not necessarily text. A text extractor cannot interpret vector strokes or pixels as words. | High effort / high risk; requires a separate recognition path and explicit handling of unrecognized regions. |
| Native `.goodnotes` document | GoodNotes describes this as its own editable document format. No supported vendor parser/API contract was established in this research. | Defer; reverse engineering is outside this PDF-export investigation. |

These relative estimates are engineering judgments, not measured implementation
times. The public candidate inspection below does not validate these export routes.

## Documented export options and tradeoffs

GoodNotes documents PDF, native document and image exports on Apple platforms.
Pages can be exported individually or as a selection; folder export can produce
a ZIP retaining folders. Android, Windows and web have a PDF export workflow.
Treat platform/version/settings as part of a future sample's provenance rather
than assuming all options behave identically. [GoodNotes export documentation](https://support.goodnotes.com/hc/en-us/articles/7353742824975-Export-documents-or-pages)

Editable PDFs retain editable objects and the original document's outlines and
links, while handwritten ink is not searchable in that export mode. Flattened
PDFs can contain searchable handwriting when recognition is explicitly enabled,
but the vendor says original PDF outlines and hyperlinks are lost. A user's
ability to search inside GoodNotes therefore does not establish what a PDF
extractor will see after export. [GoodNotes PDF export choices](https://support.goodnotes.com/hc/en-us/articles/8537070839183-Choose-Between-Editable-and-Flattened-PDF-Export)

Background and annotation inclusion settings also affect what survives. If an
export omits handwriting, highlights or inserted images, a downstream importer
cannot reconstruct content absent from the file. Ask users to include both
backgrounds and annotations in the samples. [GoodNotes annotation/background settings](https://support.goodnotes.com/hc/en-us/articles/360000629576-Include-Annotations-and-Page-Backgrounds-in-PDF-Exports)

GoodNotes now also documents typing-focused Text Documents, which can be printed
or exported as PDFs. Include this separately from a notebook's typed text boxes
in future testing; it is not evidence that either PDF variant was tested here.
[GoodNotes Text Documents](https://support.goodnotes.com/hc/en-us/articles/13692184123279-Text-Document)

## Extraction and chunk mapping to investigate

Use a deterministic text-layer pass before considering OCR. PDF text describes
positioned glyphs, not a reliable semantic hierarchy: extraction cannot promise
headings, paragraph boundaries, table structure or reading order. A text layer
can also be incomplete on a mixed typed/ink page. Nonempty extracted text alone
must never be treated as proof that the whole visible page was recovered.
[pypdf extraction limitations](https://pypdf.readthedocs.io/en/5.0.1/user/extract-text.html)

If #24 is later selected, propose one reviewed page group at a time, with the
original collection/path identity, full-file hash, one-based page number and
chunk ordinal retained. Split long page text at the existing chunk limits.
Do not turn page numbers into inferred subjects or count imports as study.
The current import contract has no structured PDF page metadata; that needs an
explicit design change before implementation. No migration is added here.

Pages without useful text should be reported as requiring recognition, not saved
as empty notes or silently skipped. For mixed pages, show the original page
beside extracted text so users can detect omitted ink. A future OCR path must
identify generated text, retain page references, surface uncertainty and obtain
review before saving. Whether recognition runs locally or sends a document to a
service is an unresolved product/privacy decision; this research uploads no
notes to an OCR or AI service. Recognition accuracy, especially for equations,
diagrams and handwriting, remains unmeasured.

## Sample evidence and acceptance status

No user-provided GoodNotes export was available. A bounded public search found
templates, guides and converters, but none provided a verified pair of typed
and handwritten exports with known settings. A six-page original-author training
handout was downloaded and inspected locally. It has readable text, but its
metadata does not establish GoodNotes as the exporting application and the
pages contain screenshots. It is an **inconclusive candidate**, not an accepted
GoodNotes fixture. See [the inspection report](goodnotes-sample-report.md).

| #19 acceptance | Status |
| --- | --- |
| Test typed and handwritten GoodNotes exports | **Open:** verified exports and export settings are missing. The unrelated/inconclusive candidate does not satisfy this. |
| Assess OCR/handwriting recognition needs | Documented above; accuracy testing remains unperformed. |
| Effort/risk rating | Recorded as conditional engineering estimates above. |
| Recommendation feeds #28 | Keep Markdown v1; defer #24 until the sample gap and extraction spike are resolved. |

To finish the missing sample work, obtain a small typed notebook and a small
handwritten notebook with known page text (including a page mixing both), plus
export each as editable PDF and flattened PDF with recognition both off and on
where the app offers those settings. Record the app/platform version, language,
settings, source and SHA-256. Compare per-page extracted content against visible
ground truth and check missing annotations, ordering, page boundaries, symbols
and recognition errors. Also test a scanned/image-only page and an intentionally
empty page so the importer can distinguish omission from blank content.

Do not gate a production parser solely on this document. #19 remains open, #24
remains deferred, and #28's explicit dependency on completed feasibility work
must retain this unresolved acceptance item.
