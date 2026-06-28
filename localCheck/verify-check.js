// Headless verification of localCheck (body type `runbook`, localoffice/v1).
// Run: node verify-check.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');
const FILE_URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(fsMockInit);
  page.on('dialog', d => d.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(120);

  check('localCheck boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('verify kernel inlined WITH tolerance promoted', await page.evaluate(() => LocalVerify.isSupported('tolerance') && LocalVerify.COMPARATORS.join(',') === 'exact,coverage,tolerance'));

  // ── envelope round-trip ──
  const rt = await page.evaluate(() => {
    title = 'Bring-up'; data = { steps: [{ id: '1', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 1.1, max: 1.2 }, value: '1.15' }], _x: 7 };
    const env = exportData(); const back = LocalOffice.parse(LocalOffice.serialize(env)).envelope;
    return { type: env.type, title: env.meta.title, steps: back.body.steps.length, kept: back.body._x === 7, valid: LocalOffice.validate(env).ok };
  });
  check('export writes type runbook + title', rt.type === 'runbook' && rt.title === 'Bring-up');
  check('round-trip preserves steps + unknown fields', rt.steps === 1 && rt.kept === true && rt.valid === true);

  // ── deterministic gate: tolerance / exact / coverage ──
  const ev = await page.evaluate(() => {
    const tol = s => evalMeasure({ kind: 'measure', comparator: 'tolerance', params: { min: 1.1, max: 1.2 }, value: s });
    return {
      inRange: tol('1.15').pass, low: tol('1.05').pass, high: tol('1.25').pass, units: tol('1.18 V').pass,
      pending: tol('') === null,
      exact: evalMeasure({ kind: 'measure', comparator: 'exact', params: { expected: 'v1.0.0' }, value: 'v1.0.0' }).pass,
      cover: evalMeasure({ kind: 'measure', comparator: 'coverage', params: { required: ['POST', 'OK'] }, value: 'POST done, OK' }).pass,
      coverMiss: evalMeasure({ kind: 'measure', comparator: 'coverage', params: { required: ['POST', 'OK'] }, value: 'POST only' }).pass,
    };
  });
  check('tolerance passes in range, fails out of range', ev.inRange === true && ev.low === false && ev.high === false);
  check('tolerance reads a value out of a units string', ev.units === true);
  check('empty value is pending (not a pass)', ev.pending === true);
  check('exact + coverage gates also work', ev.exact === true && ev.cover === true && ev.coverMiss === false);

  // ── adversarial: a malformed Measure step must FAIL CLOSED (never auto-pass an
  // unverified step). The localDoc fail-open class applied to the sign-off gate. ──
  const adv = await page.evaluate(() => {
    const em = s => evalMeasure(s);
    return {
      exactNoExp:    em({ kind: 'measure', comparator: 'exact', params: {}, value: '   ' }).pass,                      // empty expected + whitespace
      exactEmptyExp: em({ kind: 'measure', comparator: 'exact', params: { expected: '' }, value: '  ' }).pass,
      covThresh0:    em({ kind: 'measure', comparator: 'coverage', params: { required: ['POST'], threshold: 0 }, value: 'nope' }).pass,
      covThreshNeg:  em({ kind: 'measure', comparator: 'coverage', params: { required: ['POST'], threshold: -1 }, value: 'nope' }).pass,
      covBadReq:     em({ kind: 'measure', comparator: 'coverage', params: { required: 'POST' }, value: 'POST' }).pass, // string, not array
      unknownCmp:    em({ kind: 'measure', comparator: 'frobnicate', params: {}, value: '5' }).pass,
      tolBadParams:  em({ kind: 'measure', comparator: 'tolerance', params: 42, value: '5' }).pass,
      tolNoBounds:   em({ kind: 'measure', comparator: 'tolerance', params: {}, value: '5' }).pass,
    };
  });
  check('malformed comparator/params never auto-pass (fail closed)',
    adv.exactNoExp === false && adv.exactEmptyExp === false && adv.covThresh0 === false && adv.covThreshNeg === false &&
    adv.covBadReq === false && adv.unknownCmp === false && adv.tolBadParams === false && adv.tolNoBounds === false);
  // the headline must hold end-to-end: an exact step with no expected cannot reach sign-off
  check('exact-with-no-expected cannot reach sign-off (UI-reachable fail-open closed)', await page.evaluate(async () => {
    data = { steps: [{ id: 'x', kind: 'measure', text: 'tag', comparator: 'exact', params: {}, value: '   ' }] };
    signed = false; const can = canSignOff(); await signOff(); return can === false && signed === false;
  }));

  // ── the headline: cannot sign off when a value is out of bounds ──
  const gate = await page.evaluate(async () => {
    data = { steps: [
      { id: 'a', kind: 'measure', text: 'NPU voltage', comparator: 'tolerance', params: { min: 1.1, max: 1.2 }, value: '1.25' },
      { id: 'b', kind: 'check', text: 'inspected', done: true },
    ] };
    const blocked = canSignOff();
    await signOff(); const blockedSign = signed;     // signOff must refuse
    data.steps[0].value = '1.15';                    // bring it into spec
    const ready = canSignOff();
    await signOff(); const okSign = signed;
    return { blocked, blockedSign, ready, okSign };
  });
  check('out-of-bounds value blocks sign-off', gate.blocked === false && gate.blockedSign === false);
  check('in-bounds value allows sign-off', gate.ready === true && gate.okSign === true);

  // ── a pending check step also blocks ──
  const chk = await page.evaluate(() => {
    data = { steps: [{ id: 'c', kind: 'check', text: 'x', done: false }] };
    const before = canSignOff(); data.steps[0].done = true; return { before, after: canSignOff() };
  });
  check('an unchecked Check step blocks sign-off; checking unblocks', chk.before === false && chk.after === true);

  // ── notes never block; empty runbook never signs off ──
  check('notes do not gate; empty runbook cannot sign off', await page.evaluate(() => {
    data = { steps: [{ id: 'n', kind: 'note', text: 't', note: 'hi' }] }; const noteOnly = canSignOff();
    data = { steps: [] }; return noteOnly === false && canSignOff() === false;
  }));

  // ── integrity seal: sign → tamper-evident on reload ──
  check('crypto.subtle available for sealing (file:// secure context)', await page.evaluate(() => canSeal()));
  const seal = await page.evaluate(async () => {
    data = { steps: [
      { id: 's1', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 1.1, max: 1.2 }, value: '1.15' },
      { id: 's2', kind: 'check', text: 'ok', done: true },
    ] }; title = 'Sealed run'; fileHandle = null;
    await signOff();
    const hasSeal = !!(data.seal && data.seal.hash && data.seal.algo === 'sha-256' && data.seal.signed);
    const file = LocalOffice.serialize(exportData());                 // the on-disk artifact
    await applyOpened(LocalOffice.parse(file).envelope);              // reopen unchanged
    const intact = sealState === 'intact' && signed === true;
    const obj = JSON.parse(file); obj.body.steps[0].value = '9.99';   // tamper a reading in a text editor
    await applyOpened(LocalOffice.parse(JSON.stringify(obj)).envelope);
    const tampered = sealState === 'tampered' && signed === false;
    return { hasSeal, intact, tampered };
  });
  check('Sign & seal records a SHA-256 seal', seal.hasSeal === true);
  check('reopening an unchanged sealed file verifies intact', seal.intact === true);
  check('tampering with a sealed value is detected on reload', seal.tampered === true);
  check('editing a signed runbook voids the seal', await page.evaluate(async () => {
    data = { steps: [{ id: 'e', kind: 'check', text: 'x', done: true }] }; title = 'T'; fileHandle = null;
    await signOff(); const sealed = !!data.seal;
    markDirty();
    return sealed === true && !data.seal && sealState === null && signed === false;
  }));

  // ── conditional branching: if_fail_goto reveals a diagnostic block ──
  const br = await page.evaluate(() => {
    data = { steps: [
      { id: 'm', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 1, max: 2 }, value: '5', ifFailGoto: 'd1' },
      { id: 'd1', kind: 'note', text: 'diag', note: '', diagnostic: true },
      { id: 'd2', kind: 'check', text: 'fix', done: false, diagnostic: true },
      { id: 't', kind: 'check', text: 'tail', done: true },
    ] };
    const revFail = [...revealedSet()].sort();
    const gateFail = gatingSteps().map(s => s.id).sort();
    data.steps[0].value = '1.5';                       // bring the trigger into spec
    const revPass = [...revealedSet()];
    const gatePass = gatingSteps().map(s => s.id).sort();
    return { revFail, gateFail, revPass, gatePass };
  });
  check('a failing measure reveals its diagnostic block', br.revFail.join() === 'd1,d2' && br.revPass.length === 0);
  check('hidden diagnostics are inert; revealed ones gate', br.gateFail.join() === 'd2,m,t' && br.gatePass.join() === 'm,t');

  const brSign = await page.evaluate(async () => {
    data = { steps: [
      { id: 'm', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 1, max: 2 }, value: '1.5', ifFailGoto: 'd1' },
      { id: 'd1', kind: 'check', text: 'diag fix', done: false, diagnostic: true },
    ] }; title = 'Branch'; fileHandle = null; signed = false;
    const okWhenHidden = canSignOff();                 // trigger passes, d1 hidden → ready
    data.steps[0].value = '9';                          // trigger fails → d1 revealed + blocks
    const blockedWhenRevealed = canSignOff();
    return { okWhenHidden, blockedWhenRevealed };
  });
  check('passing trigger hides its diagnostic and allows sign-off; failing blocks', brSign.okWhenHidden === true && brSign.blockedWhenRevealed === false);

  check('bringup template wires a fail→diagnostic branch', await page.evaluate(() => {
    loadTemplate('equip');
    const trigger = data.steps.find(s => s.ifFailGoto);
    const resolved = !!(trigger && data.steps.some(s => s.id === trigger.ifFailGoto && s.diagnostic));
    return data.steps.some(s => s.diagnostic) && !!trigger && resolved;
  }));

  // ── Web Serial: parse logic (device connect/read is a manual path) ──
  const ser = await page.evaluate(() => ({
    plain: extractReading('VOLT 3.314 V\r\n'),
    neg: extractReading('temp -40.2 C'),
    pat: extractReading('READ=12.5mV', 'READ=(-?\\d+(?:\\.\\d+)?)'),
    none: extractReading('no digits here'),
  }));
  check('extractReading pulls the first number from a serial line', ser.plain === '3.314' && ser.neg === '-40.2');
  check('extractReading honors a capture-group pattern', ser.pat === '12.5');
  check('extractReading returns empty when there is no number', ser.none === '');
  check('a measure step exposes a Read USB control', await page.evaluate(() => {
    data = { steps: [{ id: 'u', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 0, max: 5 }, value: '' }] }; render();
    return !!document.querySelector('.step[data-id="u"] .usb-read');
  }));
  check('readSerialInto degrades gracefully without device support', await page.evaluate(async () => {
    let err = null; try { await readSerialInto({ kind: 'measure', comparator: 'tolerance', params: {}, value: '' }); } catch (e) { err = e; }
    return err === null;        // never throws even when navigator.serial is absent
  }));
  check('serial settings persist on the step and round-trip', await page.evaluate(() => {
    data = { steps: [{ id: 'u2', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 0, max: 5 }, value: '', serial: { baud: 115200, pattern: 'V=(\\d+)' } }] }; title = 'S'; fileHandle = null;
    const s = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope.body.steps[0].serial;
    return !!s && s.baud === 115200 && s.pattern === 'V=(\\d+)';
  }));

  // ── add/remove + templates ──
  check('addStep / removeStep mutate the runbook', await page.evaluate(() => {
    data = { steps: [] }; addStep('measure'); addStep('check'); const n = data.steps.length; removeStep(data.steps[0].id); return n === 2 && data.steps.length === 1;
  }));
  check('a template loads gating steps', await page.evaluate(() => { loadTemplate('equip'); return title === 'Equipment readiness' && data.steps.some(s => s.kind === 'measure'); }));

  // ── File System Access round-trip (mocked picker) ──
  const frt = await page.evaluate(async () => {
    data = { steps: [{ id: 'z', kind: 'measure', text: 'V', comparator: 'tolerance', params: { min: 0, max: 5 }, value: '3' }] }; title = 'FS Runbook';
    await saveCheckAs();
    const name = [...window.__virtualFS.keys()][0]; const saved = JSON.parse(window.__virtualFS.get(name));
    newCheck(); window.__fsPick = name; await openCheck();
    return { type: saved.type, openedTitle: title, openedSteps: data.steps.length };
  });
  check('Save As writes a localoffice/v1 runbook through the handle', frt.type === 'runbook');
  check('Open reads the saved runbook back through the handle', frt.openedTitle === 'FS Runbook' && frt.openedSteps === 1);

  // ── embed: Hub handoff ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'runbook', meta: { title: 'Embedded run' }, body: { steps: [{ id: 'e1', kind: 'check', text: 'x', done: false }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function on(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', on); resolve({ ok: m.ok, title, steps: data.steps.length, hSet: fileHandle === fakeHandle }); } }
      window.addEventListener('message', on);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a runbook and acks ok', embed.ok === true && embed.title === 'Embedded run' && embed.steps === 1);
  check('embed: runbook keeps the file handle', embed.hSet === true);

  // ── theme ──
  check('dark/light toggle flips the body class', await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; }));

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
