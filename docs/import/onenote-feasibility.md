# OneNote feasibility — IMPORT.3 (#20)

Researched 2026-11-07. Research only; no OneNote importer, OAuth app or native
format parser was implemented or exercised.

## Expanded-scope decision (2026-11-07)

The user now selects offline DOCX, MHT/MHTML and HTML/HTM import for #25, with
OneNote PDF exports using the shared generic PDF engine. This supersedes the
original v1 deferral and future Graph-first preference below. See the
[expanded plan](../note-import.md#expanded-implementation-scope-2026-11-07).
These are local export adapters, not a claim that every OneNote client offers
every export format. Preserve available typed structure and embedded resources;
warn about missing notebook hierarchy, layout, ink and unsupported attachments.
Graph OAuth and native `.one` parsing are not selected. No account credentials
or OCR service are needed for this planned route. Actual notebook-export testing
remains part of #25's acceptance and is not supplied by this documentation.

## Original recommendation for IMPORT.11 (#28, superseded scope)

Defer the OneNote parser (#25) from v1. It is feasible in principle, but neither
authenticated access nor export fidelity has been tested on a sample notebook.
For a later hierarchy-preserving importer, prefer **Microsoft Graph with
delegated read access**, a source review step and explicit handling of images,
attachments and spatial content. If an offline file route is preferred, spike
actual desktop `.docx` or `.mht` exports first. PDF can later share a generic
page-text pipeline but is a poor source of notebook hierarchy.

## Available routes, authentication and fidelity

| Route | Documented availability/auth | Structure retained and tradeoff | Effort / risk estimate |
| --- | --- | --- | --- |
| Graph notebook/section/page APIs | Cloud consumer notebooks on OneDrive and enterprise notebooks on Microsoft 365. Requires a registered app and signed-in user's OAuth bearer token. `GET /me/onenote/notebooks`, section collections and pages expose the hierarchy; page content is HTML. | Best basis for stable notebook/section/page identity. Fetch parent relations and page order explicitly; page HTML is not the complete notebook. Handle pagination and errors rather than assuming a single response is complete. | High / medium-high: OAuth, access expiry, traversal, conversion and resources. |
| Windows desktop PDF | Microsoft's desktop guide documents File → Export and selecting the export scope and PDF format. This is an action in the user's OneNote client; importing the resulting local file need not authenticate to Microsoft. | Static page appearance. It does not supply the notebook/section tree as structured data. Text extraction and ink/OCR quality must be measured on real exports. | Medium-high / high for text imports; lower only for a viewer. |
| Web PDF | Microsoft documents exporting a page through printing to PDF. The web route does not export an entire notebook or section to PDF. | One page's visual snapshot. User would need to restore destination/subject context during review. | Medium-high / high for extraction and ordering. |
| Desktop Word (`.docx`/`.doc`) | Microsoft's accessibility instructions list Word, PDF, XPS and Single File Web Page (`.mht`) beside native `.one`. Available scope/format combinations depend on the desktop client; do not promise equivalent iPad/web export menus. | A candidate for typed paragraphs and basic document structure. No sample was tested, so preservation of ink, attachments and notebook identities is unproven. | Medium / medium-high pending export samples and an OOXML parser spike. |
| Desktop Single File Web Page (`.mht`) | Documented desktop export, not a general `.html` button available in every OneNote client. | Candidate HTML/MIME package route. Needs MIME/resource decoding and safe HTML-to-text conversion; it should not render active content or fetch arbitrary URLs while importing. | Medium-high / high until examples establish embedded resources and layout. |
| Web notebook download | Microsoft limits web notebook export to notebooks stored on **personal OneDrive**; it excludes OneDrive work/school and SharePoint notebooks. It requires access to the signed-in notebook, and download may contain errors requiring inspection. | Backup/download route, not a promise of parser-ready Markdown or HTML. Downloading a notebook does not eliminate native-format work. | High / high for a native notebook importer. |
| Native `.one` / `.onetoc2` | Public MS-ONE and MS-ONESTORE specifications exist. Local file access needs no Graph token. | The specs describe note sections/pages and a revision store with object spaces, property sets and a transaction log. A correct implementation must interpret those structures and content types, not extract strings by scanning bytes. | Very high / high for a new mobile-compatible parser. |

Sources: [Graph content and structure](https://learn.microsoft.com/en-us/graph/onenote-get-content),
[desktop PDF](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/export-notes-from-onenote-as-a-pdf),
[web PDF](https://support.microsoft.com/en-us/onenote/onenote-for-web-help-and-learning/export-notes-as-a-pdf-in-onenote-for-the-web),
[desktop export formats](https://support.microsoft.com/en-gb/accessibility/onenote/use-a-screen-reader-to-share-and-collaborate-on-notebooks-in-onenote),
[notebook export restrictions](https://support.microsoft.com/en-us/onenote/export-and-import-onenote-notebooks),
[MS-ONE](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-one/),
[MS-ONESTORE](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-onestore/).
Effort/risk ratings and stome mapping choices are engineering inferences.

## Graph permission choice and documentation discrepancy

The current [OneNote integration overview](https://learn.microsoft.com/en-us/graph/integrate-with-onenote)
states that app-only authentication is unsupported from March 31, 2025 and
directs integrations toward delegated authentication. Some generated API
permission tables, including [Get page](https://learn.microsoft.com/en-us/graph/api/page-get?view=graph-rest-1.0),
still list application permissions. Do not treat those rows as evidence that an
unattended app-only importer will work. A future spike must verify the delegated
flow against the actual account/tenant.

For reading owned notebook pages, start with the documented least-privileged
delegated `Notes.Read` permission. The Get page table supports both personal and
work/school delegated accounts; broader organizational sharing may need a
different scope and user/tenant consent. A read importer should not request
write scopes by default. The reference currently marks this API as available
in the global Graph service and unavailable in the listed US Government and
China deployments. These account/cloud constraints must be visible before an
integration is offered.

## What the data can represent

Microsoft's [input/output HTML documentation](https://learn.microsoft.com/en-us/graph/onenote-input-output-html)
describes converted HTML with headings, paragraphs, lists and tables, positioned
containers, image elements and file-resource objects. Page content may reference
separately fetched binaries. This supports typed-note extraction; it does not
prove editable ink strokes or pixel-perfect round trips. HTML output differs
from input and can reorganize containers. An importer must preserve source IDs
and links, bound resource reads, and warn before dropping a layout or resource.
Never infer complete handwritten text merely because an image has OCR or the
service supports search.

## Evidence boundary and next gate

This review tested official documentation against the route requirements; it
did not sign in to a Microsoft account, register an app, fetch Graph output,
download a notebook, convert a `.one` file, or inspect a real Word/MHT/PDF export.
#20's research criteria can be satisfied by this route/fidelity/risk analysis;
#25's parser criteria require sample notebooks and are not satisfied.

The original recommendation required a permitted notebook before selection;
the expanded user request now selects bounded offline adapters for engineering.
Before declaring their source fidelity complete, obtain a permitted notebook
with sections, subpages, typed headings, tables, an image, an attachment and ink.
Measure hierarchy, order, text and resource preservation for the chosen route;
test token expiry/denied access and partial fetches. Include an offline-only
notebook in the availability check. Retain this evidence requirement while the
newly selected adapters and shared artifact contract are implemented. Synthetic
DOCX/HTML/MIME fixtures establish parser behavior, not authentic OneNote export
fidelity. The account/expiry checks apply only if Graph is separately selected.
