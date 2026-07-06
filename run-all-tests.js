// LocalOffice - consolidated verification runner.
// Runs every test suite across the LocalOffice build AND the LocalSheets repo
// (envelope/interop + the existing engine/store suites), and reports one result.
//
//   node run-all-tests.js
//
// Exit code is 0 only if every suite passes.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const BUILD = __dirname;
const SHEETS = path.join(BUILD, 'localSheets'); // LocalSheets now lives inside the build

const SUITES = [
  { name: 'LocalOffice Hub (dashboard + embed)', file: path.join(BUILD, 'verify-hub.js') },
  { name: 'LocalOffice embedded (rendering layer)', file: path.join(BUILD, 'verify-embed.js') },
  { name: 'LocalOffice core (loader/saver)',  file: path.join(BUILD, 'src', 'test-core.js') },
  { name: 'LocalOffice verify kernel',        file: path.join(BUILD, 'src', 'test-verify.js') },
  { name: 'LocalOffice render module',        file: path.join(BUILD, 'src', 'test-render.js') },
  { name: 'LocalOffice CSV adapter',          file: path.join(BUILD, 'src', 'test-csv.js') },
  { name: 'localDeck (headless browser)',     file: path.join(BUILD, 'localDeck', 'verify-deck.js') },
  { name: 'localCards (headless browser)',    file: path.join(BUILD, 'localCards', 'verify-cards.js') },
  { name: 'LocalSheets engine',               file: path.join(SHEETS, 'src', 'test-engine.js') },
  { name: 'LocalSheets Store',                file: path.join(SHEETS, 'src', 'test-store.js') },
  { name: 'LocalSheets ↔ envelope + interop', file: path.join(SHEETS, 'src', 'test-envelope.js') },
  { name: 'LocalSheets app (shipped html)',   file: path.join(SHEETS, 'verify-localsheets.js') },
  { name: 'LocalPlan (envelope adoption)',    file: path.join(BUILD, 'localPlan', 'verify-plan.js') },
  { name: 'localMindMap (mindmap)',           file: path.join(BUILD, 'localMindMap', 'verify-mindmap.js') },
  { name: 'localMark (image sanitizer)',      file: path.join(BUILD, 'localMark', 'verify-mark.js') },
  { name: 'localCheck (QA runbook)',          file: path.join(BUILD, 'localCheck', 'verify-check.js') },
  { name: 'localDoc (compliance writer)',     file: path.join(BUILD, 'localDoc', 'verify-doc.js') },
  { name: 'Templates (sheet/plan presets)',   file: path.join(BUILD, 'templates', 'verify-templates.js') },
  { name: 'localValidate (spec conformance)', file: path.join(BUILD, 'localValidate', 'verify-validate.js') },
];

function summarize(out) {
  // Each suite prints a line like "33 passed, 0 failed" or "45 passed, 0 failed".
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/i);
  return m ? { passed: +m[1], failed: +m[2] } : null;
}

console.log('Running ' + SUITES.length + ' suites…\n');
const rows = [];
let totalPass = 0, totalFail = 0, anyError = false;

for (const s of SUITES) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [s.file], { encoding: 'utf8' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  const out = (r.stdout || '') + (r.stderr || '');
  const sum = summarize(out);
  const ok = r.status === 0 && sum && sum.failed === 0;
  if (sum) { totalPass += sum.passed; totalFail += sum.failed; }
  if (!ok) anyError = true;
  rows.push({ name: s.name, ok, counts: sum ? `${sum.passed}/${sum.passed + sum.failed}` : 'ERROR', dt, out });
  process.stdout.write(`${ok ? '✓' : '✗'} ${s.name}  (${sum ? sum.passed + ' passed' : 'no summary'}, ${dt})\n`);
  if (!ok) {
    // surface the tail of a failing suite so the failure is visible inline
    console.log('  ── output tail ──');
    out.trim().split('\n').slice(-12).forEach(l => console.log('  ' + l));
  }
}

console.log('\n────────────────────────────────────────');
for (const row of rows) console.log(`  ${row.ok ? 'PASS' : 'FAIL'}  ${row.counts.padEnd(8)} ${row.name}`);
console.log('────────────────────────────────────────');
console.log(`  TOTAL: ${totalPass} passed, ${totalFail} failed across ${SUITES.length} suites`);
console.log(anyError ? '  RESULT: ✗ FAILURES PRESENT' : '  RESULT: ✓ ALL GREEN');

process.exit(anyError ? 1 : 0);
