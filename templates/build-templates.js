// Generates the localoffice/v1 sheet/plan template presets.
// Sheets are authored through the REAL LocalSheets engine so every formula is
// validated + its result asserted before the (recipe) envelope is written.
// Run: node templates/build-templates.js
'use strict';
const fs = require('fs');
const path = require('path');

const SHEETS = path.join(__dirname, '..', 'localSheets', 'src');
const E = require(path.join(SHEETS, 'engine'));
global.E = E;
global.SheetEnvelope = require(path.join(SHEETS, 'envelope'));
const appCode = fs.readFileSync(path.join(SHEETS, 'app-layer.js'), 'utf-8');
eval(appCode.replace(/^'use strict';\s*/m, '') + '\nglobal.Store = Store;');
const LO = require(path.join(__dirname, '..', 'src', 'core'));

const OUT = __dirname;
let failed = 0;
function approx(a, b, eps, msg) { if (typeof a !== 'number' || Math.abs(a - b) > (eps || 1e-6)) { console.log(`  ✗ ${msg}: got ${a}, expected ~${b}`); failed++; } }

// Author one sheet from a [coord, value, format?] spec, returning the envelope.
function buildSheet(meta, sheetName, colWidths, spec) {
  Store.reset();
  Store.data.sheets[Store.data.activeSheet].name = sheetName;
  for (const c in (colWidths || {})) Store.setColWidth(+c, colWidths[c]);
  for (const [coord, val, fmt] of spec) {
    Store.setCell(coord, String(val));
    if (fmt) Store.setFormat(coord, fmt);
  }
  Store.recalcAll();
  const env = SheetEnvelope.toEnvelope(Store.data, E, { app: 'localsheets@1.2' });
  // deterministic meta (no per-run id/timestamp churn)
  env.meta = { id: meta.id, title: meta.title, created: '2026-06-14T00:00:00.000Z',
               modified: '2026-06-14T00:00:00.000Z', app: 'localsheets@1.2', tags: meta.tags };
  return env;
}
function write(name, env) {
  const r = LO.validate(env);
  if (!r.ok) { console.log(`  ✗ ${name} invalid: ${r.errors.join(' ')}`); failed++; }
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(env, null, 2));
  console.log(`  wrote ${name}`);
}

// ════════════════════════════════════════════════════════════════════
// 1) Unit & physics pack  (generic textbook conversions and formulas)
// ════════════════════════════════════════════════════════════════════
const B = { bold: true }, IT = { italic: true }, NUM = { numfmt: 'number' };
const unitEnv = buildSheet(
  { id: 'tpl-unit-pack', title: 'Unit & physics pack', tags: ['template', 'units'] },
  'Units', { 0: 200, 1: 100, 2: 110, 3: 100 },
  [
    ['A1', 'Unit & physics pack', B],
    ['A2', 'Generic textbook conversions and formulas.', IT],

    ['A4', 'Temperature', B],
    ['A5', 'Celsius'], ['B5', 100], ['C5', '-> Fahrenheit'], ['D5', '=B5*9/5+32', NUM],
    ['A6', 'Fahrenheit'], ['B6', 98.6], ['C6', '-> Celsius'], ['D6', '=(B6-32)*5/9', NUM],

    ['A8', 'Length & mass', B],
    ['A9', 'Kilometres'], ['B9', 10], ['C9', '-> miles'], ['D9', '=B9*0.621371', NUM],
    ['A10', 'Kilograms'], ['B10', 5], ['C10', '-> pounds'], ['D10', '=B10*2.20462', NUM],

    ['A12', 'Motion', B],
    ['A13', 'Speed (m/s)'], ['B13', 10], ['C13', '-> km/h'], ['D13', '=B13*3.6', NUM],
    ['A14', 'Acceleration (m/s^2)'], ['B14', 9.8],
    ['A15', 'Time (s)'], ['B15', 3],
    ['A16', 'Free-fall distance (m)'], ['B16', '=0.5*B14*B15*B15', NUM],

    ['A18', 'Geometry', B],
    ['A19', 'Radius'], ['B19', 5],
    ['A20', 'Circle area'], ['B20', '=PI()*B19*B19', NUM],
    ['A21', 'Circumference'], ['B21', '=2*PI()*B19', NUM],

    ['A23', 'Compound interest', B],
    ['A24', 'Principal'], ['B24', 1000],
    ['A25', 'Annual rate'], ['B25', 0.05],
    ['A26', 'Years'], ['B26', 10],
    ['A27', 'Future value'], ['B27', '=B24*POWER(1+B25,B26)', NUM],
  ]
);
// assert the math
approx(Store.getCell('D5').value, 212, 1e-6, 'Units: 100 C = 212 F');
approx(Store.getCell('D6').value, 37, 1e-6, 'Units: 98.6 F = 37 C');
approx(Store.getCell('D9').value, 6.21371, 1e-4, 'Units: 10 km = 6.21 mi');
approx(Store.getCell('D10').value, 11.0231, 1e-3, 'Units: 5 kg = 11.02 lb');
approx(Store.getCell('D13').value, 36, 1e-6, 'Units: 10 m/s = 36 km/h');
approx(Store.getCell('B16').value, 44.1, 1e-6, 'Units: free-fall 0.5*9.8*9 = 44.1 m');
approx(Store.getCell('B20').value, 78.53982, 1e-3, 'Units: circle area PI*r^2');
approx(Store.getCell('B27').value, 1628.8946, 1e-3, 'Units: compound 1000*1.05^10');
write('unit-pack.localoffice.json', unitEnv);

// ════════════════════════════════════════════════════════════════════
// 2) Net-worth tracker
// ════════════════════════════════════════════════════════════════════
const CUR = { numfmt: 'currency' };
const nwEnv = buildSheet(
  { id: 'tpl-net-worth', title: 'Net-worth tracker', tags: ['template', 'finance'] },
  'Net worth', { 0: 180, 1: 130 },
  [
    ['A1', 'Net-worth tracker', B],
    ['A3', 'Assets', B],
    ['A4', 'Cash & savings'], ['B4', 5000, CUR],
    ['A5', 'Investments'], ['B5', 25000, CUR],
    ['A6', 'Retirement'], ['B6', 40000, CUR],
    ['A7', 'Property'], ['B7', 300000, CUR],
    ['A8', 'Vehicle'], ['B8', 15000, CUR],
    ['A9', 'Total assets', B], ['B9', '=SUM(B4:B8)', CUR],
    ['A11', 'Liabilities', B],
    ['A12', 'Mortgage'], ['B12', 220000, CUR],
    ['A13', 'Car loan'], ['B13', 8000, CUR],
    ['A14', 'Credit cards'], ['B14', 1500, CUR],
    ['A15', 'Student loans'], ['B15', 12000, CUR],
    ['A16', 'Total liabilities', B], ['B16', '=SUM(B12:B15)', CUR],
    ['A18', 'Net worth', B], ['B18', '=B9-B16', CUR],
  ]
);
approx(Store.getCell('B9').value, 385000, 1e-6, 'NW: total assets');
approx(Store.getCell('B16').value, 241500, 1e-6, 'NW: total liabilities');
approx(Store.getCell('B18').value, 143500, 1e-6, 'NW: net worth');
write('net-worth.localoffice.json', nwEnv);

// ════════════════════════════════════════════════════════════════════
// 3) PM plan preset  (body type: plan - LocalPlan's tracks/sections/items model)
// ════════════════════════════════════════════════════════════════════
const planEnv = LO.createEnvelope('plan', {
  id: 'tpl-pm-plan', title: 'Project plan (PM)', app: 'localplan@1.0', tags: ['template', 'pm'],
  body: {
    planTitle: 'Project plan (PM)',
    planSubtitle: 'Phases, priorities, and what comes next.',
    tracks: [
      { id: 'proj', icon: 'P', title: 'Project', open: true, sections: [
        { name: 'Discovery', horizon: 'now', items: [
          { id: 'd1', text: 'Requirements & scope', priority: true },
          { id: 'd2', text: 'Stakeholder interviews' } ] },
        { name: 'Design', horizon: 'soon', items: [
          { id: 'de1', text: 'Architecture & approach' },
          { id: 'de2', text: 'Design review & sign-off' } ] },
        { name: 'Build', horizon: 'soon', items: [
          { id: 'b1', text: 'Core implementation' },
          { id: 'b2', text: 'Integration' } ] },
        { name: 'Test', horizon: 'later', items: [
          { id: 'q1', text: 'QA & bug fixes' },
          { id: 'q2', text: 'User acceptance testing' } ] },
        { name: 'Launch', horizon: 'later', items: [
          { id: 'l1', text: 'Release' },
          { id: 'l2', text: 'Retrospective' } ] },
      ] },
    ]
  }
});
planEnv.meta.created = planEnv.meta.modified = '2026-06-14T00:00:00.000Z';
write('pm-plan.localoffice.json', planEnv);

console.log(failed ? `\n${failed} assertion(s) FAILED.` : '\nAll templates built + asserted. ✓');
process.exit(failed ? 1 : 0);
