# localDeck

**A single-file slide deck editor. Your data stays on your device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single--file-success.svg)](localDeck.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](localDeck.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](localDeck.html)

No accounts. No cloud. No subscription. No analytics. No tracking. One HTML file.

<p align="center">
  <a href="https://USERNAME.github.io/REPO/localDeck/localDeck.html"><img src="https://github.com/user-attachments/assets/86455c39-4767-4d14-972a-7af8f5f14e9c" alt="localDeck demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://USERNAME.github.io/REPO/localDeck/localDeck.html"><b>▶ Open localDeck</b></a></p>

Part of [**LocalOffice**](../README.md), a family of single-file, local-first
tools that share one JSON format (`localoffice/v1`).

---

## Why this exists

Most presentation tools want your slides on their servers, your access behind
their login, and your money in their subscription, and they quietly stamp your
name, account, and machine into the files you export.

localDeck flips that:

- The entire application is **one HTML file** (about 80 KB).
- Your deck is **one JSON file** that you own.
- It runs **offline forever**.
- It costs **nothing**, ever.
- **Exports are anonymous by construction.** No author, user, machine, or
  timestamps ever leave the tool.

Open the file, pick a template or start blank, type content, pick a layout per
slide, reorder, drop in a screenshot, present, export. That's the whole tool.

---

## Quick start

Download `localDeck.html` and double-click it. No install, no server, no network.
It works straight from `file://`.

- **Chrome / Edge** save and re-open files in place (File System Access API).
- **Firefox / Safari** use download/upload instead: same features, one extra click
  to save.

---

## What it does

### Structured authoring, not a canvas

You don't drag boxes around a blank slide. You **type content into fields and pick
a layout**: Title, Title + Bullets, Two columns, Section, Quote, Image, Image +
caption, Text + image, Code, **Table**, or Blank. The layout owns the geometry, so
slides stay consistent and "easier" is the point. It is deliberately *not* a
freeform canvas; that's the design, not a limitation.

A three-pane editor: slide list (left), live preview (center), and an inspector
(right) with the current slide's fields, the layout picker, theme, and footer.

### Pictures: dropped, pasted, and scrubbed clean

Add an image by **file picker, drag-onto-the-slide, or paste a screenshot**
(Ctrl/Cmd-V). Every image is re-encoded through a `<canvas>`, which:

- **strips all metadata** (EXIF, GPS coordinates, camera serial, author), so a
  photo can't leak who or where you are, and
- **downscales and compresses it** (longest side 1600px) so your JSON file doesn't
  balloon.

The picture is embedded in the deck file, so the deck is still one portable JSON.

### Code blocks

Paste code and it keeps its indentation, in a monospace block with an optional
**language label**, **line numbers**, and S/M/L sizing. No syntax-highlighting
library, so there is nothing to pull in and nothing to break.

### Speaker notes

Every slide has notes. They are saved in the file and shown in **presenter view**
(press `N` while presenting), and they are **never written into the HTML export**.
Your talk track stays yours.

### Undo / redo, footer, slide numbers

Full undo/redo (`Ctrl+Z` / `Ctrl+Y`). Optional deck footer and slide numbers,
toggleable, on by default in exports.

### Templates

Start from **Engineering design review**, **Incident postmortem (RCA)**, **Sprint
demo / status**, or **Research / field report**. They are embedded in the file
(offline can't fetch), so the menu works with no network.

### Present, and export

- **Present:** fullscreen, arrow keys, click to advance. Two modes: **Present**
  (slide only) and **▶ + Notes** (presenter view with your speaker notes, the
  slide counter, and the next slide on the side). `N` toggles notes in either.
- **Export HTML:** a standalone single-file deck with keyboard/click navigation.
  Hand it to anyone; it needs nothing installed.
- **Export PDF:** the browser's own print, "Save as PDF" (one slide per page). No
  PDF library.

Both exports are **anonymous-clean**: only the deck title, slide content, and
theme go out. No identifying metadata, no speaker notes.

### Optional local AI

Click **✦ AI** to use a model running on your own machine via
[Ollama](https://ollama.com) at `localhost:11434`. It is the only network call
localDeck ever makes, it is entirely optional, and **the AI never changes your
deck on its own**: it proposes, you apply, and it's undoable.

- **Assist:** freeform help; insert the reply into the focused field or notes.
- **Draft slide:** a reviewed JSON patch for the current slide's fields.

One-time setup (allowing `file://` to reach Ollama): see
[OLLAMA_SETUP.md](OLLAMA_SETUP.md).

---

## The file format

localDeck reads and writes `localoffice/v1` with `type: "slides"`:

```json
{
  "format": "localoffice/v1",
  "type": "slides",
  "meta": { "id": "…", "title": "…", "created": "…", "modified": "…", "app": "localdeck@1.1", "tags": [] },
  "body": { "theme": {…}, "footer": {…}, "slides": [ { "id", "layout", "blocks": [...], "notes": "" } ] }
}
```

It preserves fields it doesn't recognize on round-trip, and any LocalOffice tool
can at least read the envelope to show the title and offer a hand-off.

---

## In the LocalOffice Hub

localDeck also opens inside **`LocalOffice.html`** (the Hub): pick a workspace
folder there, click a deck, and it loads here in an iframe. **Save** writes
straight back to that file and **Save As** picks a new one. The Hub performs the
write (it holds the folder handle), so in-place save works even over `file://`.
Run standalone and everything behaves exactly as documented here.

**Clipboard:** paste (Ctrl/Cmd-V) a LocalSheets selection, or any TSV, and it
becomes a **table slide**; plain multi-line text becomes a **bullets slide**, via
the shared LocalOffice Clipboard Protocol.

## Privacy

localDeck does not connect to the internet, load remote fonts, send analytics,
check for updates, or include any tracking. The **only** possible network call is
to a local Ollama you opt into, on your own machine.

What it does:

- Reads and writes JSON deck files you choose (File System Access API, or
  download/upload on Firefox/Safari)
- Re-encodes imported images locally to strip their metadata
- Optionally talks to `localhost:11434` if you open the AI panel

Verify it yourself: open DevTools, watch the Network tab, use the app, and watch
nothing happen (until and unless you use AI).

---

## Browser support

Modern browsers from the last few years: Chrome, Firefox, Safari, Edge. Chrome and
Edge get in-place file save; everything else uses download/upload. Container
queries are used for slide scaling, so a current browser is recommended.

---

## What's missing on purpose

localDeck does **not** have:

- Real-time collaboration (would require a backend)
- Accounts or login (no servers means no accounts)
- Cloud sync (use a cloud-synced folder for the JSON if you want this)
- Telemetry or "usage improvement" data (none, ever)
- **Cloud AI.** The optional AI is a **local** Ollama only; no prompts or slides
  are sent to any third party.
- A freeform drag-and-drop canvas (structured layouts are the design)

If you need those, use Google Slides, PowerPoint, or Keynote. localDeck is for
people who want the no-backend, no-account, single-file model.

---

## Folder structure

```
localDeck/
├── localDeck.html     # The entire application (about 80 KB, inlines the shared core)
├── verify-deck.js     # Headless (Playwright) verification, 98 checks
├── OLLAMA_SETUP.md    # One-time local-AI setup (optional)
└── README.md          # This file
```

The shared loader/saver lives one level up at [`../src/core.js`](../src/core.js);
localDeck inlines a copy of it (the single-file rule means no `<script src>`).

### Verifying

```bash
node localDeck/verify-deck.js
```

98 checks run in headless Chromium (Playwright; install it from the repo root, see
the main README). The AI path is exercised with a **mocked** Ollama stream, so the
suite passes whether or not Ollama is installed.
A live Ollama, the PDF print dialog, and the Firefox/Safari download fallback are
the only paths that need a manual click.

---

## License

[MIT](../LICENSE). Use it, fork it, sell it, give it away. Just don't pretend you
wrote it from scratch.

---

If localDeck helps you, the best way to say thanks is to share it with one other
person who'd appreciate owning their own tools.
