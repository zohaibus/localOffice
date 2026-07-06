# LocalSheets

**A single-file, local-first, multi-sheet spreadsheet.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](localsheets.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](localsheets.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](localsheets.html)

No accounts. No cloud. No subscription. No analytics. No tracking. One HTML file.

<p align="center">
  <a href="https://localoffice.dev/localSheets/localsheets.html"><img src="https://github.com/user-attachments/assets/a938dcfe-094d-4b10-8b02-d8ff9c577a45" alt="LocalSheets demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://localoffice.dev/localSheets/localsheets.html"><b>▶ Open LocalSheets</b></a></p>

Part of [**LocalOffice**](../README.md), a family of single-file, local-first
tools that share one JSON format (`localoffice/v1`). Your data stays in a plain
JSON file on your disk.

---

## What it is

LocalSheets is a full multi-sheet spreadsheet in one HTML file (about 305 KB),
with zero dependencies and no build step. Workbooks are plain JSON: `git diff`
works on them, you can read or edit one in a text editor, and the whole product is
one file you can mirror, fork, archive, and run on an air-gapped laptop.

## What it does

- **Workbooks:** up to 100 sheets per file, each up to 10,000 rows by 702 columns
  (A through ZZ), with a tab bar to switch, rename, duplicate, and reorder.
- **Formula engine:** a broad function library (math, stats, text, lookup, dates,
  financial, logic, info), cross-sheet references (`=Sheet2!A1`,
  `=SUM('My Data'!A1:B10)`), absolute references (`$A$1`), cycle detection, proper
  error tokens, and a dependency graph with topological recalc.
- **Charts and sparklines:** bar / line / pie as inline SVG, plus
  `=SPARKLINE(range, [type], [color])` inside a single cell.
- **Editing:** range selection, whole row/column/sheet selection, jump-to-cell
  (`Ctrl+G`), formula reference picking, auto-pair parentheses, TSV copy/paste
  (round-trips with Excel and Google Sheets), 100-step undo/redo, insert/delete and
  sort rows and columns, resize, freeze panes, and format painter.
- **Formatting:** bold/italic/underline/strikethrough, wrap, font size, alignment,
  number formats, fill and text color, borders, and conditional formatting.
- **Data:** validation-list dropdowns, cell notes, named ranges, Excel-style tables
  with header filters, a fill handle with arithmetic-series detection, and merge
  cells.
- **UX:** find / replace / find-all, per-column filters, light/dark/auto theme, a
  range summary in the status bar, right-click context menu, and a help overlay
  (`?`).
- **JSONL / NDJSON import:** drop a `.jsonl` or `.log` file (common in
  robotics/telemetry) and the union of keys becomes the header row.

### Back-compat

LocalSheets reads **both** the legacy `localsheets` format and the
`localoffice/v1` envelope, migrates old files transparently on open, and writes
the envelope going forward, so existing files never break.

### Clipboard

Copying a selection writes plain TSV **and** a `localoffice` grid fragment, so
pasting into **localMindMap** (a node cluster) or **localDeck** (a table slide)
carries the data across natively. External apps still get TSV.

### Local AI (optional)

Click **AI** in the toolbar to open a panel that talks to a local
[Ollama](https://ollama.com) instance. **No data ever leaves your machine.** Two
modes: a freeform **text reply** (optionally with the selection as TSV context),
or a **JSON patch** the model returns as a structured object, validated and applied
as a single undoable bulk action. It is the only network call the app makes, and
only when you open the panel. Setup: [OLLAMA_SETUP.md](OLLAMA_SETUP.md).

The AI was tested on a roughly 7-year-old laptop with no usable GPU: slow but
correct. We verify the floor, not the ceiling.

## The file format

LocalSheets reads and writes `localoffice/v1` with `type: "sheet"`. Files are plain
JSON, sparse (only populated cells stored), and formulas re-evaluate on load (a
saved file never trusts a cached value for a formula cell).

## Templates

Seven ready-to-use workbooks ship in `templates/` (open any via the toolbar
**Open**): monthly budget, RSU tracker, startup burn, rental cashflow, kids
allowance, mortgage calculator, and a 6-DOF robot-arm PID calibration. The last two
show the multi-sheet pattern, where an inputs sheet feeds a computed sheet via
cross-sheet formulas. See [`templates/README.md`](templates/README.md).

## In the LocalOffice Hub

LocalSheets also opens inside **`LocalOffice.html`** (the Hub): pick a workspace
folder there, click a workbook, and it loads here in an iframe. **Save** writes
straight back to that file and **Save As** picks a new one. The Hub performs the
write (it holds the folder handle), so in-place save works even over `file://`. Run
standalone and everything behaves exactly as documented here.

## Privacy

The app is one HTML file with no remote fonts, analytics, or update checks. The
only outbound call is the optional AI panel reaching a local Ollama
(`localhost:11434`), and only while that panel is open. Verify it yourself:

```bash
grep -nE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' localsheets.html
```

Expected: exactly two `fetch` lines, both to `localhost:11434`.

## Browser support

| Browser | Status |
|---|---|
| **Chrome / Edge / Brave** (Chromium) | Primary target; full feature set, in-place save via the File System Access API |
| **Safari** (WebKit) | Supported; save falls back to a download (no File System Access API) |
| **Firefox** | Not officially supported in v1.1 (no File System Access API; no cross-engine regression tests yet) |

## Repo structure

```
localSheets/
├── localsheets.html        # The app (single file, about 305 KB)
├── verify-localsheets.js   # Headless (Playwright) verification of the shipped app
├── check-templates.js      # Per-template health report (diagnostic)
├── src/                    # Un-bundled engine + store + envelope adapter + unit tests
│   ├── engine.js           # tokenizer + parser + evaluator + functions
│   ├── app-layer.js        # dependency graph + store (state, undo, structural ops)
│   ├── envelope.js         # localoffice/v1 adapter
│   ├── test-engine.js      # 143 tests
│   ├── test-store.js       # 58 tests
│   └── test-envelope.js    # 23 tests (envelope + cross-tool interop)
├── templates/              # 7 ready-to-use sample workbooks
├── OLLAMA_SETUP.md         # One-time local-AI setup (optional)
└── README.md               # This file
```

The engine and store have no DOM dependencies and are fully unit-tested; the UI
wires the HTML shell to the store. Zero runtime dependencies ship in the artifact.

## License

[MIT](../LICENSE). Yours forever.
