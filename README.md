# LocalOffice

Single-file, local-first office tools: fully offline, zero dependencies, built on
one rule: **AI advises, deterministic math decides.**

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/LocalOffice.html"><img src="https://github.com/user-attachments/assets/373d110c-cdf6-454f-96c1-0a61252394ef" alt="LocalOffice Hub demo (animated)" width="860"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/LocalOffice.html"><b>▶ Open the Hub</b></a></p>

A family of tools that all read and write one JSON format (`localoffice/v1`); the
shared core is built once, and each tool is a thin layer on top. Every tool has a
**JSON** button that shows the document's raw `localoffice/v1` envelope: view it,
edit it, copy or download it, or apply changes back (invalid JSON is rejected, so
a bad edit never clobbers your document).

Conventions: one self-contained HTML file per tool, no dependencies, no build
step, fully offline. The only optional network call is to a local Ollama. MIT.

## Structure

```
LocalOffice.html         The Hub. Pick a workspace folder, browse every file, open the right tool.
src/core.js              Shared loader/saver, the foundation every tool builds on.
src/test-core.js         Node unit tests for the core (no dependencies).
src/verify.js            Shared verification kernel (deterministic exact + coverage + tolerance).
src/test-verify.js       Node unit tests for the verify kernel.
src/render.js            Shared static renderer (LocalRender): any object → HTML/SVG for embeds + export.
src/test-render.js       Node unit tests for the render module.
core-harness.html        Browser dev harness for the IO paths Node can't test.
run-all-tests.js         Runs every suite across the whole project.
fs-mock.js               In-memory File System Access API mock for headless save/open tests.
embed-harness.html       Test fixture that drives the real Hub iframe + postMessage handoff.
verify-hub.js            Hub dashboard, embed protocol, and Hub-mediated save tests.
verify-embed.js          Embedded smoke test: each tool rendered in a real iframe.
localDeck/               Deck tool (body type: slides). Single file plus headless tests.
localCards/              Flashcards tool (body type: flashcards). Single file plus tests.
localSheets/             Spreadsheet (body type: sheet), refactored onto the envelope.
localPlan/               Planner (body type: plan, tracks/sections/items) on the envelope.
localMindMap/            Mindmap (body type: mindmap). Single-file canvas plus headless tests.
localMark/               Image sanitizer (body type: image). Scrub/redact/annotate plus headless tests.
localCheck/              QA runbook (body type: runbook). Kernel-gated sign-off plus headless tests.
localDoc/                Block doc writer (body type: doc). Coverage compliance linter plus headless tests.
templates/               localoffice/v1 sheet and plan presets (unit pack, net-worth, PM plan).
```

## Shared capabilities (across the tools)

- **LLM authoring — `✦ Prompt`.** Every tool's JSON panel has a `✦ Prompt` toggle
  showing a copy-ready prompt to build that document with *any* LLM (local, on-prem,
  or cloud); paste the returned JSON back and Apply. The AI-panel tools also have a
  one-click **Generate** via a local Ollama. The deterministic kernel always decides
  correctness — the model only proposes.
- **Embedded objects.** A tool can embed another tool's object as a live, editable
  child — a sheet's table or a mind map on a deck slide, an object inline in a doc,
  or attached via each tool's `◲ Embeds` drawer. Objects are stored as a nested
  `localoffice/v1` envelope (they round-trip on save/load) and drawn by the shared
  static renderer `src/render.js` (`LocalRender`), so they render the same in the
  editor **and** in exports, fully offline. You edit by opening the real tool.
- **Mind-map diagramming.** Node shapes (rounded, rectangle, circle, diamond,
  triangle, logic gates), a full colour palette (named + custom hex), and
  connections you can click to **label / style** (line, arrow, double-arrow, dashed)
  or **drag to re-connect**. Delete is Visio-style: node-only (re-parenting its
  children), with **Shift+Del** to delete the whole branch.

## The Hub (`LocalOffice.html`)

The cohesion layer: one file that makes the tools feel like a single workspace.
Single file, no deps, offline.

- **Pick a workspace folder** (File System Access on Chrome/Edge, a "Files…"
  picker fallback on Firefox/Safari). The Hub scans recursively for
  `*.localoffice.json` and reads **only each file's `meta`** (title, type, tags).
  Nothing else is parsed, and nothing leaves the machine.
- **Dashboard:** a card per file with a type badge, tags, and path, plus
  **search**, **filter by type/tag**, and **sort** (recent / title / type).
  Unreadable files are still listed and flagged.
- **Open in place:** clicking a file loads its owning tool in an iframe and hands
  it the file over a small **embed protocol** (`localoffice:open` / `:ready` /
  `:opened` / `:save` / `:saved`). Each tool still works standalone; the receiver
  only activates when embedded.
- **Save back to the same file:** file pickers are blocked in a cross-origin
  subframe, so an embedded tool **delegates the write to the Hub** (the top
  frame), which holds the directory handle and writes **in place**, even over
  `file://`. **Save** reuses the handle; **Save As** always opens the picker for a
  new file. If the Hub has no handle (the "Files…" fallback), it shows the picker
  itself, so Save works whether you launch from `file://` or a host.
- **No localStorage shadow when embedded:** the tools that autosave to
  `localStorage` standalone (LocalPlan, localMindMap) **turn that off in the
  Hub**. The file is the single source of truth, so there is no stale per-tool
  copy to drift or leak across the many files you open.

Verify headlessly: `node verify-hub.js` (48 checks): indexing/filter/sort/render,
the open-message split (text vs. handle), the Hub-mediated save handler, and the
real iframe + postMessage handoff for every tool via `embed-harness.html`. Each
tool's suite also asserts the embed handshake loads a file. The folder picker
needs a real browser gesture.

## Clipboard Protocol

Copy and paste carries data *between* tools, not just within one. On **copy**, a
tool writes plain TSV/text (for any app) **and** a `localoffice/clip-v1` fragment
smuggled in `text/html` (a `[data-localoffice]` span, the rich type the Clipboard
API allows). On **paste**, a tool reads that fragment, or falls back to the plain
text, and ingests it natively:

- **LocalSheets** copy emits a grid fragment of the selection.
- **localMindMap** paste turns a grid/TSV into a **cluster of nodes** (one label
  per row) under the selected node.
- **localDeck** paste turns a grid/TSV into a **table slide**; plain lines become
  a **bullets slide**.

Paste is always **explicit** (Ctrl/Cmd-V); nothing is auto-generated. Apps that
only see `text/plain` still interoperate (TSV in, TSV/lines out). The transforms
are covered by unit tests in each tool's suite.

## localDeck (`localDeck.html`)

Structured slide authoring: type content, pick a layout, reorder slides. It is
not a freeform canvas. Single file, no deps, offline. Reads/writes
`localoffice/v1` (`type: "slides"`).

- **Layouts:** Title, Title+Bullets, Two columns, Section, Quote, Image,
  Image+caption, Text+image, Code, Table, **Embedded object**, Blank. The embedded-
  object layout puts another tool's object on the slide (a sheet table, a mind map,
  …), drawn by `LocalRender` and editable in a modal; **A− / A+** scale it.
- **Pictures:** insert by file picker, **drag-and-drop, or paste** (Ctrl/Cmd-V).
  Every image is **re-encoded through a `<canvas>`**, which strips all source
  metadata (EXIF/GPS/camera/author) and downscales it (longest side 1600px), so
  exports stay anonymous even with photos on the slides.
- **Code blocks:** monospace, preserved indentation, language label, line
  numbers, S/M/L sizing. No syntax-highlight dependency.
- **Editing:** undo/redo (Ctrl+Z / Ctrl+Y), speaker notes (in the file and
  presenter view, **never** in the HTML export), optional footer and slide
  numbers.
- **Templates:** Engineering design review, Incident postmortem (RCA), Sprint
  demo, Research/field report. They are embedded in-file, since offline can't
  fetch.
- **Export:** standalone single-file HTML (arrow-key/click nav) and PDF (browser
  print, "Save as PDF"). The firewall holds: exports carry zero identifying
  metadata and zero speaker notes, only the deck title, slide content, and theme.
- **Local AI (optional):** the **✦ AI** panel talks only to a local Ollama at
  `localhost:11434`. It is the only network call, fully optional, and the AI never
  changes the deck on its own (it proposes, you apply). Assist mode puts freeform
  text into a field or notes; Draft-slide mode returns a reviewed JSON patch for
  the current slide. Setup: `localDeck/OLLAMA_SETUP.md`.
- **Light / dark editor:** a ☾/☀ toggle switches the editor chrome (it follows
  the system setting until you choose, then persists). This is separate from the
  deck's own theme presets (midnight/slate/paper/warm), which style the slides.

Verify headlessly: `node localDeck/verify-deck.js` (138 checks, headless Chromium
via Playwright). The AI path runs against a mocked Ollama stream, so it works with
or without Ollama installed. The PDF print dialog, a live Ollama, and the
Firefox/Safari download fallback are the only paths that need a manual click.

## localCards (`localCards/`)

Spaced-repetition flashcards (body type `flashcards`). Single file, no deps,
offline. Reads/writes `localoffice/v1`.

- **Deterministic auto-grading** via the shared verification kernel
  (`exact` / `coverage` only), *never* an LLM. Cloze deletion auto-builds its own
  check from the hidden words.
- **Review:** FSRS-lite scheduling, self-grade plus typed-answer auto-grade,
  reverse/both-way cards, study-card zoom, leech/stats panel.
- **Authoring:** card-type presets, sample decks (feature demo plus science,
  geography, language, all neutral examples), images on cards (canvas EXIF-scrub),
  TSV/JSON import and export.
- **Optional local AI** (`✦ AI`, Ollama) is **authoring-only and fenced from
  grading**. It drafts cards and proposes keyword checks; the kernel always
  decides. The AI writes the test, the math grades it.
- **Theming:** app light/dark mode plus per-card visual themes, with overlays
  that stay legible in every combination.

Verify headlessly: `node localCards/verify-cards.js` (104 checks).

## LocalSheets (`localSheets/`)

Single-file spreadsheet (body type `sheet`). Vanilla JS, no deps, offline.
Refactored onto the shared envelope. See
[`localSheets/README.md`](localSheets/README.md).

- **Engine:** a broad formula function library, absolute refs (`$A$1`),
  cross-sheet refs, insert/delete row and column with formula rewriting,
  fill-handle propagation.
- **Charts and sparklines:** bar / line / pie as inline SVG; `=SPARKLINE()`.
- **Back-compat:** reads both the legacy `localsheets` format and the
  `localoffice/v1` envelope, migrates old files transparently on open, and writes
  the envelope going forward, so existing users' files never break.
- **Clipboard:** copy emits a `localoffice` grid fragment (paste into localMindMap
  or localDeck). **Optional local AI** (`✦ AI`, Ollama) for formulas and
  JSON-patch edits. Opens in the Hub with in-place save.

Verify headlessly: `node localSheets/src/test-engine.js` (143),
`test-store.js` (58), `test-envelope.js` (23), and
`node localSheets/verify-localsheets.js` (52).

## LocalPlan (`localPlan/`)

Single-file planner (body type `plan`) built on a **tracks, sections, items**
model, not a task or Gantt list. Vanilla JS, no deps, offline. See
[`localPlan/README.md`](localPlan/README.md).

- **Structure:** tracks (with icons), each holding horizon sections (Now / Soon /
  Later / Someday) of items. Star items into a **Today** view, add recurring
  items, drag to reorder, search with `/`, and import via brain-dump or starter
  packs. Full **undo / redo** (`Ctrl+Z` / `Ctrl+Y`, plus toolbar buttons).
- **Optional local AI** (`✦ AI`, Ollama): **Distill** messy notes into plan items
  (through the existing braindump parser), **Decompose** a task into sub-steps,
  and **Suggest priorities**. Advisory, validated, never auto-applied.
- Envelope save/open, zoom, light/dark. Opens in the Hub with in-place save.

Verify headlessly: `node localPlan/verify-plan.js` (55 checks, including
mocked-Ollama AI and a mocked-FS round-trip).

## localMindMap (`localMindMap/`)

Single-file mindmap (body type `mindmap`). Vanilla JS canvas, no deps, offline.
Reads/writes `localoffice/v1` (`type: "mindmap"`).

- **Canvas:** drag the background to pan, scroll to zoom, **Fit** to frame
  everything. Node positions are stored (`x`/`y`) and edited by dragging. There is
  **no automatic layout** (deliberately out of v1 scope); new children land at
  simple deterministic offsets you can then move.
- **Structure:** a parent/child tree (`node.parent`) drawn as curved links, plus
  optional labeled **cross-links** (the `edges` array) via the **Link** tool.
- **Editing:** `Tab` adds a child, `Enter` a sibling, `F2`/double-click edits in
  place, `Del` removes a node and its subtree, `Space` collapses/expands (a
  collapsed node shows a `+count` badge).
- **Categorize:** tag nodes with a category color (`node.color`) from the toolbar
  swatches, which matters for systems and architecture maps. Per-node **text
  size** (`node.size`, A-/A+) lets you emphasize headings.
- **Templates:** three neutral starters (System architecture, Incident/RCA,
  Product roadmap), laid out cleanly so you skip the blank canvas.
- **Tidy and align:** AI-distilled maps and templates use a tidy-tree layout
  (depth to x, leaves stacked) so branches never overlap, and an optional **Snap**
  toggle rounds nodes to a grid as you drag. **Tidy** (selected branch) and **Tidy
  all** re-flow placement on demand, with **Ctrl+Z** undo. Both are explicit,
  user-invoked actions, never automatic, so manual layouts only change when you
  ask.
- **Images on nodes:** paste a screenshot (Ctrl+V) or pick a file onto the
  selected node. Every image is **re-encoded through a `<canvas>`** (the same
  scrub localDeck and localCards use), which strips EXIF/GPS/source metadata and
  downscales it, so a saved map is a safe offline lab notebook.
- **Touch:** one-finger drag pans or moves nodes, two-finger pinch zooms, so it is
  usable on a tablet in the field.
- **Files:** New / Open / Save / Save As (`Ctrl+S`) and Print. File System Access
  on Chrome/Edge, download/upload fallback elsewhere, with `localStorage`
  autosave. Unknown body fields are preserved on round-trip (forward-compat).
- **Theming:** light/dark, following the system setting until you choose.
- **Schematic affordances:** tag a node with a **logic-gate shape**
  (AND/OR/XOR/NOT/MUX) from the toolbar; links between two gates **port-anchor**
  out to in for a signal-flow look. It is purely a *diagram* affordance, with no
  netlist and no simulation.
- **Optional local AI (`✦ AI`, Ollama):** the same advisory, fenced pattern as
  the other tools. **Expand node** breaks the selected node into validated
  sub-children, **Distill to map** turns pasted text into a previewed nested map,
  and **State machine from code** plots an FSM (states to nodes, transitions to
  labeled signal-flow edges) from pasted code. It talks only to a
  *local* Ollama at `localhost:11434` (off by default) and never changes the map
  without your approval.

Verify headlessly: `node localMindMap/verify-mindmap.js` (122 checks, including
mocked-Ollama AI, color/image/touch, tidy-layout/snap/templates, tidy plus undo,
the Hub embed handshake, and a mocked-FS save and open round-trip).

## localMark (`localMark/`)

An IP **sanitizer**, *not* a photo editor (body type `image`). Single file, no
deps, offline. Reads/writes `localoffice/v1` (`type: "image"`).

- **Scrub on import:** drop, pick, or paste an image and it is re-encoded through
  a `<canvas>` (EXIF/GPS/camera metadata structurally stripped, downscaled to
  1600px).
- **Redaction is the moat, and it is destructive:** confirming a blackout box
  **flattens black pixels into the raster immediately**, so the originals are
  erased from the file, not merely covered. A redaction marker is recorded for
  audit.
- **Annotations:** watermark text (tiled) and arrow callouts with labels are
  non-destructive vector overlays you can undo.
- **Dimensional calibration:** **⊢ Calibrate** from a known feature (drag a line,
  type its real length, e.g. `1.0 mm` / `5 cm` / `0.4 in`) sets `body.scale`, and
  **📏 Measure** then labels distances in real-world units (`3.20 mm`). Pure
  arithmetic, no AI, no network.
- **QR overlay:** stamp an **asset tag or calibration URL** as a QR code, using a
  dependency-free byte-mode encoder (EC level M, versions 1 to 6, about 106
  chars). The encoder's math is verified offline (GF(256), Reed-Solomon
  zero-syndrome, data round-trip); confirm scannability once with your phone.
- **Export:** a flat, metadata-free **PNG** (base plus overlays composited).
- Save/Open as `localoffice/v1`, light/dark, opens in the Hub with in-place save.

Verify headlessly: `node localMark/verify-mark.js` (32 checks), including a
pixel-level assertion that redaction erases the underlying pixels, the calibration
px-to-mm math, and the QR encoder's GF and Reed-Solomon math plus a data
round-trip. Physical QR scannability is a one-time manual check.

## localCheck (`localCheck/`)

An interactive **SOP / QA runbook** (body type `runbook`), the verification kernel
turned into a product. Single file, no deps, offline.

- **Steps:** **Check** (tick to confirm), **Measure** (a typed value), **Note**.
- **The gate:** each Measure step is graded by the shared kernel,
  `exact` / `coverage` / **`tolerance`** (for example "ambient temperature between
  18 and 24", or "100 ± 2"), **deterministically, never an LLM.** A live PASS/FAIL
  badge updates as you type.
- **Sign-off is gated:** you **cannot sign off** the runbook until *every* gating
  step passes. An out-of-bounds reading blocks it; the math decides, not a click.
- **Integrity seal:** signing records a **SHA-256** of the content (`body.seal`,
  via WebCrypto), and reopening re-verifies it. An edited reading turns the bar red
  (**Integrity check FAILED**). Honest framing: the hash is keyless, so it is
  **tamper-evident, not unforgeable** (and deterministic, so the no-LLM rule
  holds).
- **Conditional branching:** mark a step **diagnostic** to hide it until a Measure
  step's **on fail** target branches to it. A failing reading unfolds the
  diagnostic block, a passing one folds it away: a state-machine runbook, not a
  linear PDF. Hidden diagnostics never gate, and the reveal is deterministic.
- **Web Serial read:** a Measure step's **Read USB** button pulls a value from a
  connected instrument and feeds it to the same kernel gate (Chrome/Edge,
  user-gesture, secure context; the parse logic is tested, the device read is a
  manual path).
- Neutral templates (Equipment readiness, Deployment checklist). Save/Open envelope,
  light/dark, opens in the Hub with in-place save.

This is where the kernel gained **`tolerance`** (still deterministic, see
`src/verify.js`). Verify headlessly: `node localCheck/verify-check.js` (42
checks), including the headline that out-of-bounds blocks sign-off and in-bounds
allows it, plus the sign, reopen, tamper-detected seal path, the fail-to-diagnostic
branch, and the Web Serial parse logic.

## localDoc (`localDoc/`)

A block-based **engineering-doc writer** (body type `doc`) for design docs, RCAs,
and technical proposals, *not* a Word clone. Single file, no deps, offline.

- **Sections, not a page:** add headings and prose blocks, then reorder or remove.
- **Compliance linter:** give a section a **required-keywords** rule and the shared
  `coverage` kernel gates it. **Markdown export is blocked** until every required
  section contains its keywords (for example, an RCA *Mitigation* must mention
  `patch`, `deploy`). Matching is whole-word (so `dispatched` can't satisfy
  `patch`) and a malformed rule fails closed. Deterministic, never an LLM. A live
  badge shows each section's status.
- **Templates:** Incident postmortem (RCA), Engineering design doc, Technical
  proposal (RFC), each pre-wired with compliance rules.
- **Optional local AI (`✦ AI`):** *route* pasted raw text (a chat thread, notes)
  into the document's sections as a previewed draft you approve. The AI fills
  prose; **the compliance verdict stays the kernel's**, never the AI's.
- Export Markdown when compliant. Save/Open envelope, light/dark, Hub embed.

Verify headlessly: `node localDoc/verify-doc.js` (104 checks), including the
headline that export is blocked until mandatory keywords are present, the
keyword-matching truth-table, the malformed-rule fail-closed class, WYSIWYG round-
trip fidelity, and a mocked-Ollama distill.

## The core (`src/core.js`)

One dependency-free module, usable from the browser (`window.LocalOffice`) or
Node (`require`). Responsibilities:

- **Envelope:** `createEnvelope(type, opts)`, `validate(obj)`, `normalize(obj)`.
- **Parse/serialize:** `parse(text, {coerce})`, `stringify(env)`, `serialize(env)`.
  Round-trips preserve unknown fields (forward-compat). `coerce` is the seam for
  reading older tool formats (used by the LocalSheets back-compat step).
- **Dispatch on type:** `dispatch(env, handlers)`, falling back to
  `handlers.default` for unknown types (graceful degradation: show the title,
  offer hand-off).
- **File IO:** `openFile`, `saveFile`, `saveFileAs`, `download`. File System Access
  API on Chrome/Edge, manual download/upload fallback on Firefox/Safari.

Exports never stamp identifying metadata (author/user/machine), only
`id/title/created/modified/app/tags`.

## Hardware floor & accessibility

LocalOffice is **benchmarked on the floor, on purpose.** The reference machine is
a roughly 6-year-old (2019-class) thin-and-light: a **15 W mobile CPU (4 cores, 8
threads), 16 GB RAM, integrated-class graphics plus a small 2 GB entry discrete
GPU too weak to accelerate local models**, so AI inference runs on the CPU. The
numbers describe a *power class*, not a brand.

Measured there with [`verify-perf.js`](verify-perf.js) (`node verify-perf.js`):

- **~1,090 KB (≈1.06 MB) for the entire 9-file suite, 0 dependencies, 0 build
  step.** No framework, no DOM-diffing runtime, no bundler. The source *is* the
  app. (The shared modules — core, verify kernel, and the `LocalRender` renderer —
  are *inlined* into each tool rather than loaded, which keeps every file
  standalone at the cost of some duplication.)
- **Cold start (parse to interactive) of about 20 to 330 ms** for eight of the
  nine tools on that CPU; the spreadsheet/formula engine, the heavy one, takes
  about 0.6 s. Roughly **10 MB JS heap** per tool (browser-reported, coarse).
- **No idle work:** zero background polling, zero cloud sync, zero telemetry, zero
  DNS lookups. The only interval timers in the whole suite are sub-second
  AI-progress counters that exist only while a request **you** started is in
  flight, and they are always cleared, so the CPU can drop into deep sleep between
  interactions.
- **Verification is effectively free:** the deterministic kernel runs **300,000
  checks in about 0.24 s (roughly 0.8 µs each)** on that CPU. Because grading is
  math, not an LLM, it **never re-enters the inference path**, so the slow part
  (optional local AI) stays off the critical path entirely.
- **Local AI is patient, and that is the point.** On this CPU (no accelerator) a
  small quantized model decodes at about **5 tok/s (a 3B model)** down to **2.5
  tok/s (a 7B model)**, measured with `node verify-perf.js --ai`. You would never
  put that on a critical path. Here it is *only ever advisory* (draft a slide,
  route prose), so the speed is a non-issue and the deterministic kernel does the
  instant work.

This is a small but real **software/hardware co-design** stance: shape the
workload to the silicon you actually have. The *"AI advises, deterministic math
decides"* split is a scheduling decision (burst the accelerator for generation,
keep grading on cheap low-power cores), and it is what makes a **slow** local
model **useful** on weak hardware, because nothing time-critical waits on
inference.

**Who it's for:**

- People who **choose** to stay local: privacy, data ownership, no cloud, no
  account, no telemetry.
- People who **have** to stay local: old hardware, low or no connectivity, no
  budget for subscriptions.

Both want the same thing, software that runs fully local on modest hardware and
offline, so one tool serves both.

> **Headroom note:** on current GPU/NPU silicon the optional local AI is far
> faster, but those numbers aren't the point and aren't quoted here. The floor is
> the claim; the ceiling takes care of itself.

## Running tests

Run **every suite** with one command. The LocalSheets tool lives here as a
subdirectory, so a single clone of this repo has everything it needs:

```
node run-all-tests.js
```

It executes all suites as child processes and passes only if every suite passes
(exit code plus the parsed `N passed, M failed`). Current state: **1098 passed, 0
failed** across 17 suites. The browser suites need Playwright (dev tooling only):
install it once with `npm i -D playwright && npx playwright install chromium`, or
point `PLAYWRIGHT_DIR` at an existing install. Every tool's File System Access path (`showSaveFilePicker`
to `createWritable`/`write`/`close` to `showOpenFilePicker` to `getFile`) is
covered headlessly via an in-memory FS mock (`fs-mock.js`). The embedded suite
drives each tool in a real iframe and reaches into the frame to confirm it renders
the opened file, **delegates Save back to the Hub** (Ctrl+S posts the serialized
envelope of the right type instead of calling a blocked picker), and (for the
autosaving tools) writes no localStorage shadow while embedded:

| Suite | Checks |
|---|---|
| LocalOffice Hub (dashboard + embed) | 48 |
| LocalOffice embedded (rendering layer + Save delegation) | 26 |
| LocalOffice core (loader/saver) | 33 |
| LocalOffice verify kernel | 33 |
| localDeck (headless browser) | 98 |
| localCards (headless browser) | 100 |
| LocalSheets engine | 143 |
| LocalSheets Store | 58 |
| LocalSheets envelope + interop | 23 |
| LocalSheets app (shipped html) | 46 |
| LocalPlan (envelope + advisory AI) | 51 |
| localMindMap (mindmap + advisory AI) | 88 |
| localMark (image sanitizer) | 32 |
| localCheck (QA runbook) | 36 |
| localDoc (compliance writer) | 82 |
| Templates (sheet/plan presets) | 16 |

Individual suites:

```
node src/test-core.js                 # shared core (no deps)
node src/test-verify.js               # verification kernel (no deps)
node localDeck/verify-deck.js         # localDeck, headless Chromium
node localCards/verify-cards.js       # localCards, headless Chromium
node localSheets/src/test-envelope.js # envelope adapter + cross-tool interop
```

The browser IO layer (file pickers, downloads), the PDF print dialog, a live
Ollama, and the Firefox/Safari fallback are the only paths checked by hand.

Separately, `node verify-perf.js` runs the **footprint and cold-start benchmark**
(28 checks plus a numbers table, see [Hardware floor & accessibility](#hardware-floor--accessibility)).
It is kept out of `run-all-tests.js` on purpose: the timing numbers are
machine-dependent, so it is a report you run on a target machine, not a pass/fail
gate. Its assertions (self-contained files, no idle-timer leaks, clean boot,
near-zero kernel cost) are machine-independent. Add `--ai`
(`node verify-perf.js --ai`) to also measure local-AI decode throughput when a
local Ollama is running.

## License

[MIT](LICENSE). Use it, fork it, sell it, give it away. Each tool's folder has its
own README with the details.
