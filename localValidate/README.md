# localValidate

**Check any `localoffice/v1` file against the spec. One HTML file, offline, no dependencies.**

Paste an envelope, get a **pass / warn / fail** verdict plus a per-rule breakdown of
exactly which conformance rule it satisfies or violates, keyed to the sections of
[`SPEC.md`](../SPEC.md). It runs entirely in the browser: nothing is uploaded, and
it makes zero network requests.

## What it checks

- **Section 2 (top-level shape):** `format` equals `"localoffice/v1"`, `type` is a
  non-empty string at the top level, `meta` and `body` are objects.
- **Section 3 (`meta` header):** `id` / `title` strings, `created` / `modified`
  ISO-8601, optional `tags` (array) and `app` (string), and the **privacy
  invariant** (no identifying fields such as `author` / `user` / `email` /
  `machine` in `meta`). It also flags a `type` mistakenly placed inside `meta`.
- **Section 4 (type registry):** whether `type` is one of the registered v1 types;
  an unknown type is a *warning*, not a failure (Section 1 graceful degradation).
- **Section 5 (embeds):** any nested `localoffice/v1` envelope is found and
  validated too; an invalid embed fails the whole document.
- **Sections 7 & 9 (determinism boundary, unknown-field preservation):** surfaced
  as informational - they are properties of the consuming tool, not statically
  checkable from a single file.

## Verdict

- **Conforms** - all required rules pass, no privacy violation.
- **Conforms with warnings** - valid, but something is non-canonical (unknown
  type, `meta.type`, malformed optional field).
- **Does not conform** - a required rule (Section 2 or 3) failed, a privacy field
  is present, the JSON is invalid, or a nested embed is invalid.

## Files

```
localValidate/
├── index.html          # The whole app (single file, no deps)
└── verify-validate.js  # Headless (Playwright) verification (31 checks)
```

Verify headlessly: `node localValidate/verify-validate.js` (31 checks) - the happy
path for every registered type, each Section 2-3 failure, the privacy rule, the
warning cases, nested-embed validation, invalid JSON, load-a-file / drag-and-drop,
the Hub embed handoff (opened in a real iframe), and the offline guarantee.

MIT. Part of the [LocalOffice](../README.md) suite.
