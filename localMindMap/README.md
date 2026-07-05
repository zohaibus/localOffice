# localMindMap

**A single-file mindmap. Your data stays on your device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](index.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](index.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](index.html)

No accounts. No cloud. No build step. No tracking. One HTML file.

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/localMindMap/index.html"><img src="https://github.com/user-attachments/assets/b2d42bfd-ea91-4d82-839a-8ad518aa9230" alt="localMindMap demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/localMindMap/index.html"><b>▶ Open localMindMap</b></a></p>

---

## What it is

localMindMap is a small, fast mindmapping tool: one HTML file you can open from
disk and use forever. It is part of the **LocalOffice** family, where every tool
reads and writes the same open **`localoffice/v1`** JSON format, so a map you make
here is just a file you own, in a format the other tools understand.

Open the file and you get a central node. Branch out, drag things around, link
related ideas, and save to a file when you want. That's the whole tool.

## What it does

### A canvas you drive

- **Pan:** drag the empty background.
- **Zoom:** scroll the wheel (zooms toward the cursor), or use **− / +**, **Ctrl +
  / −**.
- **Fit:** frame everything on screen (**Ctrl 0**).

Node positions are real data (`x` / `y`) and you place them by dragging. There is
**no automatic layout**; localMindMap never re-arranges your map for you. New
children drop in at a sensible offset, and where they end up is up to you.

### Structure

- A **parent/child tree**: every node remembers its `parent`, drawn as a curved
  link to the node it branches from.
- Optional **cross-links**: labeled connections between any two nodes (the `edges`
  array). Select a node, click **Link**, click the target, type a label.
- **Editable connections:** click any connection (tree link *or* cross-link) to
  **label** it and set a **style** — line, arrow, double-arrow, or dashed — or
  **drag its endpoint** onto another node to re-connect (re-parents a tree link).
- **Shapes & colours:** per-node shape (rounded, rectangle, circle, diamond,
  triangle, logic gates) and a full colour palette (named swatches + custom hex).
  Delete is node-only (children re-parent up); **Shift+Del** deletes the branch.
- Shapes, colours, and connection styles render the same when the map is
  **embedded** in another tool or **exported** (via the shared `LocalRender`).

### Keyboard

| Key | Action |
|---|---|
| `Tab` | Add a child to the selected node |
| `Enter` | Add a sibling |
| `F2` / double-click | Edit the node's text in place |
| `Del` | Delete the node and its subtree |
| `Space` | Collapse / expand the subtree |
| `Ctrl+Z` | Undo the last tidy |
| `Ctrl+S` | Save |

A collapsed node shows a `+N` badge with how many descendants are tucked away.

### Start from a template

The **Templates…** dropdown drops in a ready-made, cleanly laid-out map so you
don't face a blank canvas: **System architecture**, **Incident postmortem
(RCA)**, and **Product roadmap**. All content is neutral and engineering-generic.

### Categorize with color & size

Select a node and pick a swatch in the toolbar to tag it (blue, green, red, amber,
purple, or none). The category is saved as `node.color`, and visual distinction
matters when you are mapping a system (inputs blue, power red, and so on). The **A− /
A+** buttons set a per-node text size (`node.size`: small, medium, large) so
headings can stand out.

### Tidy layout & snap

Maps that come from a template or the AI **Distill to map** feature are placed with
a tidy-tree layout (depth to x, sibling leaves stacked) so branches never overlap.
Turn on **Snap** and nodes round to a grid as you drag them, which is handy for
aligning block diagrams and state machines.

When a map gets messy, **Tidy** re-flows the selected node's branch (its root stays
pinned where you left it) and **Tidy all** re-flows the whole map. Both are
**explicit** (nothing rearranges on its own) and a single **Ctrl+Z** restores the
previous positions. Everyday placement stays manual; you only ever trigger a
re-flow on purpose.

### Images on nodes

Paste a screenshot with **Ctrl+V**, or click **Image**, to attach a picture to the
selected node, such as an oscilloscope trace, a schematic snippet, or a whiteboard
photo. Every image is **re-encoded through a `<canvas>`**, which strips all source
metadata (EXIF/GPS/camera) and downscales it, then stores it inline as base64.
Hover the image and click ✕ to remove it. This makes a saved map a safe,
fully-offline visual lab notebook.

### Touch (tablets and the field)

One-finger drag pans the canvas and moves nodes; two-finger pinch zooms. The whole
tool works on a tablet with no keyboard, handy for disconnected lab or
field-testing use.

### Schematic affordances

For system and architecture sketches, tag a node with a **logic-gate shape** (AND
/ OR / XOR / NOT / MUX) from the toolbar's *shape…* menu, and it renders a gate
glyph (`node.kind`). When you **Link** two gate nodes, the edge **port-anchors**
out to in (`fromPort`/`toPort`) for a signal-flow look instead of centre to
centre. This is a purely visual *diagram* affordance: **no netlist, no
simulation.** The AI's **State machine from code** (below) plots states and
transitions the same way.

### Optional local AI (`✦ AI`)

A fenced, **off-by-default** panel that talks **only to a local
[Ollama](https://ollama.com) at `localhost:11434`**, the single network call in the
app. The AI **proposes and you approve**: nothing changes the map without your
say-so, and everything it returns is validated first.

- **Expand node:** breaks the *selected* node into 3 to 5 sub-components, added as
  children (you confirm) that you then arrange.
- **Distill to map:** paste an RFC, notes, or a transcript, and the model drafts a
  nested map you **preview** before adding it beside your existing content.
- **State machine from code:** paste code (Python, pseudocode, or similar), and the model
  plots the FSM (states to nodes, transitions to labeled port-anchored edges),
  which you preview before adding. A diagram, not a simulation.

Setup: install Ollama, `ollama pull llama3.2`, `ollama serve`. With nothing
running, the panel just reports it can't connect, and the rest of the app is
unaffected.

### Save, open & print

**New**, **Open**, **Save**, **Save As**, and **Print** live in the toolbar
(**Ctrl+S** saves). On Chrome/Edge these use the File System Access API, so **Save**
writes back to the same file in place; on Firefox/Safari they fall back to
download/upload. Files are the shared **`localoffice/v1`** mindmap format
(`*.localoffice.json`), and `localStorage` autosaves as you go.

Unknown fields in a file are **preserved on round-trip**, so opening and saving a
map made by a newer version never silently drops data.

### Light / dark

Toggle with the ☾/☀ button; it follows your system setting until you choose.

## In the LocalOffice Hub

localMindMap also opens inside **`LocalOffice.html`** (the Hub): pick a workspace
folder there, click a map, and it loads here in an iframe. **Save** writes straight
back to that file and **Save As** picks a new one. The Hub performs the write (it
holds the folder handle), so in-place save works even over `file://`. While
embedded, the `localStorage` autosave is **off**, so the opened file is the single
source of truth and no stale per-tool copy can drift across the files you open. Run
standalone and everything behaves exactly as documented here.

**Clipboard:** paste (Ctrl/Cmd-V) a LocalSheets selection, or any TSV or plain
text, and it becomes a **cluster of nodes** (one label per row) under the selected
node, via the shared LocalOffice Clipboard Protocol.

## Privacy

localMindMap makes **no network calls on its own**: no fonts fetched, no analytics,
no update check. It reads and writes `localStorage` and the file you Open/Save. The
**one** exception is the optional **✦ AI** panel: if (and only if) you open and use
it, the app calls a **local** Ollama at `http://localhost:11434`, your own machine,
never a remote server. Leave the panel closed and nothing on the network ever
happens. Verify it yourself: open DevTools, watch the Network tab, use the app
without the AI panel, and watch nothing happen.

## The format

```json
{
  "format": "localoffice/v1",
  "type": "mindmap",
  "meta": { "id": "…", "title": "My map", "app": "localmindmap@1.0", … },
  "body": {
    "nodes": [{ "id", "text", "x", "y", "parent", "collapsed",
                "color?", "size?", "image?", "kind?" }],
    "edges": [{ "from", "to", "label", "fromPort?", "toPort?" }]
  }
}
```

The title lives in `meta.title`; the map itself is `body`. Any other tool in the
family can read the envelope and `meta` even if it can't render the map (graceful
degradation).

## Browser support

Modern Chrome, Edge, Firefox, Safari. **Chrome and Edge** get in-place **Save**
(File System Access API); other browsers fall back to download/upload.

## Repo structure

```
localMindMap/
├── index.html          # The entire application (inlines the shared LocalOffice core)
├── verify-mindmap.js   # Headless (Playwright) verification (122 checks)
└── README.md           # This file
```

## License

[MIT](../LICENSE).
