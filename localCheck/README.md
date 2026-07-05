# localCheck

**A single-file QA runbook. The math decides whether you can sign off.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](index.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](index.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](index.html)

No accounts. No cloud. No build step. No tracking. One HTML file.

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/localCheck/index.html"><img src="https://github.com/user-attachments/assets/2bb80b70-57ff-4773-8467-60eae769b5cd" alt="localCheck demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/localCheck/index.html"><b>▶ Open localCheck</b></a></p>

---

## What it is

localCheck is an interactive **SOP / QA runbook**: the LocalOffice verification
kernel made into a product. Instead of a static PDF checklist or a cloud form,
each measurement is **gated deterministically by the kernel**, and you **cannot
sign the file off until every gating step passes.** It is part of the LocalOffice
family and reads/writes `localoffice/v1` (`type: "runbook"`).

## What it does

### Three kinds of step

- **Check:** tick a box to confirm (for example, *"Board visually inspected"*).
- **Measure:** type a reading and the kernel grades it (see below).
- **Note:** free text that never blocks sign-off.

### The deterministic gate

Every **Measure** step is graded by the shared kernel, **never an LLM**:

- **`tolerance`:** a numeric reading within bounds, either a range (*ambient
  temperature between 18 and 24*) or a target with tolerance (*100 ± 2*). Units are
  parsed out, so `23.5 C` reads as `23.5`.
- **`exact`:** must equal a string (for example, a release tag).
- **`coverage`:** must mention required keywords (for example, a boot log that
  contains `POST` and `OK`).

A live **PASS / FAIL** badge updates as you type.

### Sign-off is earned, not clicked

The **Sign & seal** button stays disabled until **every** Check is done and
**every** Measure passes. An out-of-bounds value blocks it. The verdict is the
math: offline, deterministic, and reproducible, not a human ticking a box they
didn't verify. (Reserved comparators like `semantic` are out by design; a
correctness gate may never call an LLM.)

### Integrity seal (tamper-evident)

When you sign off, localCheck computes a **SHA-256** over the runbook content
(title, steps, and the sign timestamp) using the browser's built-in WebCrypto and
records it in the file as `body.seal`. Reopen that file and the seal is
**re-verified**. An unchanged file shows **Signed & sealed, verified intact**. If
anyone edited a reading in a text editor (turned a FAIL into a PASS), the seal no
longer matches and the bar turns red: **Integrity check FAILED**. Editing in the
app voids the seal too, so you must re-sign.

Be honest about what this is: the hash is **keyless**, so it is **tamper-evident,
not unforgeable.** It reliably catches honest mistakes and naive after-the-fact
edits. It is **not a cryptographic signature** and proves no authorship, since a
determined forger can recompute the hash. It is deterministic (SHA-256), so the
no-LLM correctness rule still holds. WebCrypto needs a secure context: it works
over `file://` and `localhost` in Chrome/Edge, and where it is unavailable,
sign-off still works but the file saves unsealed and says so.

### Read a value over USB (Web Serial)

A Measure step has a **Read USB** button. Click it, pick a connected instrument
(multimeter, UART console, bench supply), and localCheck reads a line, parses the
number, and drops it into the value, which then flows through the **same kernel
gate**. The **⚙** button sets the **baud rate** and an optional **match pattern**
(a regex whose first capture group is the reading; blank means the first number
found). Web Serial only *types the value for you*; the verdict is still the math.

Caveats, stated plainly: Web Serial is **Chrome/Edge only**, needs a user gesture
and a secure context (`https`/`localhost`), and the parse pattern is per-device.
Where it isn't available the button explains and you type the reading. The parse
logic is unit-tested; the actual device read is a **manual** path, since there is
no instrument in CI.

### Conditional branching (state-machine runbooks)

Real runbooks aren't linear. A failed calibration sends you to a diagnostic
sub-routine, not to a dead stop. Mark any step **diagnostic** and it stays
**hidden** until something branches to it. Give a Measure step an **on fail**
target and, when that measure **fails**, the diagnostic block it points to
**unfolds** (a contiguous run of diagnostic steps), highlighted and "triggered".
Fix the reading so the trigger passes and the block **folds away again**. Hidden
diagnostics are inert and never gate sign-off; only revealed ones do. The reveal
is deterministic (same kernel verdicts, never an LLM). The **Equipment readiness**
template ships a worked example (a calibration reading fails, then recalibrate and
re-measure).

### Templates, files, theme

Neutral starters (**Equipment readiness**, **Deployment checklist**) skip the blank
page. New / Open / Save / Save As (`Ctrl+S`) write the `localoffice/v1` runbook
envelope. Light/dark. Opens inside the **LocalOffice Hub** with in-place save.

## The format

```json
{
  "format": "localoffice/v1",
  "type": "runbook",
  "meta": { "id": "…", "title": "Equipment readiness", "app": "localcheck@1.0", … },
  "body": {
    "steps": [
      { "id", "kind": "check",   "text", "done" },
      { "id", "kind": "measure", "text", "comparator": "tolerance",
        "params": { "min": 3.2, "max": 3.4 }, "value": "3.31",
        "ifFailGoto": "<diagnostic step id>",
        "serial": { "baud": 9600, "pattern": "V=(\\d+)" } },
      { "id", "kind": "note",    "text", "note", "diagnostic": true }
    ],
    "seal": { "algo": "sha-256", "signed": "ISO8601", "hash": "…", "scope": "title+steps" }
  }
}
```

## Privacy

localCheck makes **no network calls at all**: no fonts, no analytics, no AI.
Everything happens in the page. Verify it yourself: open DevTools, watch the
Network tab, use the app, and watch nothing happen.

## Repo structure

```
localCheck/
├── index.html       # The entire application (inlines the core + verify kernel)
├── verify-check.js  # Headless (Playwright) verification (42 checks)
└── README.md        # This file
```

## License

[MIT](../LICENSE).
