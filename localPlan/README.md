# LocalPlan

**A single-file personal planner. Your data stays on your device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](index.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](index.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](index.html)
[![PWA](https://img.shields.io/badge/PWA-installable-blueviolet.svg)](index.html)

No accounts. No cloud. No subscription. No analytics. No tracking. One HTML file.

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/localPlan/index.html"><img src="https://github.com/user-attachments/assets/65187345-cdd0-4c26-9403-527a5ba7ee4f" alt="LocalPlan demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/localPlan/index.html"><b>▶ Open LocalPlan</b></a></p>

Part of [**LocalOffice**](../README.md), a family of single-file, local-first
tools that share one JSON format (`localoffice/v1`).

---

## Why LocalPlan feels different

Most planning tools assume their service survives, their company survives, and your
account survives.

LocalPlan assumes the opposite: **you keep the file.** No login to lose, no
subscription to cancel, no server to go down. Your plan is a file on your device,
readable in any text editor, backed up wherever you want, yours forever.

---

## Quick start

Download `index.html` and double-click it. No install, no server, no network. It
works straight from `file://`. Pick a starter pack or start blank.

- **Chrome / Edge** save and re-open in place (File System Access API).
- **Firefox / Safari** use download/upload instead.

Your data also auto-saves to that browser's local storage as you go, so nothing is
lost between saves.

---

## What it does

### Tracks, sections, items

Organize life into **tracks** (work, family, health, hobbies, whatever you
decide). Each track contains **sections** by time horizon (Now, Soon, Later,
Someday). Each section contains the actual **items** you are tracking.

### Today view

Star any item to add it to **Today**. The ★ Today view filters across all tracks
to just the things you have prioritized.

### Inline editing

Click any text (the plan title, a track name, an item, a note) and edit in place.
Enter to save, Escape to cancel.

### Drag and drop

Drag items within a section to reorder, across sections to change priority, or
across tracks to reorganize. Drag whole tracks to put what matters most at the
top.

### Notes on items

Add a note to any item with the `+ add note` button. Click `more` to expand, click
the note to edit, leave it blank to remove.

### Search

Press `/` anywhere to focus the search bar. Type to instantly filter all tracks,
sections, and items, including notes. Press Escape to clear.

### Undo / redo

Every edit is undoable: **Ctrl+Z** to undo, **Ctrl+Y** (or **Ctrl+Shift+Z**) to redo,
plus the **↶ / ↷** toolbar buttons. It snapshots the whole plan on each change, so
adds, deletes, reorders, edits, stars, and notes all roll back cleanly. While you are
typing in a field, Ctrl+Z does the normal in-field text undo; once you commit, it
steps through document changes. Opening a different file starts a fresh history.

### Recurring tasks

When adding an item, set a recurrence: **Daily**, **Workdays**, **Weekly**,
**Monthly**, or **Yearly**. When you check it off, it records the completion date
and resets automatically the next time it is due. No backend needed; the reset
happens on load.

### Paste a list

Click **Paste a list** in the toolbar to open the import modal. Paste any
plain-text list (same format as the braindump script) and it imports directly into
your plan without leaving the browser.

### Review mode

Click **Review** in the toolbar for a cross-track status view: **Active** (all Now
and Soon items not done), **Sleeping** (all Someday items), and **Completed** (all
checked items). Pure filtered rendering, no new data, just a different lens on what
is already there.

### Save, open & print

The toolbar has **Save**, **Save As**, and **Open** (plus **Ctrl+S**). On
Chrome/Edge these use the File System Access API, so **Save** writes back to the
same file in place; on Firefox/Safari they fall back to download/upload. Files are
the shared **`localoffice/v1`** plan format (`*.localoffice.json`), and
`localStorage` keeps auto-saving as you go.

**Print / PDF** lays the plan out cleanly (toolbar/search/menus hidden) and opens
your browser's print dialog; choose "Save as PDF" for a shareable copy.

### Zoom & dark mode

Zoom the whole plan with the toolbar **− / +**, **Ctrl + / −**, or **Ctrl 0** to
reset. It scales width *and* height to fill the screen, and the level is
remembered. Toggle **light / dark** with the ☾/☀ button; it also follows your
system setting, and the first-run brain-dump screen has its own toggle.

### Welcome card and starter packs

On first run, dump whatever is in your head and the app organizes it
automatically. Or skip to choose a tailored, pre-configured life structure:

- **Engineer:** Career, Deep Work, Learning, Health, Life
- **Founder:** Product, Users, Capital, Ops, Life
- **Parent:** Kids, School, Home, Health, Life
- **Balanced Life:** Focus, Health, Family, Creative, Legacy
- **Blank:** start with nothing, build your own structure

### Mobile

Works in any mobile browser: iOS Safari, Android Chrome, Firefox mobile. Same
file, smaller screen, all features available.

When hosted on HTTPS, LocalPlan is **installable as a PWA**: tap "Add to Home
Screen" and it runs like a native app with its own icon. It also follows your
browser/system light or dark mode and lets you switch manually.

---

## Cross-device usage

LocalPlan stores data in the browser's local storage on whichever device opens it.
To use the same plan across devices:

| Method | How |
|---|---|
| **Manual** | Save to a file on your phone, send it to yourself, **Open** it on your laptop. |
| **Cloud folder** | Save `your-plan.localoffice.json` to a synced folder (iCloud Drive, Google Drive, Dropbox); **Open** it from there on either device. |
| **Git** | Commit the JSON to a private repo. Diff history, version control, and sync in one. |

Real-time sync is a non-goal. The friction of manual backup is the feature: it
makes you own your data, not assume someone else does.

---

## Bulk import from a brain dump

Got a list in your head and don't want to type each item? Use the Python script:

```bash
python3 braindump.py
```

Paste your brain dump in this format:

```
home: plan meals (priority)
home: grocery run
home: deep clean kitchen [Soon]
family: schedule pediatrician -- needs flu shot
family > Now: pickup roster for soccer
self: book annual physical
wellness: daily journaling (priority)
```

Press Ctrl+D (Mac/Linux) or Ctrl+Z then Enter (Windows). The script writes a JSON
file. In LocalPlan, click **Open** and pick the file. (Or paste the list straight
into the **Paste a list** modal, no file needed.)

### Brain dump format

| Syntax | Effect |
|---|---|
| `track: item text` | Adds to the Now section of the named track |
| `track: item text (priority)` | Adds with a star (Today view) |
| `track: item text [Soon]` | Adds to the Soon section (Now, Soon, Later, Someday) |
| `track: item text -- note text` | Adds an italicized note |
| `track > Section Name: item text` | Use an exact section name (creates if needed) |
| `# comment` | Ignored |

Tracks that don't exist are created automatically. The first character of the
track name becomes the icon (override later in the UI).

### Merge into an existing plan

```bash
python3 braindump.py new-items.txt -m my-plan.json -o merged.json
```

This adds items from `new-items.txt` into your existing plan without erasing
anything. See [`braindump.example.txt`](braindump.example.txt) for a full example.

### Local AI (optional, Ollama)

LocalPlan has an optional **✦ AI** panel (toolbar button) that talks **only to a
local [Ollama](https://ollama.com) at `localhost:11434`**, the single network call
in the whole app. It is **off by default**, and the AI **never changes your plan on
its own; it proposes, you apply.** Everything it returns is validated before it can
touch your data. Nothing leaves your machine.

Three advisory features:

- **Distill to plan:** paste messy notes, an email, or raw thoughts, and the model
  drafts them as braindump lines, which you **review and edit** before they go
  through the same importer as the **Paste a list** modal.
- **✦ break down:** on any item row (next to *+ add note*), break a heavy task into
  3 to 5 concrete steps; you confirm before they are inserted beneath it.
- **Suggest priorities:** picks the few highest-leverage tasks from your active
  Now/Soon items; ids are validated against what was sent (hallucinated ids are
  dropped) and you click **Star these** to apply.

Setup: install Ollama, then `ollama pull llama3.2` and `ollama serve`. With no
Ollama running the panel simply reports it can't connect, and the rest of the app
is unaffected. Prefer a different runtime or a cloud model? You can feed any
model's output straight into the **Paste a list** modal. See
[`ai/SYSTEM_PROMPT.md`](ai/SYSTEM_PROMPT.md) for a ready-made system prompt.

---

## In the LocalOffice Hub

LocalPlan also opens inside **`LocalOffice.html`** (the Hub): pick a workspace
folder there, click a plan, and it loads here in an iframe. **Save** writes
straight back to that file and **Save As** picks a new one. The Hub performs the
write (it holds the folder handle), so in-place save works even over `file://`.
While embedded, the `localStorage` autosave is **off**, so the opened file is the
single source of truth and no stale per-tool copy can drift across the files you
open. Run standalone and everything behaves exactly as documented here.

## Privacy

LocalPlan makes **no network calls on its own**. It does not load remote fonts,
send analytics, check for updates, or include any tracking.

What the application does:

- Reads and writes to `localStorage` on whichever device runs it
- Writes a `localoffice/v1` JSON file when you **Save / Save As** (in place on
  Chrome/Edge via the File System Access API, or a download elsewhere)
- Reads a JSON file when you **Open** one

The **one** exception is the optional **✦ AI** panel: if (and only if) you open and
use it, LocalPlan calls a **local** Ollama at `http://localhost:11434`, your own
machine, never a remote server. Leave the panel closed and nothing on the network
ever happens. Verify it yourself: open DevTools, watch the Network tab, use the app
without the AI panel, and watch nothing happen.

---

## Browser support

Modern browsers from the last few years: Chrome, Firefox, Safari, Edge. **Chrome
and Edge** get in-place **Save** (File System Access API); other browsers fall back
to download/upload.

**Safari on iOS** has a quirk: when an HTML file is opened directly from disk (not
from a domain), it can clear `localStorage` after about 7 days of inactivity. To
avoid it, host LocalPlan on a domain (iOS then treats it as a normal site and
storage persists), or **Save** to a file regularly.

---

## Core architectural boundaries

LocalPlan does **not** have:

- Real-time collaboration (would require a backend)
- Push notifications (browsers can't do this reliably offline)
- Calendar integration (would compromise the offline guarantee)
- Native mobile apps (the HTML works in mobile browsers)
- Cloud AI (no cloud model, no API key; the optional **✦ AI** panel talks only to a
  *local* Ollama, and AI never edits your plan without your approval)
- Login/accounts (no servers means no accounts)
- Cloud sync (use a cloud-synced folder if you want this)

If you need any of these, use Notion, Todoist, Things, Obsidian, or another
excellent option. LocalPlan is for people who want the no-backend, no-account,
single-file model.

---

## Repo structure

```
localPlan/
├── index.html              # The entire application (inlines the shared LocalOffice core)
├── verify-plan.js          # Headless (Playwright) verification (55 checks, incl. undo/redo, mocked-Ollama AI + mocked-FS round-trip)
├── braindump.py            # Optional bulk import script
├── braindump.example.txt   # Example brain dump showing all syntax
├── ai/SYSTEM_PROMPT.md     # System prompt for local LLM integration
├── qa/                     # QA harness for braindump.py regression tests
└── README.md               # This file
```

## License

[MIT](../LICENSE). Use it, fork it, sell it, give it away. Just don't pretend you
wrote it from scratch.

---

If LocalPlan helps you, the best way to say thanks is to share it with one other
person who'd appreciate owning their own tools.
