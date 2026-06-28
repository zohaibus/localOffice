// LocalSheets ↔ localoffice/v1 envelope adapter tests.
// Run: node src/test-envelope.js
'use strict';
const fs = require('fs');
const path = require('path');

// Boot the engine + Store exactly like test-store.js does.
const E = require('./engine');
global.E = E;
const appCode = fs.readFileSync(path.join(__dirname, 'app-layer.js'), 'utf-8');
const wrapped = appCode.replace(/^'use strict';\s*/m, '') + `
  global.Store = Store; global.DepGraph = DepGraph; global.applyNumFmt = applyNumFmt;
  global.SCHEMA_VERSION = SCHEMA_VERSION; global.DEFAULT_COL_WIDTH = DEFAULT_COL_WIDTH;
`;
eval(wrapped);

const ENV = require('./envelope');
// Cross-tool: the SHARED LocalOffice loader. Proves the format is genuinely one.
const CORE = process.env.LOCALOFFICE_CORE || path.join(__dirname, '..', '..', 'src', 'core.js');
let LO = null; try { LO = require(CORE); } catch (e) { /* reported in the interop test */ }

// ── harness (matches test-store.js) ─────────────────────────────────
let passed = 0, failed = 0; const failures = [];
function test(name, fn) { try { fn(); passed++; process.stdout.write('.'); } catch (e) { failed++; failures.push({ name, err: e }); process.stdout.write('F'); } }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

// Build a representative workbook: literals, formulas, cross-sheet refs,
// number format, column width, row height, merges, tables, conditional rules.
function buildWorkbook() {
  Store.reset();
  Store.setCell('A1', '10');
  Store.setCell('A2', '20');
  Store.setCell('A3', '=SUM(A1:A2)');
  Store.setFormat('A3', { numfmt: 'currency' });
  Store.setCell('B1', 'Label');           // text literal
  Store.setColWidth(0, 150);              // col A
  Store.setRowHeight(2, 40);              // row index 2 → row 3
  const dataId = Store.addSheet('Data');
  Store.setCell('B1', '99', { sheetId: dataId });
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('C1', '=Data!B1');        // cross-sheet
  const s = Store.activeSheet();
  s.merges = ['A1:B1'];
  s.tables = [{ range: 'A1:C3' }];
  s.conditionalRules = [{ range: 'A1:A3', op: '>', value: 5 }];
  s.filters = { 2: ['x'] };
}

// ════════════════════════════════════════════════════════════════════
// toEnvelope shape
// ════════════════════════════════════════════════════════════════════
test('toEnvelope: produces a valid localoffice/v1 sheet envelope', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  eq(env.format, 'localoffice/v1');
  eq(env.type, 'sheet');
  ok(env.meta.id, 'meta.id present');
  ok(/^localsheets@/.test(env.meta.app), 'app stamped');
  eq(env.body.sheets.length, 2);
});

test('toEnvelope: formula cells become { f }, literals become { v: raw }', () => {
  buildWorkbook();
  const s0 = ENV.toEnvelope(Store.data, E).body.sheets[0];
  eq(s0.cells.A3.f, '=SUM(A1:A2)');
  eq(s0.cells.A1.v, '10');
  eq(s0.cells.B1.v, 'Label');
});

test('toEnvelope: cached value/type are NOT written (recipe, not snapshot)', () => {
  buildWorkbook();
  const s0 = ENV.toEnvelope(Store.data, E).body.sheets[0];
  ok(!('value' in s0.cells.A3), 'no cached value on formula');
  ok(!('type' in s0.cells.A3), 'no cached type on formula');
  ok(!('value' in s0.cells.A1), 'no cached value on literal');
});

test('toEnvelope: cell format is preserved', () => {
  buildWorkbook();
  const s0 = ENV.toEnvelope(Store.data, E).body.sheets[0];
  eq(s0.cells.A3.format.numfmt, 'currency');
});

test('toEnvelope: colWidths→cols by letter, rowHeights→rows by 1-based number', () => {
  buildWorkbook();
  const s0 = ENV.toEnvelope(Store.data, E).body.sheets[0];
  eq(s0.cols.A.w, 150);
  eq(s0.rows[3].h, 40);   // row index 2 → row number 3
});

test('toEnvelope: sheet-structural extras pass through unchanged', () => {
  buildWorkbook();
  const s0 = ENV.toEnvelope(Store.data, E).body.sheets[0];
  eq(s0.merges[0], 'A1:B1');
  eq(s0.tables[0].range, 'A1:C3');
  eq(s0.conditionalRules[0].value, 5);
  eq(s0.filters['2'][0], 'x');
});

test('round-trip: per-cell note + list-validation survive (no data loss)', () => {
  buildWorkbook();
  const s = Store.activeSheet();
  s.cells.A1.note = 'check this value';
  s.cells.B1.validation = { type: 'list', values: ['x', 'y', 'z'] };
  const env = ENV.toEnvelope(Store.data, E);
  // present in the serialized envelope
  eq(env.body.sheets[0].cells.A1.note, 'check this value');
  eq(env.body.sheets[0].cells.B1.validation.type, 'list');
  // and survive the trip back
  const back = ENV.fromEnvelope(env, E);
  const bs = back.sheets[back.sheetOrder[0]];
  eq(bs.cells.A1.note, 'check this value');
  eq(bs.cells.B1.validation.values.length, 3);
});

test('round-trip: unknown per-cell fields are preserved (forward-compat)', () => {
  buildWorkbook();
  Store.activeSheet().cells.A1.futureCellField = { someNew: 7 };
  const env = ENV.toEnvelope(Store.data, E);
  eq(env.body.sheets[0].cells.A1.futureCellField.someNew, 7);
  const back = ENV.fromEnvelope(env, E);
  eq(back.sheets[back.sheetOrder[0]].cells.A1.futureCellField.someNew, 7);
});

test('toEnvelope: view block carries disposable state, body does not', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  eq(env.view.active, 0);
  eq(env.view.selections.length, 2);
  ok('settings' in env.view, 'settings live in view');
  ok(!('activeSheet' in env.body), 'no view state in body');
});

// ════════════════════════════════════════════════════════════════════
// GOLDEN round-trip: data → envelope → data → recompute === original
// ════════════════════════════════════════════════════════════════════
function reload(env) {
  const data = ENV.fromEnvelope(env, E);
  Store.data = data; DepGraph.clear(); Store.recalcAll();
  return data;
}

test('round-trip: recomputed formula values match', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  reload(env);
  eq(Store.getCell('A3').value, 30);
  eq(Store.getCell('A3').formula, '=SUM(A1:A2)');
});

test('round-trip: cross-sheet references resolve', () => {
  buildWorkbook();
  reload(ENV.toEnvelope(Store.data, E));
  eq(Store.getCell('C1').value, 99);
});

test('round-trip: number format survives (currency display)', () => {
  buildWorkbook();
  reload(ENV.toEnvelope(Store.data, E));
  eq(Store.getDisplay('A3'), '$30.00');
});

test('round-trip: column width and row height survive', () => {
  buildWorkbook();
  reload(ENV.toEnvelope(Store.data, E));
  eq(Store.getColWidth(0), 150);
  eq(Store.getRowHeight(2), 40);
});

test('round-trip: merges / tables / conditionalRules / filters survive', () => {
  buildWorkbook();
  reload(ENV.toEnvelope(Store.data, E));
  const s = Store.activeSheet();
  eq(s.merges[0], 'A1:B1');
  eq(s.tables[0].range, 'A1:C3');
  eq(s.conditionalRules[0].op, '>');
  eq(s.filters['2'][0], 'x');
});

test('round-trip: active sheet + selection restored from view block', () => {
  buildWorkbook();
  Store.setActiveSheet(Store.data.sheetOrder[1]); // make Data active
  Store.activeSheet().selR = 3; Store.activeSheet().selC = 1;
  const env = ENV.toEnvelope(Store.data, E);
  reload(env);
  eq(Store.activeSheet().name, 'Data');
  eq(Store.activeSheet().selR, 3);
  eq(Store.activeSheet().selC, 1);
});

test('round-trip: meta.id is stable across open→save', () => {
  buildWorkbook();
  const env1 = ENV.toEnvelope(Store.data, E);
  reload(env1);
  const env2 = ENV.toEnvelope(Store.data, E);
  eq(env2.meta.id, env1.meta.id);
});

test('round-trip: sheet order preserved', () => {
  buildWorkbook();
  reload(ENV.toEnvelope(Store.data, E));
  eq(Store.data.sheets[Store.data.sheetOrder[0]].name, 'Sheet1');
  eq(Store.data.sheets[Store.data.sheetOrder[1]].name, 'Data');
});

// ════════════════════════════════════════════════════════════════════
// Legacy detection + migration of an OLD v2.0 file (cached value/type)
// ════════════════════════════════════════════════════════════════════
test('detectFormat: classifies envelope / legacy-v2 / legacy-v1 / unknown', () => {
  eq(ENV.detectFormat({ format: 'localoffice/v1', type: 'sheet' }), 'envelope');
  eq(ENV.detectFormat({ tool: 'localsheets', version: '2.0' }), 'legacy-v2');
  eq(ENV.detectFormat({ tool: 'localsheets', version: '1.1' }), 'legacy-v1');
  eq(ENV.detectFormat({ hello: 'world' }), 'unknown');
});

test('legacy v2.0 file (with cached value/type) re-saves cleanly as a recipe envelope', () => {
  const legacy = {
    version: '2.0', tool: 'localsheets', meta: { title: 'Legacy' },
    created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z',
    sheets: { s1: { name: 'Sheet1', colWidths: {}, selR: 0, selC: 0, cells: {
      A1: { raw: '5', value: 5, type: 'number' },
      A2: { raw: '=A1*2', formula: '=A1*2', value: 10, type: 'number' }
    } } },
    sheetOrder: ['s1'], activeSheet: 's1', settings: {}
  };
  Store.data = legacy; DepGraph.clear(); Store.recalcAll();
  const env = ENV.toEnvelope(Store.data, E);
  eq(env.body.sheets[0].cells.A2.f, '=A1*2');
  eq(env.body.sheets[0].cells.A1.v, '5');
  ok(!('value' in env.body.sheets[0].cells.A1), 'cached value dropped on migration');
  // and it still recomputes correctly when reopened
  reload(env);
  eq(Store.getCell('A2').value, 10);
});

// ════════════════════════════════════════════════════════════════════
// INTEROP: a LocalSheets envelope is a first-class LocalOffice file.
// ════════════════════════════════════════════════════════════════════
test('interop: shared LocalOffice core.js is reachable', () => { ok(LO, 'could not require LocalOffice_build/src/core.js'); });

test('interop: shared core validates a LocalSheets envelope', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  const r = LO.validate(env);
  eq(r.ok, true);
  eq(r.type, 'sheet');
});

test('interop: shared core parses it, preserving body + the unknown view block', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  const { envelope } = LO.parse(LO.stringify(env));
  eq(envelope.type, 'sheet');
  eq(envelope.body.sheets[0].cells.A3.f, '=SUM(A1:A2)');
  ok(envelope.view, 'view block preserved by the core (forward-compat)');
  eq(envelope.view.active, 0);
});

test('interop: shared core can dispatch on type', () => {
  buildWorkbook();
  const env = ENV.toEnvelope(Store.data, E);
  const label = LO.dispatch(env, { sheet: (e) => 'is-sheet:' + e.body.sheets.length, default: () => 'other' });
  eq(label, 'is-sheet:2');
});

// ════════════════════════════════════════════════════════════════════
console.log('\n');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) { console.log(`  ✗ ${f.name}`); console.log(`    ${f.err.message}`); }
  process.exit(1);
}
process.exit(0);
