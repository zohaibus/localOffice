// LocalOffice verification kernel tests.
// Run: node src/test-verify.js
'use strict';
const V = require('./verify');

let passed = 0, failed = 0; const failures = [];
function test(name, fn) { try { fn(); passed++; process.stdout.write('.'); } catch (e) { failed++; failures.push({ name, err: e }); process.stdout.write('F'); } }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function throws(fn, msg) { let t = false; try { fn(); } catch { t = true; } if (!t) throw new Error(msg || 'expected throw'); }
function approx(a, b) { if (Math.abs(a - b) > 1e-9) throw new Error(`approx: got ${a}, expected ${b}`); }

// ── exact ───────────────────────────────────────────────────────────
test('exact: identical strings pass', () => {
  const r = V.exact('Paris', { expected: 'Paris' });
  eq(r.pass, true); eq(r.score, 1);
});
test('exact: case-insensitive + trim + whitespace by default', () => {
  eq(V.exact('  the   ANSWER ', { expected: 'the answer' }).pass, true);
});
test('exact: caseSensitive param enforces case', () => {
  eq(V.exact('paris', { expected: 'Paris', caseSensitive: true }).pass, false);
});
test('exact: stripPunctuation option', () => {
  eq(V.exact('hello, world!', { expected: 'hello world', stripPunctuation: true }).pass, true);
});
test('exact: mismatch fails and reports detail', () => {
  const r = V.exact('London', { expected: 'Paris' });
  eq(r.pass, false); eq(r.detail.expected, 'Paris'); eq(r.detail.got, 'London');
});
test('exact: empty actual vs non-empty expected fails', () => {
  eq(V.exact('', { expected: 'x' }).pass, false);
});

// ── coverage ────────────────────────────────────────────────────────
test('coverage: all required keywords present → pass, score 1', () => {
  const r = V.coverage('mitochondria is the powerhouse of the cell', { required: ['mitochondria', 'cell'] });
  eq(r.pass, true); eq(r.score, 1);
  eq(r.detail.missed.length, 0);
});
test('coverage: partial hit → score is the fraction, fails default threshold', () => {
  const r = V.coverage('the cell has a nucleus', { required: ['cell', 'mitochondria'] });
  approx(r.score, 0.5); eq(r.pass, false);
  eq(r.detail.hit[0], 'cell'); eq(r.detail.missed[0], 'mitochondria');
});
test('coverage: threshold param allows partial pass', () => {
  const r = V.coverage('the cell', { required: ['cell', 'mitochondria'], threshold: 0.5 });
  eq(r.pass, true);
});
test('coverage: empty required never passes', () => {
  eq(V.coverage('anything', { required: [] }).pass, false);
});
test('coverage: case-insensitive by default', () => {
  eq(V.coverage('The CELL', { required: ['cell'] }).pass, true);
});
test('coverage: default substring matching (unchanged for flashcards)', () => {
  // "dispatched" contains "patch" - a substring hit. This is the legacy behavior
  // flashcards rely on; it must stay the default.
  eq(V.coverage('dispatched', { required: ['patch'] }).pass, true);
});
test('coverage: wordBoundary rejects substring false-positives', () => {
  eq(V.coverage('dispatched', { required: ['patch'], wordBoundary: true }).pass, false);
  eq(V.coverage('redeployed', { required: ['deployed'], wordBoundary: true }).pass, false);
});
test('coverage: wordBoundary still tolerates suffixes (patch → patched)', () => {
  eq(V.coverage('we patched it', { required: ['patch'], wordBoundary: true }).pass, true);
  eq(V.coverage('the fix deploys', { required: ['deploy'], wordBoundary: true }).pass, true);
});
test('coverage: wordBoundary matches a real whole word', () => {
  eq(V.coverage('a patch was deployed', { required: ['patch', 'deployed'], wordBoundary: true }).pass, true);
});
test('coverage: wordBoundary handles multi-word + regex-special needles', () => {
  eq(V.coverage('the root cause is clear', { required: ['root cause'], wordBoundary: true }).pass, true);
  eq(V.coverage('written in c++ here', { required: ['c++'], wordBoundary: true }).pass, true);
});
test('coverage: threshold 0 / negative does NOT auto-pass with zero hits (fail closed)', () => {
  eq(V.coverage('totally unrelated', { required: ['x'], threshold: 0 }).pass, false);
  eq(V.coverage('totally unrelated', { required: ['x'], threshold: -1 }).pass, false);
  // a legitimate partial threshold still works
  eq(V.coverage('has a', { required: ['a', 'b'], threshold: 0.5 }).pass, true);
});
test('exact: empty / absent expected fails closed (an empty answer must not match)', () => {
  eq(V.exact('', {}).pass, false);
  eq(V.exact('', { expected: '' }).pass, false);
  eq(V.exact('   ', { expected: '   ' }).pass, false);
  // a real expected still grades normally
  eq(V.exact('42', { expected: '42' }).pass, true);
  eq(V.exact('', { expected: '42' }).pass, false);
});

// ── run() dispatch + block ──────────────────────────────────────────
test('run: dispatches exact and writes result into the block', () => {
  const block = V.makeBlock('exact', { expected: '42' });
  const r = V.run(block, '42');
  eq(r.pass, true);
  eq(block.result.pass, true);
  eq(block.deterministic, true);
});
test('run: dispatches coverage', () => {
  const block = V.makeBlock('coverage', { required: ['a', 'b'] });
  V.run(block, 'a and b');
  eq(block.result.pass, true);
});
test('run: mutate:false leaves the block untouched', () => {
  const block = V.makeBlock('exact', { expected: 'x' });
  V.run(block, 'x', { mutate: false });
  eq(block.result.pass, null);
});
test('run: throws on the reserved/forbidden semantic comparator', () => {
  throws(() => V.run({ comparator: 'semantic', params: {} }, 'anything'));
});
test('run: throws on a still-reserved comparator (e.g. diff)', () => {
  throws(() => V.run({ comparator: 'diff', params: {} }, '1'));
});

// ── tolerance (v2 - deterministic numeric gate) ─────────────────────
test('tolerance: range pass/fail', () => {
  eq(V.tolerance('1.15', { min: 1.1, max: 1.2 }).pass, true);
  eq(V.tolerance('1.25', { min: 1.1, max: 1.2 }).pass, false);
});
test('tolerance: expected ± abs', () => {
  eq(V.tolerance('1.15', { expected: 1.1, abs: 0.05 }).pass, true);
  eq(V.tolerance('1.2', { expected: 1.1, abs: 0.05 }).pass, false);
});
test('tolerance: expected with relative tolerance', () => {
  eq(V.tolerance('104', { expected: 100, rel: 0.05 }).pass, true);   // within 5%
  eq(V.tolerance('110', { expected: 100, rel: 0.05 }).pass, false);
});
test('tolerance: parses a number out of a units string', () => {
  const r = V.tolerance('1.15 V', { expected: 1.15, abs: 0.01 });
  eq(r.pass, true); eq(r.detail.actual, 1.15);
});
test('tolerance: non-numeric actual fails (no LLM guessing)', () => {
  eq(V.tolerance('about right', { expected: 1 }).pass, false);
});
test('tolerance: missing spec fails closed', () => {
  eq(V.tolerance('5', {}).pass, false);
});
test('run: dispatches tolerance and gates pass/fail', () => {
  const block = V.makeBlock('tolerance', { min: 0, max: 10 });
  eq(V.run(block, '7').pass, true);
  eq(block.result.pass, true);
  eq(V.run(V.makeBlock('tolerance', { min: 0, max: 10 }), '12').pass, false);
});

// ── invariants ──────────────────────────────────────────────────────
test('supported set is exact + coverage + tolerance; the rest stay reserved', () => {
  eq(V.COMPARATORS.join(','), 'exact,coverage,tolerance');
  eq(V.isSupported('exact'), true);
  eq(V.isSupported('coverage'), true);
  eq(V.isSupported('tolerance'), true);
  eq(V.isSupported('semantic'), false);
  eq(V.isSupported('hash'), false);
  eq(V.isSupported('diff'), false);
});
test('makeBlock builds a determinism-asserting block', () => {
  const b = V.makeBlock('coverage', { required: ['x'] });
  eq(b.deterministic, true);
  eq(b.result.pass, null);
  throws(() => V.makeBlock('semantic'));
});
test('comparators are deterministic (same input → same output)', () => {
  const a = V.coverage('a b c', { required: ['a', 'z'] });
  const b = V.coverage('a b c', { required: ['a', 'z'] });
  eq(JSON.stringify(a), JSON.stringify(b));
});

console.log('\n');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) { console.log(`  ✗ ${f.name}`); console.log(`    ${f.err.message}`); }
  process.exit(1);
}
process.exit(0);
