// Headless verification of localValidate (the localoffice/v1 conformance checker).
// Run: node localValidate/verify-validate.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const FILE_URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

const ISO = '2026-01-01T00:00:00.000Z';
const goodMeta = { id: 'x1', title: 'T', created: ISO, modified: ISO, app: 'a@1', tags: ['t'] };
const ok = (type, extra) => Object.assign({ format: 'localoffice/v1', type: type || 'doc', meta: Object.assign({}, goodMeta), body: {} }, extra || {});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const net = []; page.on('request', r => { if (/^https?:/i.test(r.url())) net.push(r.url()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(80);

  check('localValidate boots with no errors', errors.length === 0);
  check('exposes LV.validate', await page.evaluate(() => typeof LV === 'object' && typeof LV.validate === 'function'));

  const verdict = env => page.evaluate(e => LV.validate(JSON.stringify(e)).verdict, env);
  const rulesOf = env => page.evaluate(e => LV.validate(JSON.stringify(e)).rules, env);

  // ── happy path ──
  check('a well-formed envelope conforms (pass)', await verdict(ok('doc', { body: { blocks: [] } })) === 'pass');
  check('every registered type conforms', await page.evaluate((ISO) => {
    const types = ['slides', 'flashcards', 'sheet', 'plan', 'mindmap', 'image', 'runbook', 'doc'];
    return types.every(t => LV.validate(JSON.stringify({ format: 'localoffice/v1', type: t, meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: {} })).verdict === 'pass');
  }, ISO));

  // ── Section 2 failures ──
  check('wrong format fails', await verdict(ok('doc', { format: 'nope' })) === 'fail');
  check('missing top-level type fails', await page.evaluate((ISO) => LV.validate(JSON.stringify({ format: 'localoffice/v1', meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: {} })).verdict, ISO) === 'fail');
  check('empty type fails', await verdict(ok('doc', { type: '' })) === 'fail');
  check('body not an object fails', await verdict(ok('doc', { body: [] })) === 'fail');
  check('meta not an object fails', await verdict(ok('doc', { meta: 'nope' })) === 'fail');

  // ── Section 3 failures ──
  check('missing meta.id fails', await page.evaluate((ISO) => LV.validate(JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { title: 'x', created: ISO, modified: ISO }, body: {} })).verdict, ISO) === 'fail');
  check('non-ISO created fails', await verdict(ok('doc', { meta: Object.assign({}, goodMeta, { created: 'yesterday' }) })) === 'fail');
  check('privacy: identifying meta field (author) fails', await verdict(ok('doc', { meta: Object.assign({}, goodMeta, { author: 'Zohaib' }) })) === 'fail');
  check('privacy rule names the offending field', await page.evaluate((ISO) => {
    const r = LV.validate(JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { id: 'i', title: 'x', created: ISO, modified: ISO, email: 'a@b' }, body: {} }));
    return r.rules.some(x => x.section === '3' && x.status === 'fail' && /email/.test(x.detail));
  }, ISO));

  // ── warnings (still conforms) ──
  check('unknown type is a warning, not a failure', await verdict(ok('weirdtype', { body: {} })) === 'warn');
  check('meta.type present is a warning', await verdict(ok('doc', { meta: Object.assign({}, goodMeta, { type: 'doc' }) })) === 'warn');
  check('tags not an array is a warning', await verdict(ok('doc', { meta: Object.assign({}, goodMeta, { tags: 'nope' }) })) === 'warn');

  // ── Section 5: nested embeds ──
  check('a valid nested embed is validated and conforms', await verdict({
    format: 'localoffice/v1', type: 'doc', meta: goodMeta,
    body: { blocks: [{ id: 'b', embed: { envelope: { format: 'localoffice/v1', type: 'sheet', meta: goodMeta, body: { sheets: [] } } } }] }
  }) === 'pass');
  check('an INVALID nested embed fails the whole document', await verdict({
    format: 'localoffice/v1', type: 'doc', meta: goodMeta,
    body: { blocks: [{ id: 'b', embed: { envelope: { format: 'localoffice/v1', type: '', meta: {}, body: {} } } }] }
  }) === 'fail');
  check('embeds are counted', await page.evaluate((ISO) => {
    const env = { format: 'localoffice/v1', type: 'slides', meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: { embeds: [{ envelope: { format: 'localoffice/v1', type: 'mindmap', meta: { id: 'j', title: 'y', created: ISO, modified: ISO }, body: { nodes: [], edges: [] } } }] } };
    return LV.validate(JSON.stringify(env)).rules.some(r => r.section === '5' && /embedded object/.test(r.label));
  }, ISO));

  // ── JSON errors ──
  check('invalid JSON fails cleanly', await page.evaluate(() => LV.validate('{ not json ').verdict) === 'fail');
  check('a JSON array (not object) fails', await page.evaluate(() => LV.validate('[1,2,3]').verdict) === 'fail');

  // ── determinism / round-trip are marked non-checkable (informational) ──
  check('Section 7 + 9 are surfaced as informational', await page.evaluate((ISO) => {
    const r = LV.validate(JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: {} }));
    return r.rules.some(x => x.section === '7' && x.status === 'info') && r.rules.some(x => x.section === '9' && x.status === 'info');
  }, ISO));

  // ── UI ──
  check('Validate button renders a pass verdict for a good file', await page.evaluate(async (ISO) => {
    document.getElementById('input').value = JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: {} });
    document.getElementById('btn-validate').click();
    return document.querySelector('#results .verdict.pass') !== null;
  }, ISO));
  check('Load example produces a conforming document', await page.evaluate(() => {
    document.getElementById('btn-example').click();
    return document.querySelector('#results .verdict.pass') !== null;
  }));

  // ── load a file (picker) + drop a File ──
  await page.setInputFiles('#file-input', { name: 'x.localoffice.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { id: 'i', title: 'x', created: ISO, modified: ISO }, body: {} })) });
  await page.waitForTimeout(90);
  check('Load file populates the input and validates it', await page.evaluate(() => document.getElementById('input').value.indexOf('localoffice/v1') >= 0 && document.querySelector('#results .verdict.pass') !== null));
  check('the hint shows the loaded file name', await page.evaluate(() => document.getElementById('hint').textContent.indexOf('x.localoffice.json') >= 0));
  check('dropping / loading a File validates it (drag-and-drop path)', await page.evaluate(async (ISO) => {
    const f = new File([JSON.stringify({ format: 'localoffice/v1', type: 'sheet', meta: { id: 'i', title: 't', created: ISO, modified: ISO }, body: { sheets: [] } })], 'y.localoffice.json', { type: 'application/json' });
    LV_loadFile(f); await new Promise(r => setTimeout(r, 70));
    return document.querySelector('#results .verdict.pass') !== null && document.getElementById('input').value.indexOf('"sheet"') >= 0;
  }, ISO));

  // ── Hub embed handoff: load in a real iframe via the shared harness ──
  // The Hub hands localValidate a workspace file to check; the shared embed
  // harness reproduces that handoff faithfully (real iframe + real postMessage).
  const HARNESS = 'file:///' + path.resolve(__dirname, '..', 'embed-harness.html').replace(/\\/g, '/');
  const embedEnv = { format: 'localoffice/v1', type: 'doc', meta: { id: 'i', title: 'EMBEDPROBE', created: ISO, modified: ISO }, body: {} };
  const hp = await browser.newPage();
  await hp.goto(HARNESS + '#' + encodeURIComponent(JSON.stringify({ file: 'localValidate/index.html', env: embedEnv })));
  let rtitle = '';
  for (let i = 0; i < 40; i++) { rtitle = await hp.title(); if (rtitle.startsWith('RESULT:')) break; await hp.waitForTimeout(80); }
  let embedOk = false; try { embedOk = JSON.parse(rtitle.slice(7)).ok === true; } catch (e) {}
  check('embedded in the Hub: posts ready + acks opened', embedOk === true);
  const fh = await hp.$('#f'); const fr = fh ? await fh.contentFrame() : null;
  check('embedded: the handed-in file populated the input', !!fr && await fr.evaluate(() => document.getElementById('input').value.indexOf('EMBEDPROBE') >= 0));
  check('embedded: rendered a conformance verdict for the handed-in file', !!fr && await fr.evaluate(() => document.querySelector('#results .verdict.pass') !== null));
  await hp.close();

  // ── privacy of the tool itself ──
  check('localValidate makes ZERO network requests (fully offline)', net.length === 0);

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
