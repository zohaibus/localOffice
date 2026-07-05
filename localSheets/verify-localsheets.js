// Headless verification of localsheets.html after the localoffice/v1 envelope
// refactor. Confirms the shipped single-file app still boots, writes the
// envelope, and round-trips REAL existing template files without loss.
// Run: node verify-localsheets.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');

const FILE_URL = 'file:///' + path.resolve(__dirname, 'localsheets.html').replace(/\\/g, '/');
const TEMPLATES = path.join(__dirname, 'templates');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(fsMockInit);               // in-memory File System Access API
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(FILE_URL);
  await page.waitForTimeout(200);

  // The inlined adapter is parsed with the rest of the app - a syntax slip here
  // would blow up the whole file, so "boots cleanly + globals exist" is a real check.
  check('app boots with no page/console errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('Store is exposed', await page.evaluate(() => !!(window.LocalSheets && window.LocalSheets.Store)));
  check('SheetEnvelope is wired in', await page.evaluate(() => !!(window.SheetEnvelope && window.SheetEnvelope.toEnvelope)));

  // toJSON now emits a localoffice/v1 sheet envelope
  const envShape = await page.evaluate(() => {
    const S = window.LocalSheets.Store;
    S.reset();
    S.setCell('A1', '10'); S.setCell('A2', '20'); S.setCell('A3', '=SUM(A1:A2)');
    const txt = S.toJSON();
    const o = JSON.parse(txt);
    return { format: o.format, type: o.type, hasView: !!o.view, a3: o.body.sheets[0].cells.A3 };
  });
  check('toJSON writes format localoffice/v1', envShape.format === 'localoffice/v1');
  check('toJSON writes type sheet', envShape.type === 'sheet');
  check('toJSON emits a view block', envShape.hasView === true);
  check('formula cell saved as { f }', envShape.a3 && envShape.a3.f === '=SUM(A1:A2)');

  // round-trip the envelope back in
  const rt = await page.evaluate(() => {
    const S = window.LocalSheets.Store;
    const txt = S.toJSON(); S.reset(); S.loadJSON(txt);
    return { a3: S.getCell('A3').value };
  });
  check('envelope round-trips and recomputes', rt.a3 === 30);

  // ── per-cell note + list-validation must survive a shipped-html round-trip ──
  // (both are UI features; they were silently dropped on save before this fix).
  const nv = await page.evaluate(() => {
    const S = window.LocalSheets.Store; S.reset();
    S.setCell('A1', 'hi'); const c = S.activeSheet().cells.A1;
    c.note = 'a comment'; c.validation = { type: 'list', values: ['x', 'y'] };
    const txt = S.toJSON(); S.reset(); S.loadJSON(txt);
    const back = S.activeSheet().cells.A1;
    return { note: back.note, vType: back.validation && back.validation.type, vLen: back.validation && back.validation.values.length };
  });
  check('cell note + list-validation survive the round-trip', nv.note === 'a comment' && nv.vType === 'list' && nv.vLen === 2);

  // ── a stale cached literal value in a loaded file must be re-derived from raw ──
  const stale = await page.evaluate(() => {
    const S = window.LocalSheets.Store; S.reset();
    const legacyV2 = JSON.stringify({ tool: 'localsheets', version: '2.0', meta: {}, sheets: { s1: { name: 'Sheet1', cells: { A1: { raw: '5', value: 99999, type: 'number' }, A2: { raw: '=A1+1', formula: '=A1+1' } }, colWidths: {}, selR: 0, selC: 0 } }, sheetOrder: ['s1'], activeSheet: 's1', settings: {} });
    S.loadJSON(legacyV2);
    return { a1: S.getCell('A1').value, a2: S.getCell('A2').value };
  });
  check('a stale literal cache is re-derived on load (no poisoned formulas)', stale.a1 === 5 && stale.a2 === 6);

  // ── GOLDEN back-compat: load every REAL legacy template, save as envelope,
  //    reload, and assert the full per-cell state is identical. ──
  const files = fs.readdirSync(TEMPLATES).filter(f => f.endsWith('.localsheet.json'));
  check('found template files to test', files.length > 0);

  for (const f of files) {
    const legacy = fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
    const result = await page.evaluate((legacyText) => {
      const S = window.LocalSheets.Store;
      // dump every cell's input+computed value + structures across all sheets
      function dump() {
        const out = {};
        for (const id of S.data.sheetOrder) {
          const sh = S.data.sheets[id];
          const cells = {};
          for (const coord in sh.cells) {
            const c = sh.cells[coord];
            cells[coord] = { raw: c.raw, formula: c.formula || null, value: String(c.value), fmt: c.format || null };
          }
          out[sh.name] = { cells, colWidths: sh.colWidths || {}, rowHeights: sh.rowHeights || {},
                           merges: sh.merges || [], tables: sh.tables || [] };
        }
        return out;
      }
      try {
        S.reset(); S.loadJSON(legacyText);
        const before = JSON.stringify(dump());
        const env = S.toJSON();
        const isEnvelope = JSON.parse(env).format === 'localoffice/v1';
        S.reset(); S.loadJSON(env);
        const after = JSON.stringify(dump());
        return { ok: true, isEnvelope, identical: before === after };
      } catch (e) { return { ok: false, err: e.message }; }
    }, legacy);
    check(`template "${f}" loads (legacy)`, result.ok);
    if (!result.ok) { console.log('\n  ' + f + ' → ' + result.err); continue; }
    check(`template "${f}" re-saves as envelope`, result.isEnvelope);
    check(`template "${f}" round-trips losslessly`, result.identical);
  }

  // ── "did we lose anything?" - exhaustively round-trip EVERY structure ──
  const keep1 = await page.evaluate(() => {
    const S = window.LocalSheets.Store;
    S.reset();
    S.setCell('A1', '10'); S.setCell('A2', '20'); S.setCell('A3', '=SUM(A1:A2)');
    S.setFormat('A3', { numfmt: 'currency', bold: true });
    S.setColWidth(0, 170); S.setRowHeight(1, 33);
    const s0 = S.data.sheetOrder[0], sh = S.data.sheets[s0];
    sh.merges = ['A1:B1'];
    sh.tables = [{ range: 'A1:C3' }];
    sh.conditionalRules = [{ range: 'A1:A3', op: '>', value: 5 }];
    sh.filters = { '2': ['x', 'y'] };
    if (sh.frozen) { sh.frozen.rows = 2; sh.frozen.cols = 1; }
    const dId = S.addSheet('Data'); S.setCell('B1', '99', { sheetId: dId });
    S.setActiveSheet(s0); S.setCell('C1', '=Data!B1');     // cross-sheet
    S.data.settings = { theme: 'dark' };
    function snap() {
      S.setActiveSheet(S.data.sheetOrder[0]);
      const s = S.data.sheets[S.data.sheetOrder[0]];
      return JSON.stringify({
        a3: S.getCell('A3').value, a3disp: S.getDisplay('A3'), c1: S.getCell('C1').value,
        fmt: s.cells.A3.format, w: S.getColWidth(0), h: S.getRowHeight(1),
        merges: s.merges, tables: s.tables, cond: s.conditionalRules,
        filters: s.filters, frozen: s.frozen, theme: S.data.settings.theme,
        names: S.data.sheetOrder.map(i => S.data.sheets[i].name)
      });
    }
    const before = snap();
    const env = S.toJSON(); S.reset(); S.loadJSON(env);
    const after = snap();
    return { identical: before === after, before, after };
  });
  check('formats/widths/heights/merges/tables/conditional/filters/frozen/theme/cross-sheet all survive', keep1.identical);
  if (!keep1.identical) { console.log('\n  before: ' + keep1.before + '\n  after:  ' + keep1.after); }

  const keep2 = await page.evaluate(() => {
    const S = window.LocalSheets.Store;
    S.reset(); const dId = S.addSheet('Data');
    S.setActiveSheet(dId); S.activeSheet().selR = 4; S.activeSheet().selC = 2;
    const env = S.toJSON(); S.reset(); S.loadJSON(env);
    return { active: S.activeSheet().name, r: S.activeSheet().selR, c: S.activeSheet().selC };
  });
  check('active sheet restored after round-trip', keep2.active === 'Data');
  check('cell selection (row/col) restored after round-trip', keep2.r === 4 && keep2.c === 2);

  // legacy v1.x still migrates; a non-sheet envelope is rejected with a clear error
  const edge = await page.evaluate(() => {
    const S = window.LocalSheets.Store;
    let v1ok = false, rejectOther = false;
    try { S.reset(); S.loadJSON(JSON.stringify({ tool: 'localsheets', version: '1.1', meta: {}, cells: { A1: { raw: '5', value: 5, type: 'number' } }, settings: {} })); v1ok = S.getCell('A1').value === 5; } catch {}
    try { S.loadJSON(JSON.stringify({ format: 'localoffice/v1', type: 'slides', meta: {}, body: {} })); } catch { rejectOther = true; }
    return { v1ok, rejectOther };
  });
  check('legacy v1.x still migrates', edge.v1ok);
  check('a non-sheet envelope is rejected clearly', edge.rejectOther);

  // ── Clipboard Protocol: copy builds TSV + an encodable localoffice grid fragment ──
  const clip = await page.evaluate(() => {
    Store.setCell('A1', 'x'); Store.setCell('B1', 'y'); Store.setCell('A2', '1'); Store.setCell('B2', '2');
    Selection.anchor = { r: 0, c: 0 }; Selection.focus = { r: 1, c: 1 };
    const g = selectionGrid();
    const b64 = clipEncode({ format: 'localoffice/clip-v1', kind: 'grid', grid: g.grid });
    const decoded = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return { text: g.text, rows: g.grid.length, cols: g.grid[0].length, kind: decoded.kind, cell: decoded.grid[0][0] };
  });
  check('copy builds a 2D grid + TSV from the selection', clip.rows === 2 && clip.cols === 2 && /x\ty/.test(clip.text));
  check('copy fragment encodes + decodes round-trip', clip.kind === 'grid' && clip.cell === 'x');

  // ── File System Access round-trip (mocked picker - the real Chrome/Edge path) ──
  const frt = await page.evaluate(async () => {
    Store.setCell('A1', 'SHEETX');
    await saveWorkbookAs();                             // Save As → showSaveFilePicker → write/close
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    Store.setCell('A1', 'CHANGED'); Store.dirty = false; // clobber (dirty=false so Open skips its confirm)
    window.__fsPick = name;
    await openWorkbook();                               // showOpenFilePicker → getFile → loadJSON
    const a1 = Store.getCell('A1').value;
    Store.setCell('A1', 'EDITED'); await saveWorkbook(); // in-place via the existing handle
    return { fmt: saved.format, type: saved.type, a1, inplaceHas: window.__virtualFS.get(name).indexOf('EDITED') !== -1 };
  });
  check('FS: Save As writes a localoffice/v1 sheet file through the handle', frt.fmt === 'localoffice/v1' && frt.type === 'sheet');
  check('FS: Open reads the saved workbook back through the handle', frt.a1 === 'SHEETX');
  check('FS: in-place Save writes through the existing handle', frt.inplaceHas === true);

  // ── embed: the LocalOffice Hub hands us a file via postMessage ──
  const embed = await page.evaluate(async () => {
    Store.setCell('A1', 'EMBED_ORIG');
    const text = Store.toJSON();
    Store.setCell('A1', 'CHANGED');
    const fakeHandle = { getFile: async () => ({ text: async () => text }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, error: m.error, a1: Store.getCell('A1').value, hSet: Store.handle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a workbook and acks ok', embed.ok === true && !embed.error);
  check('embed: workbook content actually replaced (A1 reverted)', embed.a1 === 'EMBED_ORIG');
  check('embed: workbook keeps the file handle for in-place save', embed.hSet === true);

  // ── shared JSON inspector via the LocalSheets shim (no LocalOffice global) ──
  check('JSON panel (shim) opens with the sheet envelope, applies edits, guards bad JSON', await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); if (!btn) return false;
    btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea');
    const shown = jp.classList.contains('on') && ta.value.includes('"type": "sheet"');
    const o = JSON.parse(ta.value); o.meta.title = 'Sheet Z'; ta.value = JSON.stringify(o, null, 2);
    jp.querySelector('[data-a="apply"]').click(); await new Promise(r => setTimeout(r, 60));
    const applied = Store.data.meta.title === 'Sheet Z';
    ta.value = '{ bad'; jp.querySelector('[data-a="apply"]').click();
    const guarded = Store.data.meta.title === 'Sheet Z' && /Not applied/.test(jp.querySelector('[data-i]').textContent);
    return shown && applied && guarded;
  }));

  // ── JSON panel: the "build a spreadsheet with any LLM" prompt toggle ──
  check('JSON panel has a Prompt toggle with the sheet schema, then returns to JSON', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea'), pb = jp.querySelector('[data-a="prompt"]');
    if (!pb || pb.hidden) return false;
    pb.click();
    const shown = ta.value.includes('localoffice/v1') && ta.value.includes('"type": "sheet"') && /cells/.test(ta.value) && ta.value.includes('<describe the spreadsheet you want');
    pb.click();
    const back = ta.value.includes('"format"') && !ta.value.includes('<describe');
    return shown && back;
  }));

  // ── the schema the prompt asks for (cells with v/f) MUST apply and COMPUTE ──
  check('a schema-shaped sheet (cells with v/f) applies and formulas recompute', await page.evaluate(() => {
    const env = JSON.stringify({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'Gen' }, body: { sheets: [
      { name: 'S1', cells: { 'A1': { v: 'Item' }, 'B1': { v: 'Amt' }, 'B2': { v: 10 }, 'B3': { v: 20 }, 'B4': { f: '=SUM(B2:B3)' }, 'B5': { f: '=B4*1.1' } } } ] } });
    applyOpenedSheet(env, null);
    const S = window.LocalSheets.Store;
    return S.data.meta.title === 'Gen' && S.getCell('B4').value === 30 && Math.abs(S.getCell('B5').value - 33) < 1e-9;
  }));

  // ── in-app "New sheet" mode: generate a workbook via local Ollama (mocked) → preview → apply ──
  check('AI New-sheet mode drafts a spreadsheet and applies it (formulas compute)', await page.evaluate(async () => {
    window.fetch = async (url) => {
      url = String(url);
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }] }) };
      if (url.endsWith('/api/generate')) return { ok: true, json: async () => ({ response: JSON.stringify({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'AI Sheet' }, body: { sheets: [
        { name: 'S1', cells: { 'A1': { v: 'X' }, 'B1': { v: 5 }, 'B2': { f: '=B1*2' } } } ] } }) }) };
      return { ok: false, status: 404 };
    };
    await AI.detect();
    document.querySelector('input[name="ai-mode"][value="sheet"]').checked = true;
    document.getElementById('ai-model').innerHTML = '<option>llama3.2</option>'; document.getElementById('ai-model').value = 'llama3.2';
    document.getElementById('ai-prompt').value = 'a tiny sheet';
    await AI.send();
    const previewShown = !document.getElementById('ai-apply-sheet').classList.contains('hidden') && /AI Sheet/.test(document.getElementById('ai-response').textContent);
    AI.applyGenSheet();
    const S = window.LocalSheets.Store;
    return previewShown && S.data.meta.title === 'AI Sheet' && S.getCell('B2').value === 10;
  }));

  check('Embeds host: + Add embeds an object (LocalRender preview); round-trip preserves body.embeds', await page.evaluate(() => {
    EmbedHost.open();
    const sel = document.querySelector('#eh [data-a="add"]'); if (!sel) return false;
    sel.value = 'runbook'; sel.dispatchEvent(new Event('change'));
    const added = Array.isArray(Store.data.embeds) && Store.data.embeds.length === 1 && Store.data.embeds[0].envelope.type === 'runbook';
    const noDrawerIframe = !document.querySelector('#eh iframe');
    const prev = document.querySelector('#eh .eh-prev'); const previewShown = !!prev && prev.innerHTML.length > 0;
    const text = Store.toJSON(); const env = JSON.parse(text);
    const inBody = env.body.embeds && env.body.embeds.length === 1 && env.body.embeds[0].envelope.type === 'runbook';
    Store.loadJSON(text);
    const afterLoad = Array.isArray(Store.data.embeds) && Store.data.embeds.length === 1 && Store.data.embeds[0].envelope.type === 'runbook';
    const hasBtn = [...document.querySelectorAll('button')].some(b => b.textContent.indexOf('Embeds') >= 0);
    return added && noDrawerIframe && previewShown && inBody && afterLoad && hasBtn;
  }));

  check('Save flushes an in-progress cell edit (last typed value is not lost)', await page.evaluate(async () => {
    Selection.set(0, 0, false);
    const td = Grid.cellEl(0, 0); if (!td) return false;
    // simulate: the user is mid-typing in A1 and has NOT pressed Enter / clicked away
    editing = true; editPrev = '';
    const inp = document.createElement('input'); inp.className = 'editor'; inp.value = '424242'; td.appendChild(inp);
    let written = '';
    Store.handle = { createWritable: async () => ({ write: async (t) => { written = t; }, close: async () => {} }) };
    await saveWorkbook();
    return editing === false && written.indexOf('424242') >= 0;
  }));
  check('New also flushes an in-progress edit before it can be lost', await page.evaluate(() => {
    Selection.set(1, 0, false);
    const td = Grid.cellEl(1, 0); if (!td) return false;
    editing = true; editPrev = '';
    const inp = document.createElement('input'); inp.className = 'editor'; inp.value = '778899'; td.appendChild(inp);
    commitEdit();   // the exact call newWorkbook/save now make first
    return editing === false && Store.toJSON().indexOf('778899') >= 0;
  }));

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
