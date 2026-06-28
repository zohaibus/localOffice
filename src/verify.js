/* ════════════════════════════════════════════════════════════════════
   LocalOffice - verification kernel (v1: exact + coverage only)
   --------------------------------------------------------------------
   The shared "check an actual value against a golden reference" primitive.
   The SAME block that grades a flashcard can later describe a DV scoreboard
   check, a software-QA snapshot diff, or a robotics tolerance check.

   v1 ships ONLY the two deterministic comparators the spec allows:
     • exact     - normalized equality against an expected string
     • coverage  - required keywords/bins all present

   HARD RULE: every comparator here is deterministic. The non-deterministic
   `semantic` (LLM) comparator is OUT of v1 and must never decide correctness.
   A dozen further comparators (tolerance, diff, set, temporal, formal, hash,
   signature, merkle, schema, contract) are reserved/documented - NOT built.

   No dependencies. Browser (window.LocalVerify) + Node (module.exports).

   verify block shape (lives inside a body, e.g. a flashcard):
     { comparator, params, deterministic, result:{ pass, score, detail } }
   ════════════════════════════════════════════════════════════════════ */
'use strict';
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.LocalVerify = mod;
})(function () {

  // exact + coverage (v1); tolerance promoted in v2 for localCheck - still
  // fully deterministic (numeric bounds, no LLM). The rest stay reserved.
  const COMPARATORS = ['exact', 'coverage', 'tolerance'];

  // Normalize a string for comparison. Defaults are forgiving (trim, collapse
  // inner whitespace, case-insensitive) - each is togglable via params.
  function normalize(s, params = {}) {
    let out = String(s == null ? '' : s);
    if (params.trim !== false) out = out.trim();
    if (params.collapseWhitespace !== false) out = out.replace(/\s+/g, ' ');
    if (!params.caseSensitive) out = out.toLowerCase();
    if (params.stripPunctuation) out = out.replace(/[.,;:!?'"()\[\]{}]/g, '');
    return out;
  }

  // exact: normalized actual === normalized expected.
  // params: { expected, caseSensitive?, trim?, collapseWhitespace?, stripPunctuation? }
  // FAIL CLOSED on an empty/absent expected: otherwise an empty answer would match
  // an empty target (e.g. an exact step whose `expected` was never authored), a
  // silent auto-pass of an unverified check. An empty expected can't grade anything.
  function exact(actual, params = {}) {
    const exp = normalize(params.expected, params);
    const got = normalize(actual, params);
    if (params.expected == null || exp === '') return { pass: false, score: 0, detail: { expected: params.expected == null ? '' : String(params.expected), got: String(actual == null ? '' : actual), reason: 'no expected value' } };
    const pass = got === exp;
    return { pass, score: pass ? 1 : 0, detail: { expected: String(params.expected), got: String(actual == null ? '' : actual) } };
  }

  // Does `needle` appear in `hay` as a whole word? Anchored at a word boundary
  // on the left (so "patch" does NOT match "dispatched"), but tolerant of
  // suffixes on the right (so "patch" DOES match "patched"/"patches"). This is
  // the right default for a keyword gate: it rejects word-salad false positives
  // while still accepting the keyword's natural inflections. Needles that start
  // with a non-word char skip the left anchor.
  function wordHit(hay, needle) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lead = /^\w/.test(needle) ? '\\b' : '';
    return new RegExp(lead + esc).test(hay);
  }

  // coverage: every required keyword/bin must appear in the actual answer.
  // params: { required:[...], threshold?=1, wordBoundary?, caseSensitive?, ... }
  //   - wordBoundary (default false): match whole words (see wordHit) instead of
  //     raw substrings. localDoc's compliance linter opts in; flashcards do not.
  // score = hits / required. pass = score >= threshold.
  function coverage(actual, params = {}) {
    const required = Array.isArray(params.required) ? params.required : [];
    const hay = normalize(actual, params);
    const wb = !!params.wordBoundary;
    const hit = [], missed = [];
    for (const kw of required) {
      const needle = normalize(kw, params);
      const present = needle && (wb ? wordHit(hay, needle) : hay.indexOf(needle) !== -1);
      if (present) hit.push(kw); else missed.push(kw);
    }
    const total = required.length;
    const score = total ? hit.length / total : 0;
    // threshold clamps to (0,1]: a threshold of 0 (or negative) would make score>=0
    // always true - an auto-pass with ZERO keywords matched. Default + invalid -> 1
    // (require all), the fail-closed direction for a gate.
    const threshold = (typeof params.threshold === 'number' && params.threshold > 0) ? Math.min(params.threshold, 1) : 1;
    return { pass: total > 0 && score >= threshold, score, detail: { hit, missed, threshold } };
  }

  // Pull the first number out of a value (so "1.15V", "≈ 42 ms" → 1.15, 42).
  function toNum(v) {
    if (typeof v === 'number') return v;
    const m = String(v == null ? '' : v).match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }
  // tolerance: a numeric actual must fall within bounds. Deterministic - the
  // verification thesis as a numeric gate (DV margins, robotics limits, QA specs).
  // params: { expected, abs?, rel?, min?, max? }
  //   - min/max given → pass iff min ≤ actual ≤ max
  //   - else expected given → window [expected−t, expected+t], t = max(abs, rel·|expected|)
  function tolerance(actual, params = {}) {
    const a = toNum(actual);
    if (Number.isNaN(a)) return { pass: false, score: 0, detail: { reason: 'no numeric value in actual', got: String(actual == null ? '' : actual) } };
    let lo, hi, basis;
    if (params.min != null || params.max != null) {
      lo = params.min != null ? params.min : -Infinity;
      hi = params.max != null ? params.max : Infinity;
      basis = 'range';
    } else if (params.expected != null) {
      const abs = params.abs != null ? params.abs : 0;
      const rel = params.rel != null ? Math.abs(params.expected) * params.rel : 0;
      const t = Math.max(abs, rel);
      lo = params.expected - t; hi = params.expected + t; basis = 'expected';
    } else {
      return { pass: false, score: 0, detail: { reason: 'tolerance needs min/max or expected' } };
    }
    const pass = a >= lo && a <= hi;
    return { pass, score: pass ? 1 : 0, detail: { actual: a, lo, hi, basis } };
  }

  const FNS = { exact, coverage, tolerance };

  // Is this a comparator v1 actually implements?
  function isSupported(comparator) { return COMPARATORS.indexOf(comparator) !== -1; }

  // Run a verify block against an observed value. Returns { pass, score, detail }
  // and (if mutate !== false) writes it into block.result. Throws on an
  // unsupported comparator (e.g. a reserved one, or `semantic`) - by design,
  // so a pipeline can't silently accept a non-deterministic verdict.
  function run(block, actual, opts = {}) {
    if (!block || typeof block !== 'object') throw new Error('verify: missing block');
    const comparator = block.comparator;
    if (!isSupported(comparator)) {
      throw new Error(`verify: comparator "${comparator}" is not available in v1 (only ${COMPARATORS.join(', ')}).`);
    }
    const result = FNS[comparator](actual, block.params || {});
    if (opts.mutate !== false) {
      block.result = result;
      // verify blocks assert determinism; these comparators are always deterministic
      if (block.deterministic == null) block.deterministic = true;
    }
    return result;
  }

  // Build a fresh, well-formed verify block.
  function makeBlock(comparator, params = {}) {
    if (!isSupported(comparator)) throw new Error(`verify: unsupported comparator "${comparator}"`);
    return { comparator, params, deterministic: true, result: { pass: null, score: null, detail: {} } };
  }

  return { COMPARATORS, normalize, exact, coverage, tolerance, toNum, run, makeBlock, isSupported };
});
