// Verifies the localoffice/v1 template presets: sheet templates load + compute
// in the SHIPPED localsheets.html; the plan preset validates via the core.
// Run: node templates/verify-templates.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const LO = require(path.join(__dirname, '..', 'src', 'core'));

const SHEETS_HTML = 'file:///' + path.resolve(__dirname, '..', 'localSheets', 'localsheets.html').replace(/\\/g, '/');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  // ── plan preset (no tool yet) - validate via the shared core ──
  const plan = JSON.parse(read('pm-plan.localoffice.json'));
  const pr = LO.validate(plan);
  check('pm-plan is a valid envelope', pr.ok);
  check('pm-plan type is plan', plan.type === 'plan');
  check('pm-plan uses the tracks model (LocalPlan)', Array.isArray(plan.body.tracks) && plan.body.tracks.length >= 1);
  const proj = plan.body.tracks[0];
  check('pm-plan has phase sections with items', proj.sections.length === 5 && proj.sections[0].items.length >= 1);
  check('pm-plan sections/items are well-formed', proj.sections.every(s => s.name && s.horizon && Array.isArray(s.items) && s.items.every(i => i.id && i.text)));

  // ── sheet presets - load + compute in the shipped LocalSheets ──
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(SHEETS_HTML);
  await page.waitForTimeout(150);
  check('LocalSheets boots clean', errors.length === 0);

  // Unit & physics pack
  const upText = read('unit-pack.localoffice.json');
  const up = await page.evaluate((text) => {
    const S = window.LocalSheets.Store, E = window.LocalSheets.E;
    S.reset(); S.loadJSON(text);
    let errs = 0; for (const id of S.data.sheetOrder) for (const k in S.data.sheets[id].cells) { const c = S.data.sheets[id].cells[k]; if (c.type === 'error' || E.isError(c.value)) errs++; }
    return { errs, name: S.data.sheets[S.data.sheetOrder[0]].name, d5: S.getCell('D5').value, d10: S.getCell('D10').value, b27: S.getCell('B27').value };
  }, upText);
  check('unit pack loads as the envelope (sheet name)', up.name === 'Units');
  check('unit pack computes with zero error cells', up.errs === 0);
  check('unit pack: 100 C = 212 F', Math.abs(up.d5 - 212) < 1e-6);
  check('unit pack: 5 kg = 11.02 lb', Math.abs(up.d10 - 11.0231) < 1e-3);
  check('unit pack: compound 1000*1.05^10 = 1628.89', Math.abs(up.b27 - 1628.8946) < 1e-2);

  // Net worth
  const nwText = read('net-worth.localoffice.json');
  const nw = await page.evaluate((text) => {
    const S = window.LocalSheets.Store, E = window.LocalSheets.E;
    S.reset(); S.loadJSON(text);
    let errs = 0; for (const id of S.data.sheetOrder) for (const k in S.data.sheets[id].cells) { const c = S.data.sheets[id].cells[k]; if (c.type === 'error' || E.isError(c.value)) errs++; }
    return { errs, b9: S.getCell('B9').value, b18: S.getCell('B18').value, disp: S.getDisplay('B18') };
  }, nwText);
  check('Net worth computes with zero error cells', nw.errs === 0);
  check('Net worth: total assets = 385000', nw.b9 === 385000);
  check('Net worth: net worth = 143500', nw.b18 === 143500);
  check('Net worth: currency formatting applied', /\$/.test(nw.disp));

  // round-trip: re-save (envelope) and reload identical
  const rt = await page.evaluate((text) => {
    const S = window.LocalSheets.Store;
    S.reset(); S.loadJSON(text); const a = S.getCell('B18').value;
    const out = S.toJSON(); S.reset(); S.loadJSON(out);
    return { same: S.getCell('B18').value === a, isEnvelope: JSON.parse(out).format === 'localoffice/v1' };
  }, nwText);
  check('template re-saves as envelope + round-trips', rt.same && rt.isEnvelope);

  await browser.close();
  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
