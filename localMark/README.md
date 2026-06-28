# localMark

**A single-file image sanitizer. Protect IP, not retouch photos.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Single File](https://img.shields.io/badge/single-file-success.svg)](index.html)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)](index.html)
[![Works Offline](https://img.shields.io/badge/offline-yes-success.svg)](index.html)

No accounts. No cloud. No build step. No tracking. One HTML file.

<p align="center">
  <a href="https://zohaibus.github.io/localOffice/localMark/index.html"><img src="https://github.com/user-attachments/assets/6321ac5a-ede5-4332-907a-695e8f48510b" alt="localMark demo (animated)" width="820"></a>
</p>
<p align="center"><a href="https://zohaibus.github.io/localOffice/localMark/index.html"><b>▶ Open localMark</b></a></p>

---

## What it is

localMark is **not** a photo editor. It is an **IP sanitizer** for engineers,
researchers, and infosec teams who need to share an image (a PCB photo, an
oscilloscope trace, a board image, a screenshot) **without leaking what's underneath
or where it came from.** It is part of the **LocalOffice** family and reads/writes
the open **`localoffice/v1`** format (`type: "image"`).

## What it does

### Scrub on import

Drop a file onto the canvas, click **Import…**, or paste (Ctrl/Cmd-V). The image
is **re-encoded through a `<canvas>`**, which structurally strips all source
metadata (**EXIF, GPS, camera, author**) and downscales it to 1600px. What you
keep is pixels, nothing else.

### Redaction is destructive (the moat)

Draw a **Redact** box and confirm. The black is **flattened into the raster on the
spot**, so the pixels underneath are **erased from the file: gone, not hidden.** A
recipient can't lift the box to recover anything, because there is nothing left to
recover. A redaction marker is recorded separately for audit, but the data is
already gone. A test asserts this at the pixel level.

### Annotations (non-destructive)

- **Watermark:** tiled diagonal text (for example, *CONFIDENTIAL, DO NOT
  DISTRIBUTE*).
- **Arrows:** drag a callout arrow with an optional text label.

These are editable vector overlays, and **Undo annot.** removes the last one.
Redactions are never undone; they are permanent by design.

### Dimensional calibration & measurement

Turn a PCB photo or board image into a **metrology aid**. Pick **⊢ Calibrate**, drag
a line across a feature of known size (a 0402 pad, a fiducial, a scale bar) and
type its real length: `1.0 mm`, `5 cm`, `0.4 in`, `2"`. That sets `body.scale`
(real units per pixel). Then pick **📏 Measure** and drag, and the overlay is
labelled with the **real-world distance** (for example, `3.20 mm`), recomputed
from the scale so it stays correct. It is pure arithmetic, no AI and no network.
Until you calibrate, a Measure reads in **px** and says so.

### Export

**Export PNG** composites the already-redacted base plus overlays, including
measurement lines, into a flat, **metadata-free** PNG, safe to attach anywhere.

### QR overlay

Stamp an **asset tag or calibration URL** as a QR code with the **QR** button
(bottom-right, one per image). The encoder is **dependency-free** (byte mode, EC
level M, versions 1 to 6, about 106 chars). Its math is verified offline: GF(256)
arithmetic, Reed-Solomon **zero-syndrome** self-consistency, and a byte-mode data
round-trip, so the codewords are provably correct. **Confirm physical scannability
once with your phone**, the one thing no offline test can assert.

### Files & theme

New / Open / Save / Save As (`Ctrl+S`) write the `localoffice/v1` image envelope.
Light/dark toggle. Opens inside the **LocalOffice Hub** with in-place save.

## The format

```json
{
  "format": "localoffice/v1",
  "type": "image",
  "meta": { "id": "…", "title": "Board photo", "app": "localmark@1.0", … },
  "body": {
    "base": "data:image/png;base64,…",   // scrubbed raster, redactions baked in
    "width": 1600, "height": 1200,
    "scale": { "unit": "mm", "perPixel": 0.02 },     // optional, set by Calibrate
    "overlays": [
      { "type": "redaction", "x", "y", "w", "h" },   // audit marker (pixels already erased)
      { "type": "watermark", "text" },
      { "type": "arrow", "x1", "y1", "x2", "y2", "label" },
      { "type": "measure", "x1", "y1", "x2", "y2" }, // labelled with real length via scale
      { "type": "qr", "x", "y", "size", "value" }
    ]
  }
}
```

## Privacy

localMark makes **no network calls at all**: no fonts fetched, no analytics, no
AI. Everything happens in the page. Verify it yourself: open DevTools, watch the
Network tab, use the app, and watch nothing happen.

## Browser support

Modern Chrome, Edge, Firefox, Safari. **Chrome and Edge** get in-place **Save**
(File System Access API); other browsers fall back to download/upload.

## Repo structure

```
localMark/
├── index.html       # The entire application (inlines the shared LocalOffice core)
├── verify-mark.js   # Headless (Playwright) verification (32 checks)
└── README.md        # This file
```

## License

[MIT](../LICENSE).
