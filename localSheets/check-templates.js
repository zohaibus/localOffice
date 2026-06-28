// Per-template health report for localsheets.html after the envelope refactor.
// Loads every bundled template, recomputes it, and reports sheets / cells /
// formulas / ERROR cells, plus whether it round-trips through the new envelope.
// Read-only diagnostic. Run: node check-templates.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());

const FILE_URL = 'file:///' + path.resolve(__dirname, 'localsheets.html').replace(/\\/g, '/');
const TEMPLATES = path.join(__dirname, 'templates');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(150);

  const files = fs.readdirSync(TEMPLATES).filter(f => f.endsWith('.localsheet.json'));
  const rows = [];
  let anyBad = false;

  for (const f of files) {
    const legacy = fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
    const r = await page.evaluate((text) => {
      const S = window.LocalSheets.Store;
      const E = window.LocalSheets.E;
      function stats() {
        let cells = 0, formulas = 0, errs = 0; const errList = [];
        for (const id of S.data.sheetOrder) {
          const sh = S.data.sheets[id];
          for (const coord in sh.cells) {
            const c = sh.cells[coord];
            cells++;
            if (c.formula) formulas++;
            if (c.type === 'error' || E.isError(c.value)) { errs++; if (errList.length < 5) errList.push(sh.name + '!' + coord + '=' + c.value); }
          }
        }
        return { sheets: S.data.sheetOrder.length, cells, formulas, errs, errList,
                 title: (S.data.meta && S.data.meta.title) || '' };
      }
      try {
        S.reset(); S.loadJSON(text);
        const before = stats();
        // dump full state for round-trip equality
        const dump = () => { const o = {}; for (const id of S.data.sheetOrder) { const sh = S.data.sheets[id]; const cs = {}; for (const k in sh.cells) { const c = sh.cells[k]; cs[k] = c.raw + '|' + String(c.value); } o[sh.name] = cs; } return JSON.stringify(o); };
        const d1 = dump();
        const env = S.toJSON(); S.reset(); S.loadJSON(env);
        const d2 = dump();
        return { ok: true, before, roundtrip: d1 === d2, isEnvelope: JSON.parse(env).format === 'localoffice/v1' };
      } catch (e) { return { ok: false, err: e.message }; }
    }, legacy);

    if (!r.ok) { rows.push({ f, line: 'LOAD FAILED: ' + r.err }); anyBad = true; continue; }
    const bad = (r.errs > 0) || !r.roundtrip || !r.isEnvelope;
    if (bad) anyBad = true;
    rows.push({ f, b: r.before, roundtrip: r.roundtrip, env: r.isEnvelope, bad });
  }

  console.log(`\nLoaded localsheets.html (boot errors: ${errors.length})\n`);
  console.log('TEMPLATE'.padEnd(42) + 'SHEETS  CELLS  FORMULAS  ERRORS  RT  ENV');
  console.log('─'.repeat(80));
  for (const row of rows) {
    if (row.line) { console.log(row.f.padEnd(42) + row.line); continue; }
    const b = row.b;
    console.log(
      row.f.padEnd(42) +
      String(b.sheets).padEnd(8) + String(b.cells).padEnd(7) +
      String(b.formulas).padEnd(10) + String(b.errs).padEnd(8) +
      (row.roundtrip ? 'ok  ' : 'BAD ') + (row.env ? 'ok' : 'BAD'));
    if (b.errs > 0) console.log('   ⚠ error cells: ' + b.errList.join(', '));
  }
  console.log('─'.repeat(80));
  console.log(anyBad ? 'RESULT: ⚠ something needs a look' : 'RESULT: ✓ all templates load, compute clean, and round-trip');

  await browser.close();
  process.exit(anyBad || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
