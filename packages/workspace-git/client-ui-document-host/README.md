# dsh-plugins-client-ui-document-host

The upstream file preview engine — text, code, Markdown, HTML, image, PDF
(pdf.js with zoom and a text layer), Office, and the interactive spreadsheet
grid — drawing in the conversation's **File tab** instead of the right
Sidebar, with **no renderer forked**.

Replaces the `ui-sidebar-documentpreview` row. See `../../../ARCHITECTURE.md`'s
"Document preview: relocate the seat, never the renderers" for why this shape
was chosen over forking the renderers, mirroring them under a second slot
family, or moving the dock by forking the app frame.

## How it is a superset without an inventory

It runs `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`'s own `apply()`.
Every tab type, dictionary, service, seat, chip title and renderer that
plugin registers is therefore registered here too — including renderers a
later release adds, because nothing in this package enumerates them.

`./src/relocate.ts` wraps the Context so exactly one of those registrations
lands somewhere else: the seat moves from `sidebar.right.pane.tab` to
`conversation.file.document`, the slot the File tab declares. Every renderer
hangs off that seat's own children table, so moving the seat moves all of
them at once. The wrapper forwards every other property to the real Context,
binding methods to it so effects and service resolution stay on the fiber
that owns them — a redirect, not a sandbox.

Two things are added:

- **A hand-off body** (`./src/HandoffBody.tsx`) under the seat the engine
  vacated. The `text` tab type still claims every `dsh-resource://file/**`
  address — `openResource` *throws* for an address nothing claims, and
  conversation file links, tool line references and this bundle's own Files
  tree all navigate through it — so the Sidebar keeps accepting those
  addresses, forwards each to the File tab, and closes. When no File tab can
  take it (this package installed without the File-tab packages), it says so
  and stays put rather than closing into a dead end.
- **Two renderers upstream has none for** (`./src/renderers.tsx`), registered
  through the engine's own public registry at the `extension` band that
  outranks builtins: OWL/RDF ontologies (whose serialization is not decidable
  from the suffix, so the body detects it from the content) and `.rtf`
  (whose markup would otherwise be shown instead of its document). Nothing is
  registered for code, Markdown, images, PDF, Office, spreadsheets or CSV —
  the engine already does those at least as well, and a second implementation
  at `extension` priority would silently outrank the better one.

## The build contract this inherits

Inlining that engine means inheriting the build-time inputs its own
`tsdown.config.ts` supplies, which `../../../tsdown.client-plugin-preset.ts`
knew nothing about. `./tsdown.config.ts` carries them: the pdf.js worker
embedded as source text (a closure factory has no module URL to resolve a
`Worker` file against), the base64 `__DSH_PDFJS_ASSETS__` define, the Excel
worker rolled up to an IIFE string, and the pdf.js/spreadsheet license
banners. All resolved from the **vendor package's** own directory, never this
one, so `pdfjs-dist`/`exceljs`/`xlsx` cannot drift to a second copy of a
library whose build output is embedded verbatim.

Three pieces went into the shared preset instead, because they generalize:
`.css?inline` and plain `.css` imports, and package-local lazy chunks
(`codeSplitting`, `clientBanner`, and the `require.async` rewrite without
which a chunk is built, served, and never fetched).

The artifacts track upstream's own for the same graph: `lib/client.js`
339 kB (287 kB of engine plus this package's own two renderers),
`lib/client.pdf.js` 7.11 MB and `lib/client.excel.js` 7.05 MB, the last two
fetched on demand by the loader's package-local chunk route — which is
plugin-id agnostic, so it serves an out-of-tree package exactly as it serves
an in-tree one. Verified on a disposable profile: the served entry asks for
both chunks through `require.async`, and the server answers both.

**Import the two renderer components by path, never through
`dsh-plugins-client-ui-file-editing`'s barrel.** That barrel re-exports
`FilePreview`, whose graph pulls mammoth, xlsx and jszip. Importing it here
took this entry from 287 kB to **3.9 MB** and, worse, dragged the PDF asset
map out of its lazy chunk into the entry — several megabytes onto every
boot, to render two formats that need none of it.

## What it needs, and what happens without it

- `dsh-plugins-client-ui-conversation-files` declares the seat this fills. It
  is where the seat's contract lives (`../client-ui-conversation-files/src/document-seat.ts`),
  because a slot has exactly one declaring entry and that entry is the File
  tab. This package registers into it by name and imports nothing from it.
- `dsh-plugins-client-ui-conversation-enhanced` provides the cross-session
  opener the hand-off calls.

Both ship in this same bundle. Without them the engine still registers and
the Sidebar hand-off explains itself; the File tab simply draws its own
`FilePreview`, as it did before this package existed.

## Known Limitations and Deferred Work

- The seat reports a settled presentation — expanded, never fullscreen, one
  pane id — because the File tab has no collapsed or fullscreen state. A body
  that varies behaviour by those flags behaves as though the Sidebar were
  always open, which in the File tab it effectively is.
- No unit tests yet, consistent with the rest of this repo's packages at this
  stage (verified by typecheck, build, parity checks, and a real boot).
