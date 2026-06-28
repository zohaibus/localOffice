# localCards

**A single-file flashcards app with spaced repetition. Your cards stay on your device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single--file-success.svg)](localCards.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](localCards.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](localCards.html)

No accounts. No cloud. No subscription. No analytics. No tracking. One HTML file.

<p align="center">
  <a href="https://USERNAME.github.io/REPO/localCards/localCards.html"><img src="https://github.com/user-attachments/assets/d69623c0-f19f-4898-9e70-a20c470757ce" alt="localCards demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://USERNAME.github.io/REPO/localCards/localCards.html"><b>▶ Open localCards</b></a></p>

Part of [**LocalOffice**](../README.md), a family of single-file, local-first
tools that share one JSON format (`localoffice/v1`).

---

## Why this exists

Most spaced-repetition apps put your decks on their servers, your study history
behind a login, and (increasingly) grade your answers with a cloud LLM you can't
inspect.

localCards flips that:

- The entire application is **one HTML file**.
- Your deck is **one JSON file** that you own.
- It runs **offline forever**, so you can review on a plane, in the field,
  anywhere.
- Auto-grading is **deterministic and local**, never an LLM and never a network
  call.

---

## Quick start

Download `localCards.html` and double-click it. **Add** a card or **Import** a
list, then hit **Review**. Save your deck to a `.json` file you keep.

- **Chrome / Edge** save and re-open in place (File System Access API).
- **Firefox / Safari** use download/upload instead.

---

## What it does

### Manage: author your deck
A card list plus an editor: front, back, tags, notes, and (optionally) an
**auto-check**. Add / duplicate / delete cards, filter by tag, and see each card's
schedule state (new / due / next-due date).

**Card types & options:**
- **Cloze deletion:** write `The {{mitochondria}} makes {{ATP}}` and the hidden
  words are blanked during review. One click turns the hidden words into a
  deterministic `coverage` check, so *the test writes itself, no AI needed.*
- **Reverse / both-way:** tick "also study reversed" and the card is reviewed both
  front to back and back to front, each with its own schedule.
- **Images:** add a picture to the **front and/or back** by file picker, **drag**,
  or **paste** (Ctrl/Cmd-V a screenshot, such as a scope trace, PCB, or timing
  diagram). Each image is re-encoded through a `<canvas>`, which **strips
  EXIF/GPS/metadata** and downscales it, then embeds it in the card, so the deck
  stays one portable JSON. (Paste lands on the side you're editing. TSV export is
  text-only; images live in the `.json` save.)

**Card-type presets** (the **＋ type…** menu) add a card pre-wired with the right
deterministic check, so you don't have to set it up by hand:

| Preset | What it sets up |
|---|---|
| **Basic Q&A** | Front/back, self-graded |
| **Cloze** | `{{…}}` text becomes an auto `coverage` check from the hidden words |
| **Keyword recall** | A `coverage` check (you fill the required keywords) |
| **Exact term** | An `exact` check (defaults to the back) |
| **Vocab (both-way)** | Reverse on, plus an exact check (type the translation) |

**Visual themes:** a per-deck **card** theme (Midnight / Paper / Slate / Warm),
applied to the study card and saved in the deck. Card overlays (cloze blanks,
notes, tags, dividers) derive from the card's own colors, so text stays legible on
light **and** dark cards.

**App light / dark mode:** a separate ☾/☀ toggle themes the whole UI (panels,
lists, header), remembered across sessions. It is independent of the per-card
theme.

**Zoom the study card:** `−`/`+` in the review bar, **Ctrl** + mouse-wheel, or
**Ctrl** +`=`/`-`/`0`. Good for projectors, low vision, or dense cards.

### Sample decks
The **Sample…** menu loads a starter deck:
- **Feature demo:** one of each card style, to see how the tool works.
- **Science basics** and **World geography:** generic concept decks with
  `coverage` checks, the kind of "explain X, must mention these terms" recall that
  is hard to fake.
- **Language starter:** both-way vocab with exact checks.

### Stats
A **Stats** panel: total cards / review items, new / due / mature / learning
counts, average ease, a due-over-the-next-7-days chart, and **leech** detection
(cards with 4 or more lapses).

### Review: spaced repetition
Hit **Review** to study the cards due today (or all of them). For each card:
- **Self-grade:** reveal the answer (`Space`), then rate recall: **Again / Hard /
  Good / Easy** (`1` to `4`).
- **Typed answer (optional):** if a card has an auto-check, type your answer and it
  is graded instantly, then you still confirm the rating.

Scheduling is **FSRS-lite**: a small, deterministic SM-2-style scheduler
(`interval`, `ease`, `reps`, `lapses`, `state`, `due`). Again resets the card and
records a lapse; Good/Easy grow the interval. (Full FSRS is intentionally
deferred.)

### Auto-checking: the verification kernel
Each card can carry an optional `verify` block using LocalOffice's shared,
**deterministic** verification kernel. v1 supports exactly two comparators:

- **Exact match:** your typed answer must equal the expected answer (case,
  whitespace, and punctuation normalization is configurable).
- **Keyword coverage:** your answer must contain the required keywords. You get a
  score and see which you **hit** and **missed**, with a pass threshold.

```json
"verify": {
  "comparator": "coverage",
  "params": { "required": ["mitochondria", "ATP"], "threshold": 1 },
  "deterministic": true,
  "result": { "pass": null, "score": null, "detail": {} }
}
```

No LLM ever decides correctness; that is a hard rule. `exact` and `coverage` ship
(localCards uses them), and `tolerance` and `hash` (integrity-only) are also built
but deterministic. The `semantic` comparator and the rest (`diff`, `set`,
`signature`, and so on) stay reserved and documented but **not built**.

### Import / Export
Paste a list (one card per line, **Tab**- or comma-separated, `;`-separated tags),
or **merge another deck file**. **Export TSV** writes your cards back out (front /
back / tags), round-tripping to Anki or anywhere else. You own the data.

Importing *from a spreadsheet* is intentionally not in the UI (a cross-type
transform we keep out of v1). But because LocalSheets and localCards share the
same `localoffice/v1` envelope, your data is already liberated: a roughly 10-line
script can map sheet rows into a localCards `cards` array. The shared protocol *is*
the integration.

### Optional local AI, authoring only (✦ AI)
A **fenced** AI panel that talks only to a local [Ollama](https://ollama.com) at
`localhost:11434`, off by default. It helps you *write* cards and **never grades**
(that is always the deterministic kernel). Everything it returns is validated
before it can touch your deck.

- **Distill to deck:** paste a datasheet, RFC, or lecture notes, and the model
  drafts cards *and* their `coverage` keyword checks. Review, then add.
- **✦ AI: keywords from the back** (editor): proposes the required keywords; you
  edit them; the kernel grades from then on.
- **✦ AI: mnemonic** (review, on cards you keep missing): a memory hook appended to
  the card's notes.

Setup: [`OLLAMA_SETUP.md`](OLLAMA_SETUP.md).

---

## Sovereign generation vs. cloud grading

Most modern flashcard apps send your answers to a cloud LLM to *guess* whether you
were right. localCards uses a different architecture: **deterministic grading,
edge AI generation.**

> **The AI writes the test; the math grades the test.**

When you are **studying**, the grading path makes **zero network calls** and never
touches an LLM. A rigorous, reproducible algorithm scores your answer against
*your* required keywords, offline, on any hardware. The **optional** edge AI
(local Ollama) is used strictly to help you *build* the deck: distilling documents
into cards and proposing the keyword checks. Generation can be AI-assisted, but
**the verdict is always deterministic and yours.**

This is the same boundary the whole LocalOffice thesis is built on: advisory AI
*proposes*, deterministic comparators *decide*.

---

## The file format

localCards reads and writes `localoffice/v1` with `type: "flashcards"`:

```json
{
  "format": "localoffice/v1",
  "type": "flashcards",
  "meta": { "id": "…", "title": "…", "app": "localcards@1.0", "tags": [] },
  "body": {
    "deck": { "name": "…" },
    "scheduler": "fsrs-lite",
    "cards": [ { "id", "front", "back", "tags": [], "srs": {…},
                 "verify": {…}?, "frontImg": "data:…"?, "backImg": "data:…"? } ]
  }
}
```

Unknown fields are preserved on round-trip, and any LocalOffice tool can read the
envelope to show the title.

---

## In the LocalOffice Hub

localCards also opens inside **`LocalOffice.html`** (the Hub): pick a workspace
folder there, click a deck, and it loads here in an iframe. **Save** writes
straight back to that file and **Save As** picks a new one. The Hub performs the
write (it holds the folder handle), so in-place save works even over `file://`.
Run standalone and everything behaves exactly as documented here.

## Privacy

While you **study**, localCards makes **no network calls**: scheduling and grading
are entirely local and never call an LLM. The **only** possible network call is the
**optional** ✦ AI panel reaching a **local** Ollama (`localhost:11434`) to help you
*author* cards, and only while that panel is open. Nothing is ever sent to a third
party. Open DevTools, watch the Network tab, and nothing happens until and unless
you use the AI panel.

---

## What's missing on purpose

- LLM / "semantic" answer **grading** (non-deterministic, out of v1 by rule; AI may
  *write* checks, never *decide* them)
- **Cloud** AI of any kind (the optional AI is a local Ollama, authoring only)
- Full FSRS (the lite scheduler is deterministic and good enough for v1)
- Cloud sync, accounts, collaboration, telemetry
- Importing decks *from* spreadsheets (a cross-type transform, deferred)

---

## Folder structure

```
localCards/
├── localCards.html    # The entire application (inlines the shared core + verify kernel)
├── verify-cards.js    # Headless (Playwright) verification, 100 checks
├── OLLAMA_SETUP.md    # One-time local-AI setup (optional)
└── README.md          # This file
```

The shared loader/saver and verification kernel live one level up at
[`../src/core.js`](../src/core.js) and [`../src/verify.js`](../src/verify.js);
localCards inlines a copy of each (the single-file rule means no `<script src>`).

### Verifying

```bash
node localCards/verify-cards.js     # the app (headless Chromium)
node ../src/test-verify.js          # the verification kernel (no deps)
```
