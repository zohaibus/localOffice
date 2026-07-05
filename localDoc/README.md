# localDoc

**A single-file writer with two modes: a basic Markdown word processor, and a compliance-gated engineering-doc tool where export is earned.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](index.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](index.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](index.html)

No accounts. No cloud. No build step. No tracking. One HTML file.

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/localDoc/index.html"><img src="https://github.com/user-attachments/assets/0b9eab42-628c-416e-8367-e44bc4523b6d" alt="localDoc demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/localDoc/index.html"><b>▶ Open localDoc</b></a></p>

---

## What it is

localDoc is a **block-based writer** (heading + prose sections) with two modes,
chosen per document via `body.docMode`:

- **Prose** - a **WYSIWYG word processor**: type and see formatting live (like a
  word processor), get a word count, export clean Markdown. No gating.
- **Compliance** (default) - the same sections, plus a **compliance linter**:
  give a section a required-keywords rule and the document **cannot be exported**
  until that section actually contains them, checked by the deterministic
  `coverage` kernel, never an LLM.

Three layers, one document: **WYSIWYG** is the editing surface; **Markdown** is the
saved format (toggle **Source** to edit it raw); **JSON** is the envelope inspector.
Part of the LocalOffice family, it reads/writes `localoffice/v1` (`type: "doc"`).

## What it does

### Open and just type (WYSIWYG)

**New** drops you straight onto a ready-to-type blank page - no setup, no template
first. Type and **formatting shows live**, like a word processor; no Preview button.
Add **sections** (heading + prose), reorder them, remove them. Toggle **Source** any
time to edit the raw Markdown, and **JSON** to see the whole envelope.

### Formatting bar

A toolbar under the main bar formats the **selection**:

- **Bold / Italic / Code / Heading / List / Numbered list / Quote / Link** -
  applied live in Visual mode; **Ctrl/Cmd+B** and **Ctrl/Cmd+I** too. In **Source**
  mode the same buttons wrap the selection in Markdown.
- **Color** applies to the selection. **Font / Size** apply to the whole document
  in Visual mode (live), or to the selection in Source mode.

**Undo / redo** (**Ctrl+Z**, **Ctrl+Y** / **Ctrl+Shift+Z**, plus toolbar buttons)
is reliable across typing, formatting, and structural edits in both modes - it
snapshots the whole document rather than relying on the browser's flaky
contentEditable undo.

However it's edited, the document is **saved as clean, git-diffable Markdown** (an
HTML<->Markdown layer converts on the fly). The body is plain CommonMark; the only
non-Markdown is inline styling, kept as a `<span style>` re-validated down to a hex
color, an integer `px` size, or a known font - everything else is escaped, so the
file stays clean and rendering it can't inject anything.

Markdown that localDoc itself wrote **round-trips with true identity** (tested):
reopening a file and toggling Source <-> Visual never churns the diff. Markdown from
*elsewhere* is canonicalized to that house style on the first toggle - emphasis
becomes `*`, list markers become `-` - and is stable forever after; so a one-time
style normalization is the only diff you'll see on a foreign `.md`, never drift.

A portability note on the style spans: the **bytes are portable, the colors are
not**. The `<span style>` is safe and re-validated in localDoc's own renderer, but
another Markdown renderer (GitHub, a static-site generator, pandoc) may strip it -
so the color silently drops there - or render it on its own terms. Treat the styling
as a localDoc convenience, not a cross-renderer guarantee; the text is universal.

### Prose mode (word processor)

**Prose mode** is free writing: the compliance scaffolding is hidden, the bottom
bar shows a **word / character count**, and export is always open. Start blank, or
from the **Letter** or **Meeting notes** templates.

### Compliance linter (the other point)

Any section can carry a **required-keywords** rule. The shared `coverage`
comparator checks each gated section, a live badge shows **compliant / missing**,
and **Markdown export is blocked** until every gated section passes. For example,
an RCA's *Mitigation* section can require `patch` and `deploy`, so you can't ship
the postmortem until it actually says what was patched and deployed. The verdict
is the math, offline and reproducible. (The rules use the literal **stem** -
`deploy`, not `deployed` - so natural inflections in your prose still count; see
the matching edges below.)

**Matching is whole-word, case-insensitive** (the linter opts into the kernel's
`wordBoundary` mode). A keyword is matched at a word boundary, so a `patch` rule is
**not** satisfied by `dispatched` and a `deployed` rule is not satisfied by
`redeployed` - the gate can't be beaten by word-salad. Suffixes still count, so
`patch` is satisfied by `patched` and `deploy` by `deploys`. The gate is only as
good as the keywords you pick, but it can't be gamed by an unrelated word that
merely contains the keyword.

Known, deliberate edges of that rule (pinned by tests): a **hyphenated compound
does** count, because the hyphen is a word boundary - `hot-patch` satisfies `patch`,
`auto-deployed` satisfies `deployed`. Matching is suffix-tolerant only, so
**front-inflected** forms do **not** count - `redeployed` does not satisfy
`deployed` - and **irregular** morphology is invisible - `built` does not satisfy
`build`. These are false-negatives by design: pick the literal stem you want in the
rule (`deploy`, not `deployed`) and inflected forms fall in line.

**Authoring a rule (the policy):** *stem the verbs, leave the nouns.* Verbs
conjugate (`deploy`/`deployed`/`deploying`), so use the stem and suffix-tolerance
absorbs the rest; nouns (`cause`, `patch`, `risk`) don't inflect in ways that
matter and their plurals are already covered, so stemming them buys nothing and
risks over-accepting. The shipped templates follow this, and a test fails the build
if a template keyword regresses to a conjugated form. Matching scans the **section's
prose** (including code fences and inline `##` headings - if the keyword is written
anywhere in the body it counts); the block's own heading is not scanned.

**Malformed rules fail closed.** A `required` value that can't be read as a real
keyword list - a number, an object, an all-junk array - does **not** silently drop
the gate; the section is held non-compliant until the rule is fixed. A bare string
(`"required": "patch"`) is read charitably as one keyword. The gate only ever
errs toward *blocking*, never toward a false pass - that direction is the point.

### Templates

- **Document (prose):** Blank document, Letter, Meeting notes.
- **Incident postmortem (RCA):** Root cause / Mitigation / Prevention, pre-wired
  with keyword rules.
- **Engineering design doc:** Goals / Design / Risks.
- **Technical proposal (RFC):** Summary / Motivation / Design / Alternatives.

### Optional local AI (`✦ AI`)

Paste a raw transcript or notes and the model **routes** the text into your
existing sections, shown as a preview you approve before it fills anything. The AI
drafts prose, but **the compliance verdict is always the kernel's**, never the
AI's. It talks only to a local Ollama at `localhost:11434` (off by default).

### Export & files

**Export MD** writes clean Markdown (always in prose mode; in compliance mode only
once every gated section passes). New / Open / Save / Save As (`Ctrl+S`) write the
`localoffice/v1` doc envelope. Light/dark. Opens inside the **LocalOffice Hub**
with in-place save.

## The format

```json
{
  "format": "localoffice/v1",
  "type": "doc",
  "meta": { "id": "…", "title": "Incident Postmortem", "app": "localdoc@1.0", … },
  "body": {
    "docMode": "compliance",          // "prose" | "compliance" (default); absent = compliance
    "style": { "font": "sans", "size": "md", "color": "" },   // document typography (optional)
    "blocks": [
      { "id", "heading": "Root cause",  "text", "required": ["cause"] },
      { "id", "heading": "Mitigation",  "text", "required": ["patch", "deploy"] }
    ]
  }
}
```

## Privacy

localDoc makes **no network calls on its own**. The only exception is the optional
**✦ AI** panel, which talks to a **local** Ollama if you open and use it. Leave it
closed and nothing touches the network.

## Repo structure

```
localDoc/
├── index.html     # The entire application (inlines the core + coverage kernel)
├── verify-doc.js  # Headless (Playwright) verification (104 checks)
└── README.md      # This file
```

## License

[MIT](../LICENSE).
