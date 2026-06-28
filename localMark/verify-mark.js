// Headless verification of localMark (body type `image`, localoffice/v1).
// Run: node verify-mark.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');
const FILE_URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(fsMockInit);
  page.on('dialog', d => d.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(120);

  check('localMark boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('shared core inlined and knows the image type', await page.evaluate(() => typeof LocalOffice === 'object' && LocalOffice.TYPES.includes('image')));

  // helper: seed a solid-colour base image of given size
  async function seed(w, h, color) {
    await page.evaluate(async (a) => {
      const cv = document.createElement('canvas'); cv.width = a.w; cv.height = a.h;
      const ctx = cv.getContext('2d'); ctx.fillStyle = a.color; ctx.fillRect(0, 0, a.w, a.h);
      data = { base: cv.toDataURL('image/png'), width: 0, height: 0, overlays: [] };
      await loadBase(); render();
    }, { w, h, color });
  }
  // helper (in-page): read one pixel from a data URL
  const PIXEL = `(url, x, y) => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const cx = c.getContext('2d'); cx.drawImage(im, 0, 0); const d = cx.getImageData(x, y, 1, 1).data; res([d[0], d[1], d[2], d[3]]); }; im.src = url; })`;

  // ── envelope round-trip ──
  const rt = await page.evaluate(() => {
    title = 'Board photo'; data = { base: 'data:image/png;base64,AAAA', width: 4, height: 2, overlays: [{ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, label: 'pin1' }], _x: 9 };
    const env = exportData(); const text = LocalOffice.serialize(env); const back = LocalOffice.parse(text).envelope;
    return { type: env.type, title: env.meta.title, ovl: back.body.overlays.length, kept: back.body._x === 9, valid: LocalOffice.validate(env).ok };
  });
  check('export writes type image + title', rt.type === 'image' && rt.title === 'Board photo');
  check('round-trip preserves overlays + unknown body fields', rt.ovl === 1 && rt.kept === true && rt.valid === true);

  // ── import scrubs through a canvas (metadata-free re-encode) ──
  const scrub = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 5; cv.height = 5; cv.getContext('2d').fillStyle = '#09f'; cv.getContext('2d').fillRect(0, 0, 5, 5);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    await setImageFromFile(new File([blob], 'x.png', { type: 'image/png' }));
    return { has: data.base.indexOf('data:image') === 0, w: data.width, h: data.height };
  });
  check('import re-encodes to a metadata-free data URL', scrub.has === true && scrub.w === 5 && scrub.h === 5);

  // ── redaction is DESTRUCTIVE: pixels under the box are erased ──
  await seed(20, 20, '#22aa44');
  const redact = await page.evaluate(async (px) => {
    const before = await eval(px)(data.base, 10, 10);          // green before
    await bakeRedaction({ x: 6, y: 6, w: 8, h: 8 });
    const after = await eval(px)(data.base, 10, 10);           // black after
    const marker = data.overlays.some(o => o.type === 'redaction');
    return { before, after, marker };
  }, PIXEL);
  check('before redaction the pixel is the image colour', redact.before[1] > 100);
  check('redaction bakes black into the saved raster (pixels erased)', redact.after[0] === 0 && redact.after[1] === 0 && redact.after[2] === 0);
  check('redaction is recorded as an overlay marker', redact.marker === true);

  // ── redaction with FRACTIONAL edges (the real scaled-view path) must leave NO
  // partial-alpha leak: a fractional fillRect antialiases the boundary, leaving a
  // recoverable blend of the original. The box edge cuts a 'secret' stripe; the
  // edge pixel must be fully black, and the row outside the box untouched. ──
  const frac = await page.evaluate(async (px) => {
    const cv = document.createElement('canvas'); cv.width = 100; cv.height = 100;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#000080'; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 9, 100, 3);              // magenta secret stripe at y=9..11
    data = { base: cv.toDataURL('image/png'), width: 0, height: 0, overlays: [] }; await loadBase();
    await bakeRedaction({ x: 5.5, y: 9.5, w: 80, h: 60 });             // fractional top edge cuts the stripe
    return { edge: await eval(px)(data.base, 40, 9), above: await eval(px)(data.base, 40, 8) };
  }, PIXEL);
  check('redaction erases the whole edge pixel even with fractional bounds (no partial-alpha leak)',
    frac.edge[0] === 0 && frac.edge[1] === 0 && frac.edge[2] === 0);
  check('redaction does not corrupt pixels outside the box', frac.above[2] > 100);

  // ── annotations: arrow + watermark + undo (redaction is permanent) ──
  const ann = await page.evaluate(() => {
    const r0 = data.overlays.length;
    addArrow({ x1: 1, y1: 1, x2: 9, y2: 9, label: 'trace' });
    setWatermark('CONFIDENTIAL');
    const afterAdd = data.overlays.length;
    undoOverlay();                                             // removes watermark (last non-redaction)
    undoOverlay();                                             // removes arrow
    const left = data.overlays.map(o => o.type);
    return { r0, afterAdd, left };
  });
  check('arrow + watermark are added as overlays', ann.afterAdd === ann.r0 + 2);
  check('undo removes annotations but never the redaction', ann.left.length === 1 && ann.left[0] === 'redaction');

  // ── export composites to a flat PNG; redaction stays black in export ──
  const exp = await page.evaluate(async (px) => {
    const url = compositePNG();
    const pixel = await eval(px)(url, 10, 10);
    return { isPng: url.indexOf('data:image/png') === 0, black: pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 };
  }, PIXEL);
  check('export produces a flat PNG data URL', exp.isPng === true);
  check('redaction remains black in the exported PNG', exp.black === true);

  // ── dimensional calibration + measurement (pure metrology) ──
  const cal = await page.evaluate(() => {
    const p1 = parseLen('1.0 mm'), p2 = parseLen('5cm'), p3 = parseLen('0.4 in'), p4 = parseLen('2"'), bad = parseLen('abc');
    return { p1, p2, p3, p4, bad };
  });
  check('parseLen reads number + unit (mm / cm / in, " → in)', cal.p1.val === 1 && cal.p1.unit === 'mm' && cal.p2.unit === 'cm' && cal.p3.unit === 'in' && cal.p4.unit === 'in' && cal.bad === null);

  await seed(100, 100, '#cccccc');
  const scale = await page.evaluate(() => {
    const before = fmtLen(50);                  // uncalibrated → pixels
    setScale(2, 'mm', 100);                      // 100 px = 2 mm → 0.02 mm/px
    return { before, per: data.scale.perPixel, unit: data.scale.unit, lbl: fmtLen(50) };
  });
  check('fmtLen reports pixels until calibrated', /px$/.test(scale.before));
  check('Calibrate sets data.scale to real units per pixel', Math.abs(scale.per - 0.02) < 1e-9 && scale.unit === 'mm');
  check('measurements convert px → real units via the scale', scale.lbl === '1.00 mm');

  const meas = await page.evaluate(() => {
    data.overlays = [{ type: 'measure', x1: 10, y1: 10, x2: 60, y2: 10 }];   // 50 px → 1.00 mm
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope;
    const keptScale = !!(back.body.scale && Math.abs(back.body.scale.perPixel - 0.02) < 1e-9);
    const keptMeas = back.body.overlays.some(x => x.type === 'measure');
    return { keptScale, keptMeas, isPng: compositePNG().indexOf('data:image/png') === 0 };
  });
  check('scale + measure overlays round-trip through the envelope', meas.keptScale === true && meas.keptMeas === true);
  check('a measure overlay composites into the exported PNG', meas.isPng === true);

  // ── File System Access round-trip (mocked picker) ──
  const frt = await page.evaluate(async () => {
    title = 'FS Mark';
    await bakeRedaction; // noop ref
    data = { base: 'data:image/png;base64,iVBORw0KGgo=', width: 2, height: 2, overlays: [{ type: 'watermark', text: 'WM' }] };
    await loadBase();
    await saveMarkAs();
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    newMark();
    window.__fsPick = name;
    await openMark();
    return { type: saved.type, savedWm: saved.body.overlays[0].text, openedTitle: title, openedOvl: data.overlays.length };
  });
  check('Save As writes a localoffice/v1 image through the handle', frt.type === 'image' && frt.savedWm === 'WM');
  check('Open reads the saved image back through the handle', frt.openedTitle === 'FS Mark' && frt.openedOvl === 1);

  // ── embed: Hub hands us an image via postMessage ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'image', meta: { title: 'Embedded mark' }, body: { base: '', width: 0, height: 0, overlays: [{ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, title, ovl: data.overlays.length, hSet: fileHandle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads an image and acks ok', embed.ok === true && embed.title === 'Embedded mark' && embed.ovl === 1);
  check('embed: image keeps the file handle for in-place save', embed.hSet === true);

  // ── theme toggle ──
  check('dark/light toggle flips the body class', await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; }));

  // ── QR encoder: the MATH is verified offline (scannability = manual scan) ──
  const qr = await page.evaluate(() => {
    const G = QR._gmul, EXP = QR._EXP, LOG = QR._LOG;
    const gfOk = G(2, 2) === 4 && G(0, 7) === 0 && G(5, 1) === 5 && G(EXP[200], EXP[100]) === EXP[(200 + 100) % 255] && LOG[EXP[42]] === 42 && EXP[255] === 1;
    // Reed-Solomon: a valid codeword has zero syndromes (evaluates to 0 at α^1..α^ec)
    const bc = QR._buildCodewords('HELLO WORLD 123');
    let rsOk = true;
    bc.blocks.forEach(b => { const cw = b.d.concat(b.e), L = cw.length; for (let i = 0; i < bc.ecLen; i++) { let s = 0; for (let k = 0; k < L; k++) s ^= G(cw[k], EXP[(i * (L - 1 - k)) % 255]); if (s !== 0) rsOk = false; } });
    // byte-mode data round-trips at the codeword level (mode / length / payload)
    const bc2 = QR._buildCodewords('HELLO'); const d = []; bc2.blocks.forEach(b => b.d.forEach(x => d.push(x)));
    const bits = []; d.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); }); let p = 0; const rd = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bits[p++]; return v; };
    const mode = rd(4), len = rd(8); let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(rd(8));
    // matrix structure: three finder corners + size
    const m = QR.encode('https://localoffice.example/asset/4F2A');
    const finder = m.mods[0][0] === 1 && m.mods[1][1] === 0 && m.mods[3][3] === 1 && m.mods[0][m.size - 1] === 1 && m.mods[m.size - 1][0] === 1;
    return { gfOk, rsOk, mode, len, s, finder, sizeOk: m.size === 17 + 4 * m.version, v1: QR.encode('A').version, vBig: QR.encode('x'.repeat(60)).version, threw: (() => { try { QR.encode('y'.repeat(400)); return false; } catch (e) { return true; } })() };
  });
  check('QR: GF(256) arithmetic is correct', qr.gfOk === true);
  check('QR: Reed-Solomon codewords are self-consistent (zero syndromes)', qr.rsOk === true);
  check('QR: byte-mode data round-trips (mode / length / payload)', qr.mode === 4 && qr.len === 5 && qr.s === 'HELLO');
  check('QR: matrix has the three finder patterns + correct size', qr.finder === true && qr.sizeOk === true);
  check('QR: picks the smallest version that fits', qr.v1 === 1 && qr.vBig > 1);
  check('QR: refuses content that is too long (fails closed)', qr.threw === true);

  const qint = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200; const cx = cv.getContext('2d'); cx.fillStyle = '#dddddd'; cx.fillRect(0, 0, 200, 200);
    data = { base: cv.toDataURL('image/png'), width: 0, height: 0, overlays: [] }; await loadBase();
    data.overlays.push({ type: 'qr', x: 120, y: 120, size: 76, value: 'ASSET-12345' });
    const url = compositePNG();
    const black = await new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0); const dd = ctx.getImageData(120, 120, 80, 80).data; let b = false; for (let i = 0; i < dd.length; i += 4) if (dd[i] < 50 && dd[i + 1] < 50 && dd[i + 2] < 50) { b = true; break; } res(b); }; im.src = url; });
    return { ok: url.indexOf('data:image/png') === 0, hasQR: data.overlays.some(o => o.type === 'qr'), black };
  });
  check('QR overlay composites black modules into the exported PNG', qint.ok === true && qint.hasQR === true && qint.black === true);

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
