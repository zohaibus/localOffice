# localoffice/v1 Envelope Specification

**Status:** v1 (stable). **License:** MIT. **Compatibility rule:** unknown fields
are preserved on round-trip (forward-compatible); consumers must not drop them.

## 1. Purpose

`localoffice/v1` is a single JSON envelope that every LocalOffice tool reads and
writes. The envelope carries a top-level `type`, a universal `meta` header, and a
typed `body`. Tools dispatch on the top-level `type`; a tool that does not
recognize a type degrades gracefully (shows the title, offers hand-off) rather
than failing.

Design intent: one format, many thin tools; the format is the contract, the tools
are interchangeable layers on top of it.

## 2. Top-level shape

```json
{
  "format": "localoffice/v1",
  "type":   "sheet",
  "meta":   { ... },
  "body":   { ... }
}
```

- `format` (string, required): MUST equal `"localoffice/v1"`.
- `type` (string, required): the payload type; selects the `body` schema (Section 4).
- `meta` (object, required): universal header (Section 3).
- `body` (object, required): typed payload; its shape depends on `type` (Section 4).

A document is **valid** iff `format` equals `"localoffice/v1"`, `type` is a
non-empty string, and `meta` satisfies Section 3. Body-internal validity is the
owning tool's concern; the envelope layer validates only the contract above.

## 3. `meta` (universal header)

When indexing a folder, the Hub reads ONLY the top-level `type` and this `meta`
header. The `body` is never parsed, and nothing leaves the machine.

| Field      | Type    | Req | Notes |
|------------|---------|-----|-------|
| `id`       | string  | yes | Stable unique id (uuid or slug). |
| `title`    | string  | yes | Human title, shown on Hub cards. |
| `created`  | string  | yes | ISO-8601. |
| `modified` | string  | yes | ISO-8601. |
| `tags`     | array   | no  | Strings; used for Hub filter/sort. |
| `app`      | string  | no  | Producing tool id (e.g. "localdeck@1.0"). |

(`type` lives at the top level, NOT inside `meta`.)

**Privacy invariant:** exports MUST NOT stamp identifying metadata
(author/user/machine). Only `id`, `title`, `created`, `modified`, `app`, and
`tags` may persist.

## 4. `body` (typed payload)

The top-level `type` selects the payload schema. Registered v1 types:

| `type`        | Owning tool  | Payload summary |
|---------------|--------------|-----------------|
| `slides`      | localDeck    | ordered slides, each a layout + content blocks. |
| `flashcards`  | localCards   | cards, each with an optional deterministic check spec. |
| `sheet`       | LocalSheets  | one or more sheets of cells + formulas. |
| `plan`        | LocalPlan    | tracks, each with horizon sections of items. |
| `mindmap`     | localMindMap | node tree (each node's `parent`) plus `edges` cross-links. |
| `image`       | localMark    | raster `base` + vector overlays + calibration `scale`. |
| `runbook`     | localCheck   | steps (check/measure/note) + gate rules + integrity `seal`. |
| `doc`         | localDoc     | blocks (heading/prose) + coverage rules. |

New body types MAY be added without a version bump provided the top-level shape
(Section 2) and `meta` (Section 3) are unchanged; unknown types degrade
gracefully per Section 1.

## 5. Nested envelopes (embeds)

A body MAY embed another document as a child by nesting a full `localoffice/v1`
envelope at a body-defined location (for example, a deck slide embedding a
`sheet`, or a mind map inside a `doc`). Nested envelopes:

- MUST themselves be valid per this spec.
- MUST round-trip on save/load (the host preserves them verbatim, including
  unknown fields).
- Are drawn by the shared static renderer for editor + export parity; the object
  is edited by opening its owning tool, never re-implemented by the host.

## 6. Clipboard fragment: `localoffice/clip-v1`

Distinct from the storage envelope. On copy, a tool MAY emit a `clip-v1` fragment
smuggled in `text/html` (a `[data-localoffice]` span) alongside plain TSV/text.
On paste, a consumer reads the fragment, or falls back to the plain text. Paste is
always explicit (Ctrl/Cmd-V); nothing is auto-generated.

## 7. Determinism boundary (normative)

Where a tool grades, gates, or verifies content, that decision MUST be made by
deterministic code, never by a language model. A model MAY propose body content;
the deterministic layer decides correctness. This is a hard rule of the format's
tools, surfaced here so third-party implementers preserve it: **AI advises,
deterministic code decides.**

## 8. Versioning

- `format` is the version axis. `localoffice/v1` is frozen for breaking changes.
- Additive, backward-compatible changes (new optional `meta` fields, new `type`s)
  do NOT bump the version.
- A breaking change (renamed or removed required field, changed contract) would
  ship as `localoffice/v2`; tools SHOULD read v1 and migrate transparently on
  open, writing the current version forward (the pattern LocalSheets uses for its
  legacy format today).

## 9. Conformance

An implementation conforms iff it: validates per Sections 2 and 3, preserves
unknown fields on round-trip, honors the privacy invariant (Section 3), respects
the determinism boundary for any gating it performs (Section 7), and degrades
gracefully on an unknown top-level `type` (Section 1).
