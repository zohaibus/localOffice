// LocalOffice shared core (loader/saver) unit tests.
// Run: node src/test-core.js
'use strict';
const LO = require('./core');

// ── tiny harness (matches LocalSheets test-store.js) ────────────────
let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({ name, err: e }); process.stdout.write('F'); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'eq'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'expected throw');
}

// ════════════════════════════════════════════════════════════════════
// uuid
// ════════════════════════════════════════════════════════════════════
test('uuid: shape is v4-ish and unique', () => {
  const a = LO.uuid(), b = LO.uuid();
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), 'uuid format: ' + a);
  ok(a !== b, 'uuids differ');
});

// ════════════════════════════════════════════════════════════════════
// createEnvelope
// ════════════════════════════════════════════════════════════════════
test('createEnvelope: well-formed envelope for each known type', () => {
  for (const t of LO.TYPES) {
    const env = LO.createEnvelope(t, { title: 'X', app: 'tool@1' });
    eq(env.format, 'localoffice/v1');
    eq(env.type, t);
    eq(env.meta.title, 'X');
    eq(env.meta.app, 'tool@1');
    ok(Array.isArray(env.meta.tags), 'tags array');
    ok(LO.validate(env).ok, 'created envelope validates: ' + t);
  }
});

test('createEnvelope: default body matches type', () => {
  eq(JSON.stringify(LO.createEnvelope('sheet').body), JSON.stringify({ sheets: [] }));
  eq(JSON.stringify(LO.createEnvelope('plan').body), JSON.stringify({ tasks: [] }));
  eq(JSON.stringify(LO.createEnvelope('mindmap').body), JSON.stringify({ nodes: [], edges: [] }));
  eq(LO.createEnvelope('flashcards').body.scheduler, 'fsrs-lite');
  eq(Array.isArray(LO.createEnvelope('slides').body.slides), true);
});

test('createEnvelope: created === modified on a fresh file', () => {
  const env = LO.createEnvelope('sheet');
  eq(env.meta.created, env.meta.modified);
});

test('createEnvelope: never stamps identifying metadata', () => {
  const env = LO.createEnvelope('slides', { title: 'Deck' });
  const keys = Object.keys(env.meta).sort().join(',');
  eq(keys, 'app,created,id,modified,tags,title'); // no author/user/machine
});

test('createEnvelope: rejects unknown type', () => {
  throws(() => LO.createEnvelope('bogus'));
});

test('createEnvelope: accepts a provided body', () => {
  const env = LO.createEnvelope('sheet', { body: { sheets: [{ name: 'S' }] } });
  eq(env.body.sheets[0].name, 'S');
});

// ════════════════════════════════════════════════════════════════════
// validate
// ════════════════════════════════════════════════════════════════════
test('validate: a good envelope passes with no warnings', () => {
  const r = LO.validate(LO.createEnvelope('plan'));
  eq(r.ok, true);
  eq(r.warnings.length, 0);
});

test('validate: non-object fails', () => {
  eq(LO.validate(null).ok, false);
  eq(LO.validate(42).ok, false);
  eq(LO.validate([]).ok, false);
});

test('validate: missing format is fatal', () => {
  eq(LO.validate({ type: 'sheet', meta: {}, body: {} }).ok, false);
});

test('validate: wrong format prefix is fatal', () => {
  eq(LO.validate({ format: 'something/else', type: 'sheet', meta: {}, body: {} }).ok, false);
});

test('validate: missing type is fatal', () => {
  eq(LO.validate({ format: 'localoffice/v1', meta: {}, body: {} }).ok, false);
});

test('validate: unknown type loads with a warning (graceful degradation)', () => {
  const r = LO.validate({ format: 'localoffice/v1', type: 'kanban', meta: {}, body: {} });
  eq(r.ok, true);
  eq(r.warnings.length, 1);
});

test('validate: missing meta is fatal', () => {
  eq(LO.validate({ format: 'localoffice/v1', type: 'sheet', body: {} }).ok, false);
});

test('validate: missing body warns but is loadable', () => {
  const r = LO.validate({ format: 'localoffice/v1', type: 'sheet', meta: {} });
  eq(r.ok, true);
  ok(r.warnings.length >= 1, 'body warning present');
});

test('validate: newer format version warns but loads', () => {
  const r = LO.validate({ format: 'localoffice/v2', type: 'sheet', meta: {}, body: {} });
  eq(r.ok, true);
  eq(r.formatVersion, 'v2');
  ok(r.warnings.length >= 1, 'version warning');
});

// ════════════════════════════════════════════════════════════════════
// normalize
// ════════════════════════════════════════════════════════════════════
test('normalize: fills missing meta fields', () => {
  const obj = { format: 'localoffice/v1', type: 'sheet', meta: {}, body: {} };
  LO.normalize(obj);
  ok(obj.meta.id, 'id filled');
  eq(typeof obj.meta.created, 'string');
  eq(obj.meta.modified, obj.meta.created);
  ok(Array.isArray(obj.meta.tags), 'tags filled');
});

test('normalize: defaults a missing body from the type', () => {
  const obj = { format: 'localoffice/v1', type: 'mindmap', meta: {} };
  LO.normalize(obj);
  eq(Array.isArray(obj.body.nodes), true);
  eq(Array.isArray(obj.body.edges), true);
});

test('normalize: preserves unknown meta + body fields (forward-compat)', () => {
  const obj = {
    format: 'localoffice/v1', type: 'sheet',
    meta: { title: 'T', futureFlag: true },
    body: { sheets: [], experimentalView: { zoom: 2 } }
  };
  LO.normalize(obj);
  eq(obj.meta.futureFlag, true);
  eq(obj.body.experimentalView.zoom, 2);
});

// ════════════════════════════════════════════════════════════════════
// parse / stringify / serialize  (round-trip)
// ════════════════════════════════════════════════════════════════════
test('parse: round-trips a valid file', () => {
  const env = LO.createEnvelope('sheet', { title: 'Budget' });
  const { envelope } = LO.parse(LO.stringify(env));
  eq(envelope.meta.title, 'Budget');
  eq(envelope.type, 'sheet');
});

test('parse: throws LoadError on non-JSON', () => {
  let err = null;
  try { LO.parse('{not json'); } catch (e) { err = e; }
  ok(err instanceof LO.LoadError, 'LoadError thrown');
});

test('parse: throws on a non-envelope JSON object', () => {
  throws(() => LO.parse(JSON.stringify({ hello: 'world' })));
});

test('parse: preserves unknown fields through a full round-trip', () => {
  const original = {
    format: 'localoffice/v1', type: 'plan',
    meta: { id: 'fixed-id', title: 'P', created: '2026-01-01T00:00:00.000Z',
            modified: '2026-01-01T00:00:00.000Z', app: 'x@1', tags: [], custom: 9 },
    body: { tasks: [], roadmapExtra: [1, 2, 3] },
    topLevelUnknown: { keep: true }
  };
  const text = LO.stringify(original);
  const { envelope } = LO.parse(text);
  eq(envelope.meta.custom, 9);
  eq(JSON.stringify(envelope.body.roadmapExtra), '[1,2,3]');
  eq(envelope.topLevelUnknown.keep, true);
});

test('parse: coerce seam adapts a non-envelope file (step-3 back-compat seam)', () => {
  // Simulate an old LocalSheets file being coerced into an envelope.
  const legacy = JSON.stringify({ tool: 'localsheets', version: '2.0',
                                  meta: { title: 'Legacy' }, sheets: {}, sheetOrder: [], activeSheet: '' });
  const coerce = (raw) => {
    if (raw && raw.tool === 'localsheets') {
      return LO.createEnvelope('sheet', { title: (raw.meta && raw.meta.title) || '', app: 'localsheets@legacy', body: { _legacy: raw } });
    }
    return null;
  };
  const { envelope } = LO.parse(legacy, { coerce });
  eq(envelope.type, 'sheet');
  eq(envelope.meta.title, 'Legacy');
  eq(envelope.body._legacy.version, '2.0');
});

test('serialize: stamps a newer meta.modified', () => {
  const env = LO.createEnvelope('sheet');
  env.meta.modified = '2000-01-01T00:00:00.000Z';
  LO.serialize(env);
  ok(env.meta.modified !== '2000-01-01T00:00:00.000Z', 'modified updated');
});

test('serialize: touch:false leaves modified untouched', () => {
  const env = LO.createEnvelope('sheet');
  const before = env.meta.modified = '2000-01-01T00:00:00.000Z';
  LO.serialize(env, { touch: false });
  eq(env.meta.modified, before);
});

test('serialize: throws on an invalid envelope', () => {
  throws(() => LO.serialize({ format: 'nope' }));
});

test('serialize: output is valid pretty JSON that re-parses', () => {
  const env = LO.createEnvelope('flashcards', { title: 'Deck' });
  const text = LO.serialize(env);
  ok(text.includes('\n'), 'pretty-printed');
  const { envelope } = LO.parse(text);
  eq(envelope.meta.title, 'Deck');
});

// ════════════════════════════════════════════════════════════════════
// dispatch
// ════════════════════════════════════════════════════════════════════
test('dispatch: routes to the matching type handler', () => {
  const env = LO.createEnvelope('plan');
  const out = LO.dispatch(env, { plan: (e) => 'plan:' + e.type, default: () => 'def' });
  eq(out, 'plan:plan');
});

test('dispatch: unknown type falls back to default', () => {
  const env = { format: 'localoffice/v1', type: 'kanban', meta: {}, body: {} };
  eq(LO.dispatch(env, { sheet: () => 's', default: () => 'fallback' }), 'fallback');
});

test('dispatch: throws when neither handler nor default exists', () => {
  throws(() => LO.dispatch(LO.createEnvelope('sheet'), { plan: () => 1 }));
});

// ════════════════════════════════════════════════════════════════════
// suggestedName / slugify
// ════════════════════════════════════════════════════════════════════
test('suggestedName: slugifies the title and adds the extension', () => {
  const env = LO.createEnvelope('slides', { title: 'Q3 Field Report!' });
  eq(LO.suggestedName(env), 'q3-field-report.localoffice.json');
});

test('suggestedName: falls back to type when title is empty', () => {
  eq(LO.suggestedName(LO.createEnvelope('sheet')), 'sheet.localoffice.json');
});

// ════════════════════════════════════════════════════════════════════
console.log('\n');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.message}`);
  }
  process.exit(1);
}
process.exit(0);
