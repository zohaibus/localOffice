// Headless verification of localDoc (body type `doc`, localoffice/v1).
// Run: node verify-doc.js
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

  check('localDoc boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('core + coverage kernel inlined', await page.evaluate(() => typeof LocalOffice === 'object' && typeof LocalVerify.coverage === 'function'));
  check('boots on a ready-to-type blank prose page (WYSIWYG)', await page.evaluate(() => isProse() && isWys() && data.blocks.length === 1 && document.querySelector('#blocks .ce[contenteditable]') !== null));

  // ── envelope round-trip ──
  const rt = await page.evaluate(() => {
    title = 'RCA'; data = { blocks: [{ id: '1', heading: 'Mitigation', text: 'x', required: ['patch'] }], _x: 5 };
    const env = exportData(); const back = LocalOffice.parse(LocalOffice.serialize(env)).envelope;
    return { type: env.type, title: env.meta.title, blocks: back.body.blocks.length, kept: back.body._x === 5, valid: LocalOffice.validate(env).ok };
  });
  check('export writes type doc + title', rt.type === 'doc' && rt.title === 'RCA');
  check('round-trip preserves blocks + unknown fields', rt.blocks === 1 && rt.kept === true && rt.valid === true);

  // ── compliance linter (coverage) ──
  const lint = await page.evaluate(() => {
    data = { blocks: [{ id: 'm', heading: 'Mitigation', text: 'we restarted the box', required: ['patch', 'deployed'] }] };
    const before = canExport();
    const rep1 = lintReport();
    data.blocks[0].text = 'we applied the patch and deployed the fix';
    const after = canExport();
    return { before, missed: rep1.rows[0].missed, after };
  });
  check('a section missing its required keywords is non-compliant', lint.before === false && lint.missed.indexOf('patch') !== -1 && lint.missed.indexOf('deployed') !== -1);
  check('adding the keywords makes it compliant', lint.after === true);

  // ── adversarial: the gate must not be beatable by word-salad substrings ──
  const adv = await page.evaluate(() => {
    // "dispatched" contains "patch", "redeployed" contains "deployed" - these
    // are NOT the required words and must NOT satisfy the gate.
    data = { blocks: [{ id: 'm', heading: 'Mitigation', text: 'we dispatched a tech who redeployed the rack', required: ['patch', 'deployed'] }] };
    const salad = { open: canExport(), missed: lintReport().rows[0].missed };
    // natural inflections of the keyword SHOULD still count.
    data = { blocks: [{ id: 'm', heading: 'Mitigation', text: 'we patched it and the fix deploys nightly', required: ['patch', 'deploy'] }] };
    const inflect = canExport();
    // a keyword used as a real whole word counts.
    data = { blocks: [{ id: 'm', heading: 'Mitigation', text: 'a patch was deployed', required: ['patch', 'deployed'] }] };
    const real = canExport();
    return { salad, inflect, real };
  });
  check('substring false-positive rejected (dispatched != patch, redeployed != deployed)', adv.salad.open === false && adv.salad.missed.indexOf('patch') !== -1 && adv.salad.missed.indexOf('deployed') !== -1);
  check('keyword inflections still count (patched satisfies patch; deploys satisfies deploy)', adv.inflect === true);
  check('a keyword used as a whole word satisfies the gate', adv.real === true);
  // direct kernel checks of the wordBoundary semantics
  const wb = await page.evaluate(() => ({
    saladSub: LocalVerify.coverage('dispatched', { required: ['patch'] }).pass,            // substring (default): false positive
    saladWord: LocalVerify.coverage('dispatched', { required: ['patch'], wordBoundary: true }).pass, // word: rejected
    suffix: LocalVerify.coverage('patched', { required: ['patch'], wordBoundary: true }).pass,        // suffix tolerated
    flashStillSubstr: LocalVerify.coverage('dispatched', { required: ['patch'] }).pass,    // flashcards path unchanged
  }));
  check('coverage substring default unchanged (flashcards keep substring matching)', wb.saladSub === true && wb.flashStillSubstr === true);
  check('coverage wordBoundary rejects the substring false-positive', wb.saladWord === false);
  check('coverage wordBoundary tolerates suffixes', wb.suffix === true);

  // ── KNOWN, DELIBERATELY-ACCEPTED edges of left-anchored/suffix-tolerant matching ──
  // Pinned so the boundary of the linguistic bet is documented, not rediscovered.
  const edge = await page.evaluate(() => {
    const C = (hay, kw) => LocalVerify.coverage(hay, { required: [kw], wordBoundary: true }).pass;
    return {
      hyphenCompound: C('we did a hot-patch tonight', 'patch'),   // ACCEPTED true: hyphen is a word boundary
      autoHyphen: C('auto-deployed to prod', 'deployed'),         // ACCEPTED true: same
      frontInflection: C('redeployed across all hosts', 'deployed'), // ACCEPTED false: prefix not matched
      negationPrefix: C('undeployed the build', 'deployed'),      // ACCEPTED false: prefix not matched
      irregularMorph: C('we built it', 'build'),                  // ACCEPTED false: suffix rule can't see built<-build
    };
  });
  check('matching edge (accepted): hyphenated compound DOES satisfy (hot-patch -> patch, auto-deployed -> deployed)', edge.hyphenCompound === true && edge.autoHyphen === true);
  check('matching edge (accepted false-neg): front-inflections do NOT satisfy (redeployed/undeployed -> deployed)', edge.frontInflection === false && edge.negationPrefix === false);
  check('matching edge (accepted false-neg): irregular morphology not matched (built does NOT satisfy build)', edge.irregularMorph === false);

  // ── the headline: export is gated by the linter ──
  const gate = await page.evaluate(() => {
    data = { blocks: [{ id: 'r', heading: 'Root cause', text: 'unknown', required: ['cause'] }] };
    const blocked = canExport();
    let mdBlocked = false; try { /* exportMarkdown would block; assert via canExport */ mdBlocked = !canExport(); } catch (e) {}
    data.blocks[0].text = 'the cause was a race condition';
    return { blocked, mdBlocked, openNow: canExport() };
  });
  check('export blocked until mandatory keywords are present', gate.blocked === false && gate.mdBlocked === true);
  check('export opens once the section is complete', gate.openNow === true);

  // ── no rules → export open ──
  check('a doc with no compliance rules exports freely', await page.evaluate(() => { data = { blocks: [{ id: 'a', heading: 'Summary', text: 'hi', required: [] }] }; return canExport() === true; }));

  // ── markdown shape ──
  const md = await page.evaluate(() => { title = 'Doc'; data = { blocks: [{ id: 'a', heading: 'Goals', text: 'ship it', required: [] }] }; return toMarkdown(); });
  check('toMarkdown emits title + ## sections', /^# Doc/.test(md) && /## Goals\n\nship it/.test(md));

  // ── round-trip fidelity (WYSIWYG <-> Markdown is the daily toggle) ──
  // The property we guarantee is a STABLE FIXED POINT: once markdown has been
  // through one md->html->md cycle, a second cycle must not change it. That is
  // what makes toggling Source <-> Visual safe - no silent drift on each flip.
  const rtrip = await page.evaluate(() => {
    const corpus = [
      '# Heading one\n\nA paragraph with **bold**, *italic*, `code` and a [link](https://x).',
      '- first\n- second with **bold**\n- third',
      '1. one\n2. two\n3. three',
      '> a quote line\n> a second line',
      '```\nconst x = 1;\nconst y = 2;\n```',
      'Plain text with a <span style="color:#ff0000">red</span> and <span style="font-size:20px">big</span> run.',
      '## Mixed\n\nintro\n\n- bullet **a**\n- bullet *b*\n\nclosing paragraph.',
    ];
    const trip = src => { const d = document.createElement('div'); d.innerHTML = mdToHtml(src); return htmlToMarkdown(d); };
    return corpus.map(src => { const once = trip(src); const twice = trip(once); return { stable: once === twice, once, twice }; });
  });
  check('round-trip reaches a stable fixed point on every corpus doc', rtrip.every(r => r.stable));
  // content survives the round-trip (no silent dropping of inline styling / links)
  const rtKeep = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = mdToHtml('A <span style="color:#ff0000">red</span> word and a [link](https://x).');
    const out = htmlToMarkdown(d);
    return { color: out.indexOf('color:#ff0000') !== -1, link: out.indexOf('(https://x)') !== -1 };
  });
  check('round-trip preserves a validated color span', rtKeep.color);
  check('round-trip preserves a link', rtKeep.link);

  // ── round-trip IDENTITY on the house style we emit (stronger than fixed point) ──
  // For markdown in localDoc's own output style, one md->html->md cycle must be a
  // true no-op (src === out), not merely stable. This is what keeps a file localDoc
  // wrote from churning the first time it's reopened and toggled.
  const rtId = await page.evaluate(() => {
    const house = [
      '# Heading', 'A para with **bold**, *italic*, `code` and a [link](https://x).',
      '- one\n- two\n- three', '1. one\n2. two\n3. three', '> a quote\n> second line',
      '```\nconst x = 1;\n```', '---', 'a <span style="color:#ff0000">red</span> word',
    ];
    const trip = src => { const d = document.createElement('div'); d.innerHTML = mdToHtml(src); return htmlToMarkdown(d); };
    return house.map(src => ({ src, identical: trip(src) === src }));
  });
  check('house-style markdown round-trips with true identity (localDoc files never churn)', rtId.every(r => r.identical));
  // KNOWN, ACCEPTED first-pass normalization of FOREIGN markdown (not churn on our
  // own files): we canonicalize emphasis to * and bullets to -. Pinned so it's a
  // documented decision, not a surprise. Foreign input is fixed-point-stable after.
  const rtNorm = await page.evaluate(() => {
    const trip = src => { const d = document.createElement('div'); d.innerHTML = mdToHtml(src); return htmlToMarkdown(d); };
    return {
      underscore: trip('some _italic_ here'),   // -> *italic*
      starBullet: trip('* a\n* b'),             // -> - a / - b
      plusBullet: trip('+ a\n+ b'),             // -> - a / - b
      stableAfter: trip(trip('* a\n* b')) === trip('* a\n* b'),
    };
  });
  check('foreign markdown is canonicalized on first pass (accepted: _->*, * /+ ->-)',
    rtNorm.underscore === 'some *italic* here' && rtNorm.starBullet === '- a\n- b' && rtNorm.plusBullet === '- a\n- b' && rtNorm.stableAfter === true);

  // ── block ops + templates ──
  check('addBlock / removeBlock / moveBlock mutate the doc', await page.evaluate(() => {
    data = { blocks: [] }; const a = addBlock('A'); const b = addBlock('B'); moveBlock(b.id, -1); const order = data.blocks.map(x => x.heading).join(','); removeBlock(a.id); return order === 'B,A' && data.blocks.length === 1;
  }));
  check('RCA template carries a gated Mitigation section', await page.evaluate(() => { loadTemplate('rca'); const m = data.blocks.find(b => b.heading === 'Mitigation'); return title === 'Incident Postmortem' && m && m.required.indexOf('deploy') !== -1 && canExport() === false; }));
  // template keyword <-> stem PROPERTY (not a denylist): for every keyword any
  // template ships, a hand-labeled table of realistic prose forms must match the
  // gate's verdict. A denylist only catches the bad suffixes we thought of; this
  // enumerates what authors actually write and proves the gate agrees - and it
  // fails the build if a template adds a keyword with no truth-table coverage.
  const tmpl = await page.evaluate(() => {
    // [keyword, prose, expectedVerdict] - the realistic forms, incl. the
    // deliberately-rejected ones (front-inflection, substring).
    const TABLE = [
      ['deploy', 'we deployed it', true], ['deploy', 'we will deploy', true],
      ['deploy', 'deploying now', true], ['deploy', 'a deployment plan', true],
      ['deploy', 'redeployed the rack', false], ['deploy', 'undeployed build', false],
      ['patch', 'we patched it', true], ['patch', 'patches applied', true],
      ['patch', 'dispatched a tech', false],
      ['mitigat', 'we mitigated it', true], ['mitigat', 'mitigation steps', true],
      ['mitigat', 'mitigating the risk', true],
      ['cause', 'the cause was X', true], ['cause', 'it caused an outage', true],
      ['cause', 'because of Z', false],
      ['risk', 'the risk is high', true], ['risk', 'two risks remain', true],
      ['action', 'action items', true], ['action', 'actions taken', true],
      ['owner', 'the owner is Sam', true], ['goal', 'our goals are', true],
      ['interface', 'the interface is', true], ['summary', 'in summary', true],
      ['motivation', 'the motivation here', true], ['design', 'the design uses', true],
      ['alternative', 'two alternatives', true],
    ];
    const C = (hay, kw) => LocalVerify.coverage(hay, { required: [kw], wordBoundary: true }).pass;
    const tableOk = TABLE.every(([kw, prose, exp]) => C(prose, kw) === exp);
    // collect every keyword shipped by every template, assert each is in the table
    const tableKw = new Set(TABLE.map(r => r[0]));
    const templateKw = new Set();
    for (const t of ['rca', 'design', 'rfc']) { loadTemplate(t); for (const b of data.blocks) for (const kw of (b.required || [])) templateKw.add(kw); }
    const everyKwCovered = [...templateKw].every(kw => tableKw.has(kw));
    // and no template keyword is a front-inflected form (belt-and-suspenders)
    const noFrontInflected = ![...templateKw].some(kw => /(ed|ing)$/.test(kw) && kw !== 'building');
    return { tableOk, everyKwCovered, noFrontInflected, templateKw: [...templateKw] };
  });
  check('template keyword inflection truth-table: gate verdict matches hand-labeled prose', tmpl.tableOk);
  check('every template keyword has truth-table coverage (build fails on an uncovered new keyword)', tmpl.everyKwCovered);
  check('no template keyword is itself front-inflected', tmpl.noFrontInflected);

  // ── AI routing validation (no LLM in the compliance gate) ──
  check('routeToBlocks keeps only existing headings with content', await page.evaluate(() => {
    data = { blocks: [{ id: '1', heading: 'Root cause', text: '', required: [] }, { id: '2', heading: 'Timeline', text: '', required: [] }] };
    const r = routeToBlocks({ 'Root cause': 'x', 'Bogus': 'y', 'Timeline': '' });
    return Object.keys(r).length === 1 && r['Root cause'] === 'x';
  }));

  // ── AI distill (mocked Ollama) → preview → fill ──
  await page.evaluate(() => {
    window.__mock = { gen: '{}', failTags: false };
    window.fetch = async (url) => { url = String(url); if (url.includes('/api/tags')) { if (window.__mock.failTags) throw new Error('refused'); return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }] }) }; } if (url.includes('/api/generate')) return { ok: true, json: async () => ({ response: window.__mock.gen }) }; return { ok: false, status: 404 }; };
  });
  const ai = await page.evaluate(async () => {
    data = { blocks: [{ id: '1', heading: 'Timeline', text: '', required: [] }, { id: '2', heading: 'Root cause', text: '', required: ['cause'] }] };
    window.__mock.gen = JSON.stringify({ 'Timeline': '09:00 alert fired', 'Root cause': 'the cause was X', 'Ignored': 'nope' });
    document.getElementById('ai-input').value = 'raw notes';
    await aiDistill();
    const previewShown = !document.getElementById('ai-preview').classList.contains('hidden');
    aiApply();
    return { previewShown, timeline: data.blocks[0].text, root: data.blocks[1].text };
  });
  check('AI distill previews then fills only valid sections', ai.previewShown === true && /alert fired/.test(ai.timeline) && /cause was X/.test(ai.root));
  check('detect fails gracefully when Ollama is down', await page.evaluate(async () => { window.__mock.failTags = true; await AI.detect(); window.__mock.failTags = false; return document.getElementById('ai-status').classList.contains('err'); }));

  // ── AI GENERATE a whole document (mocked Ollama) → preview → apply → kernel gates ──
  const gen = await page.evaluate(async () => {
    window.__mock.gen = JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { title: 'Gen RCA' }, body: { docMode: 'compliance', blocks: [
      { id: 'a', heading: 'Root cause', text: 'the cause was a stale cache', required: ['cause'] },
      { id: 'b', heading: 'Mitigation', text: 'we restarted the box', required: ['patch', 'deploy'] } ] } });
    data = blankDoc(); render();
    document.getElementById('ai-gen-input').value = 'an incident RCA in compliance mode';
    await aiGenerate();
    const pv = document.getElementById('ai-gen-preview');
    const previewShown = !pv.classList.contains('hidden') && /Root cause/.test(pv.textContent) && /gated: patch, deploy/.test(pv.textContent);
    aiGenApply();
    const applied = title === 'Gen RCA' && data.blocks.length === 2 && data.blocks[1].heading === 'Mitigation' && data.blocks[1].required.join(',') === 'patch,deploy' && data.docMode === 'compliance';
    const kernelGates = canExport() === false && lintReport().rows.some(r => r.heading === 'Mitigation' && !r.pass);   // Mitigation text lacks patch/deploy → blocked
    return { previewShown, applied, kernelGates };
  });
  check('AI generate: previews sections + gating', gen.previewShown === true);
  check('AI generate: Apply replaces the whole document', gen.applied === true);
  check('AI generate: the kernel still gates the AI-drafted doc (not the model)', gen.kernelGates === true);
  // robustness: a small model that returns a BARE body (no envelope) still applies
  check('AI generate: accepts a bare body from a small model', await page.evaluate(async () => {
    window.__mock.gen = JSON.stringify({ docMode: 'prose', blocks: [{ id: 'x', heading: 'Goals', text: 'ship it', required: [] }] });
    data = blankDoc(); render();
    document.getElementById('ai-gen-input').value = 'a design doc'; await aiGenerate(); aiGenApply();
    return data.blocks.length === 1 && data.blocks[0].heading === 'Goals' && !canExport() === false;   // prose, no gates → export open
  }));

  // ── JSON panel Apply replaces the WHOLE document (blocks + mode + title), not just a field ──
  check('JSON panel Apply loads a full new document (blocks/mode/title all replaced)', await page.evaluate(async () => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: 'old', heading: 'Old', text: 'x', required: [] }] }; title = 'Old'; render();
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea');
    ta.value = JSON.stringify({ format: 'localoffice/v1', type: 'doc', meta: { title: 'New' }, body: { docMode: 'compliance', blocks: [{ id: 'n1', heading: 'A', text: 'aa', required: [] }, { id: 'n2', heading: 'B', text: 'bb', required: ['x'] }] } });
    jp.querySelector('[data-a="apply"]').click(); await new Promise(r => setTimeout(r, 60));
    return title === 'New' && data.blocks.length === 2 && data.blocks[1].heading === 'B' && data.docMode === 'compliance';
  }));

  // ── File System Access round-trip (mocked picker) ──
  const frt = await page.evaluate(async () => {
    data = { blocks: [{ id: 'z', heading: 'Summary', text: 'ok', required: [] }] }; title = 'FS Doc';
    await saveDocAs(); const name = [...window.__virtualFS.keys()][0]; const saved = JSON.parse(window.__virtualFS.get(name));
    newDoc(); window.__fsPick = name; await openDoc();
    return { type: saved.type, openedTitle: title, blocks: data.blocks.length };
  });
  check('Save As writes a localoffice/v1 doc through the handle', frt.type === 'doc');
  check('Open reads the saved doc back through the handle', frt.openedTitle === 'FS Doc' && frt.blocks === 1);

  // ── embed: Hub handoff ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'doc', meta: { title: 'Embedded doc' }, body: { blocks: [{ id: 'e1', heading: 'S', text: '', required: [] }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => { function on(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', on); resolve({ ok: m.ok, title, blocks: data.blocks.length, hSet: fileHandle === fakeHandle }); } } window.addEventListener('message', on); window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } })); });
  });
  check('embed: Hub handoff loads a doc and acks ok', embed.ok === true && embed.title === 'Embedded doc' && embed.blocks === 1);
  check('embed: doc keeps the file handle', embed.hSet === true);

  // ── prose / word-processor mode ──
  const prose = await page.evaluate(() => {
    data = { blocks: [{ id: 'r', heading: 'X', text: '', required: ['cause'] }] };
    setMode('compliance'); const compBlocked = document.getElementById('export-btn').disabled;
    setMode('prose');
    return { isProse: isProse(), bodyClass: document.body.classList.contains('prose'),
             exportOpen: !document.getElementById('export-btn').disabled, compBlocked };
  });
  check('compliance mode still gates export on unmet keywords', prose.compBlocked === true);
  check('prose mode turns off the gate (export open) + sets body.prose', prose.isProse && prose.bodyClass && prose.exportOpen === true);

  check('prose mode shows a word/character count', await page.evaluate(() => {
    data = { docMode: 'prose', blocks: [{ id: '1', heading: '', text: 'one two three', required: [] }] }; renderLint();
    const wc = wordCount(); return wc.words === 3 && /3<\/b> words/.test(document.getElementById('summary').innerHTML);
  }));

  check('docMode round-trips through the envelope', await page.evaluate(() => {
    data = { docMode: 'prose', blocks: [{ id: '1', heading: '', text: 'hi', required: [] }] }; title = 'P';
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope; return back.body.docMode === 'prose';
  }));

  check('prose templates load in prose mode; compliance templates do not', await page.evaluate(() => {
    loadTemplate('letter'); const a = isProse() && title === 'Letter';
    loadTemplate('notes'); const b = isProse() && data.blocks.length === 3;
    loadTemplate('rca'); const c = !isProse();
    return a && b && c;
  }));

  // ── New = a ready-to-type blank page (not an intimidating empty screen) ──
  check('New opens a blank prose page with a WYSIWYG editor', await page.evaluate(() => {
    data = { docMode: 'compliance', blocks: [{ id: 'x', heading: 'H', text: 'content', required: [] }] };
    newDoc();
    return isProse() && isWys() && data.blocks.length === 1 && (data.blocks[0].text || '') === '' && document.querySelector('#blocks .ce[contenteditable]') !== null;
  }));

  // ── minimal typography (font / size / color) ──
  const typo = await page.evaluate(() => {
    data = blankDoc(); render();
    setDocStyle({ font: 'serif', size: 'lg', color: '#2f7d3a' });
    const host = document.getElementById('blocks');
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope;
    return { font: host.style.getPropertyValue('--doc-font'), size: host.style.getPropertyValue('--doc-size'),
             color: host.style.getPropertyValue('--doc-color'), styleBack: back.body.style,
             swatches: document.querySelectorAll('#fmt-colors .swatch').length };
  });
  check('typography applies font/size/color as CSS variables', /Georgia/.test(typo.font) && typo.size === '17px' && typo.color === '#2f7d3a');
  check('typography (body.style) round-trips through the envelope', typo.styleBack && typo.styleBack.font === 'serif' && typo.styleBack.size === 'lg' && typo.styleBack.color === '#2f7d3a');
  check('text-color palette renders swatches', typo.swatches === 7);

  // ── selection formatting (highlight → format) ──
  check('wrapInline wraps the selection in Markdown (bold)', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'hello world', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 5); wrapInline('**', '**');
    return data.blocks[0].text === '**hello** world';
  }));
  check('linePrefix turns the current line into a heading', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'Title line\nbody', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 3); linePrefix('## ');
    return data.blocks[0].text === '## Title line\nbody';
  }));
  check('select + color wraps the selection in a sanitized span', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'red text', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 3); chooseColor('#a4332f');
    return data.blocks[0].text === '<span style="color:#a4332f">red</span> text';
  }));
  check('select + font wraps the selection in a font span (renders too)', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'abc', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 3); chooseFont('serif');
    return /^<span style="font-family:Georgia/.test(data.blocks[0].text) && /<span style="font-family:Georgia/.test(mdToHtml(data.blocks[0].text));
  }));
  check('re-styling a selection merges into ONE span (no nesting)', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'word', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 4);
    chooseColor('#2f7d3a'); chooseColor('#7a4fd0'); chooseSize('lg');   // re-apply on the same selection
    const t = data.blocks[0].text;
    const opens = (t.match(/<span/g) || []).length, closes = (t.match(/<\/span>/g) || []).length;
    return opens === 1 && closes === 1 && t.includes('color:#7a4fd0') && !t.includes('#2f7d3a') && t.includes('font-size:17px');
  }));
  check('font/size with no selection set the document default (no span)', await page.evaluate(() => {
    data = blankDoc(); render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 0); chooseSize('xl');
    return data.style.size === 'xl' && data.blocks[0].text === '';
  }));
  check('renderer renders our safe spans and strips unsafe styles', await page.evaluate(() => {
    const ok = mdInline('<span style="color:#a4332f;font-size:18px">x</span>');
    const bad = mdInline('<span style="position:fixed;color:red">x</span>');   // color:red (not hex) + position → dropped
    return /<span style="color:#a4332f;font-size:18px">x<\/span>/.test(ok) && bad.indexOf('<span') === -1 && bad.indexOf('&lt;span') !== -1;
  }));

  // ── Markdown renderer (dependency-free, safe) ──
  const r = await page.evaluate(() => mdToHtml('# Title\n\nsome **bold** and *it* and `code`\n\n- a\n- b\n\n> quote\n\n[ok](https://e.com) [bad](javascript:alert(1))'));
  check('markdown renders headings/bold/italic/code/lists/quotes', /<h1>Title<\/h1>/.test(r) && /<strong>bold<\/strong>/.test(r) && /<em>it<\/em>/.test(r) && /<code>code<\/code>/.test(r) && /<ul><li>a<\/li><li>b<\/li><\/ul>/.test(r) && /<blockquote>quote<\/blockquote>/.test(r));
  check('markdown keeps safe links and neutralizes javascript: links', /href="https:\/\/e\.com"/.test(r) && /href="#"/.test(r) && !/javascript:/.test(r));
  check('markdown escapes HTML (no injection)', await page.evaluate(() => { const h = mdToHtml('<script>x</script> & <b>y</b>'); return h.indexOf('<script>') === -1 && h.indexOf('&lt;script&gt;') !== -1; }));

  // ── WYSIWYG editor renders live; Source toggle drops to a Markdown textarea ──
  check('WYSIWYG renders Markdown live; Source toggle shows raw textarea and back', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: 'Sec', text: '**bold** and *it*', required: [] }] }; viewMode = 'wysiwyg'; render();
    const ce = document.querySelector('#blocks .ce');
    const liveRendered = !!ce && /<strong>bold<\/strong>/.test(ce.innerHTML) && /<em>it<\/em>/.test(ce.innerHTML);
    toggleView(); const ta = document.querySelector('#blocks .block textarea');
    const inSource = viewMode === 'source' && !!ta && ta.value.includes('**bold**');
    toggleView(); const backToWys = isWys() && document.querySelector('#blocks .ce') !== null;
    return liveRendered && inSource && backToWys;
  }));

  // ── HTML -> Markdown round-trip (WYSIWYG edits serialize back to clean Markdown) ──
  check('htmlToMarkdown serializes bold/italic/heading/list/link/color span', await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<h2>Title</h2><div>a <b>bold</b> <i>it</i> <a href="https://e.com">lnk</a></div><ul><li>one</li><li>two</li></ul><div><font color="#a4332f">red</font></div>';
    const md = htmlToMarkdown(d);
    return /## Title/.test(md) && /\*\*bold\*\*/.test(md) && /\*it\*/.test(md) && /\[lnk\]\(https:\/\/e\.com\)/.test(md) && /- one\n- two/.test(md) && /<span style="color:#a4332f">red<\/span>/.test(md);
  }));
  check('WYSIWYG editing updates the block Markdown (input -> htmlToMarkdown)', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'plain', required: [] }] }; viewMode = 'wysiwyg'; render();
    const ce = document.querySelector('#blocks .ce'); ce.focus();
    ce.innerHTML = '<div>now <b>bold</b></div>'; ce.dispatchEvent(new Event('input', { bubbles: true }));
    return data.blocks[0].text === 'now **bold**';
  }));

  // ── shared JSON inspector: view current envelope, apply edits, reject bad JSON ──
  check('JSON panel opens with the current envelope, applies edits, and guards bad JSON', await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); if (!btn) return false;
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'hi', required: [] }] }; title = 'Doc A'; viewMode = 'source'; render();
    btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea');
    const shown = jp.classList.contains('on') && ta.value.includes('"type": "doc"') && ta.value.includes('"title": "Doc A"');
    const o = JSON.parse(ta.value); o.meta.title = 'Doc B'; ta.value = JSON.stringify(o, null, 2);
    jp.querySelector('[data-a="apply"]').click(); await new Promise(r => setTimeout(r, 60));
    const applied = title === 'Doc B';
    ta.value = '{ not valid'; jp.querySelector('[data-a="apply"]').click();
    const guarded = title === 'Doc B' && /Not applied/.test(jp.querySelector('[data-i]').textContent);
    return shown && applied && guarded;
  }));

  // ── JSON panel: the "build with any LLM" prompt toggle ──
  check('JSON panel has a Prompt toggle that shows the tool schema, then returns to JSON', await page.evaluate(async () => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'hi', required: [] }] }; title = 'P'; render();
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea'), pb = jp.querySelector('[data-a="prompt"]');
    if (!pb || pb.hidden) return false;
    pb.click();                                   // show the build prompt
    const promptShown = ta.value.includes('localoffice/v1') && ta.value.includes('<describe the document you want') && /Markdown/.test(ta.value);
    pb.click();                                   // back to the live JSON
    const backToJson = ta.value.includes('"format"') && !ta.value.includes('<describe');
    return promptShown && backToJson;
  }));

  // ── undo / redo (reliable, both modes) ──
  check('undo/redo: add section -> undo removes -> redo restores', await page.evaluate(() => {
    data = blankDoc(); resetHistory(); render();
    const n0 = data.blocks.length;
    addBlock('Sec'); const added = data.blocks.length;
    undo(); const undone = data.blocks.length;
    redo(); const redone = data.blocks.length;
    return added === n0 + 1 && undone === n0 && redone === n0 + 1;
  }));
  check('undo reverts a formatting change', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'word', required: [] }] }; viewMode = 'source'; resetHistory(); render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, 4); wrapInline('**', '**');
    const bold = data.blocks[0].text === '**word**';
    undo(); const reverted = data.blocks[0].text === 'word';
    redo(); const reBold = data.blocks[0].text === '**word**';
    return bold && reverted && reBold;
  }));
  check('typing is undoable as a coalesced burst', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: 'a', required: [] }] }; resetHistory(); render();
    maybeTypeSnap(); data.blocks[0].text = 'a typed more';   // simulate one typing burst
    undo(); const back = data.blocks[0].text === 'a';
    redo(); const fwd = data.blocks[0].text === 'a typed more';
    return back && fwd;
  }));
  check('Ctrl+Z / Ctrl+Y work via the keyboard', await page.evaluate(() => {
    data = blankDoc(); resetHistory(); render();
    const n0 = data.blocks.length; addBlock('K');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const u = data.blocks.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    return u === n0 && data.blocks.length === n0 + 1;
  }));

  // ── styling a multi-line list: per-line spans, every item renders styled ──
  check('coloring a whole list wraps each item (Source mode)', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: '', text: '- a\n- b\n- c', required: [] }] }; viewMode = 'source'; render();
    const ta = document.querySelector('#blocks .block textarea'); ta.focus(); ta.setSelectionRange(0, ta.value.length);
    chooseColor('#2563eb');
    const md = data.blocks[0].text;
    const perLine = md.split('\n').every(l => /^- <span style="color:#2563eb">.+<\/span>$/.test(l));
    const html = mdToHtml(md);
    return perLine && (html.match(/<li>/g) || []).length === 3 && (html.match(/<span style="color:#2563eb">/g) || []).length === 3 && html.includes('<ul>');
  }));
  check('renderer redistributes a whole-list span across every item', await page.evaluate(() => {
    const html = mdToHtml('<span style="color:#2563eb">- a\n- b\n- c</span>');
    return (html.match(/<li>/g) || []).length === 3 && (html.match(/<span style="color:#2563eb">/g) || []).length === 3 && html.includes('<ul>');
  }));

  // ════ release-gate hardening: the claims a user would call a lie if broken ════

  // Tier 0 - docMode absent must NOT fail open (spec: absent = compliance).
  check('docMode absent defaults to compliance (gate does not fail open)', await page.evaluate(() => {
    data = { blocks: [{ id: 'r', heading: 'Root cause', text: 'unknown', required: ['cause'] }] }; // no docMode
    const gatedClosed = isProse() === false && canExport() === false;
    let dl = null; const real = LocalOffice.download; LocalOffice.download = () => { dl = 1; }; exportMarkdown(); LocalOffice.download = real;
    return gatedClosed && dl === null;
  }));

  // Tier 0 - exportMarkdown() itself (not just the disabled button) enforces the gate.
  check('exportMarkdown() refuses the download when gated, emits bytes when satisfied', await page.evaluate(() => {
    let dl = null; const real = LocalOffice.download; LocalOffice.download = (t, n) => { dl = { n, len: t.length }; };
    data = { docMode: 'compliance', blocks: [{ id: 'r', heading: 'Root cause', text: 'unknown', required: ['cause'] }] };
    exportMarkdown(); const blocked = dl === null;
    data.blocks[0].text = 'the cause was clear'; exportMarkdown(); const emitted = dl !== null && dl.len > 0;
    LocalOffice.download = real; return blocked && emitted;
  }));

  // Tier 0 - verdict determinism: same doc -> byte-identical verdict; pass is order-independent.
  check('verdict is deterministic (identical re-run) and independent of block order', await page.evaluate(() => {
    data = { docMode: 'compliance', blocks: [{ id: 'b', heading: 'M', text: 'we deployed the patch', required: ['patch', 'deploy'] }, { id: 'a', heading: 'R', text: 'the cause was clear', required: ['cause'] }] };
    const a = JSON.stringify(lintReport()), b2 = JSON.stringify(lintReport());
    const passA = lintReport().pass; data.blocks.reverse(); const passB = lintReport().pass;
    return a === b2 && passA === passB;
  }));

  // Tier 0 - matching policy, pinned: keyword counts in code fences and inline
  // headings (it's the section's prose); the block's separate heading field is NOT.
  check('matching policy: counts in code fences + inline headings; block heading field is not scanned', await page.evaluate(() => {
    const C = (t, kw) => LocalVerify.coverage(t, { required: [kw], wordBoundary: true }).pass;
    const fence = C('```\ngit apply patch.diff\n```', 'patch');
    const inlineH = C('## Patch notes', 'patch');
    data = { blocks: [{ id: 'h', heading: 'Patch deployed', text: 'nothing relevant', required: ['patch'] }] };
    return fence === true && inlineH === true && canExport() === false; // heading field not scanned -> still gated
  }));

  // Tier 0 - shared-kernel consumer isolation made explicit.
  check('kernel isolation: doc (wordBoundary) and flashcards (substring) coexist on one kernel', await page.evaluate(() => {
    const docVerdict = LocalVerify.coverage('dispatched', { required: ['patch'], wordBoundary: true }).pass; // false
    const flashVerdict = LocalVerify.coverage('dispatched', { required: ['patch'] }).pass;                   // true (default)
    return docVerdict === false && flashVerdict === true;
  }));

  // Tier 1 - full envelope round-trip: required arrays + block ids + docMode + style survive.
  check('envelope round-trip preserves required arrays, block ids, docMode, style', await page.evaluate(() => {
    data = { docMode: 'compliance', style: { font: 'serif' }, blocks: [{ id: 'keepme', heading: 'M', text: 'x', required: ['patch', 'deploy'] }] }; title = 'T';
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope.body; const blk = back.blocks[0];
    return blk.id === 'keepme' && Array.isArray(blk.required) && blk.required.join(',') === 'patch,deploy' && back.docMode === 'compliance' && back.style.font === 'serif';
  }));

  // Tier 1 - mode-toggle fuzz: repeated Visual<->Source must not mutate a house-style doc.
  check('mode-toggle fuzz (Visual<->Source x5) leaves a house-style doc unchanged', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: '1', heading: 'Sec', text: 'A **bold** and *it* with a [link](https://x) and\n\n- one\n- two', required: [] }] };
    viewMode = 'wysiwyg'; render(); const before = JSON.stringify(data.blocks);
    for (let i = 0; i < 5; i++) { toggleView(); toggleView(); }
    return before === JSON.stringify(data.blocks);
  }));

  // Tier 2 - the AI cannot launder text past the gate (README promises this).
  check('AI-filled prose is still subject to the kernel gate (no bypass)', await page.evaluate(async () => {
    data = { docMode: 'compliance', blocks: [{ id: '1', heading: 'Root cause', text: '', required: ['cause'] }, { id: '2', heading: 'Timeline', text: '', required: [] }] };
    window.__mock.gen = JSON.stringify({ 'Root cause': 'the disk was full', 'Timeline': '09:00 alert fired' }); // no "cause" word
    document.getElementById('ai-input').value = 'notes'; await aiDistill(); aiApply();
    const blockedAfterAI = !canExport();                    // AI wrote prose but the keyword is absent -> still gated
    data.blocks[0].text = 'the root cause was a full disk';
    return blockedAfterAI && canExport() === true;
  }));

  // Tier 2 - style sanitizer rejects out-of-range size / named color / unknown font.
  check('style sanitizer rejects out-of-range size, named color, unknown font; keeps valid', await page.evaluate(() => {
    const drop = safeSpanStyle('font-size:999px') === '' && safeSpanStyle('font-size:-5px') === '' && safeSpanStyle('color:red') === '' && safeSpanStyle('font-family:Comic Sans') === '';
    const keep = safeSpanStyle('color:#a4332f') === 'color:#a4332f' && safeSpanStyle('font-size:18px') === 'font-size:18px';
    return drop && keep;
  }));

  // Tier 2 - opening a doc with a malicious span/handler renders neutralized. The
  // payload survives only as INERT escaped text - so we assert at the DOM level (no
  // live element/handler), not on substrings (escaped text legitimately still
  // contains the literal word "onerror").
  check('opening a doc with a malicious span/img handler renders neutralized (no injection)', await page.evaluate(() => {
    importData({ meta: { title: 'evil' }, body: { docMode: 'prose', blocks: [{ id: '1', heading: '', text: 'x <span style="position:fixed" onclick="alert(1)">bad</span> <img src=x onerror=alert(1)>', required: [] }] } });
    viewMode = 'wysiwyg'; render(); const ce = document.querySelector('#blocks .ce');
    const noImg = ce.querySelectorAll('img').length === 0;
    const noHandlers = [...ce.querySelectorAll('*')].every(el => !el.getAttribute('onclick') && !el.getAttribute('onerror'));
    const noUnsafeSpan = [...ce.querySelectorAll('span')].every(el => (el.getAttribute('style') || '').indexOf('position') === -1);
    return noImg && noHandlers && noUnsafeSpan;
  }));

  // Tier 2 - a malformed envelope loads safely (no crash). Property, not shape: a
  // string `required` still GATES (we test behavior, not whether the field became
  // an array); a missing body yields a safe blocks array.
  check('importData loads a malformed body safely (string required still gates; missing blocks safe)', await page.evaluate(() => {
    importData({ meta: { title: 'X' }, body: { docMode: 'compliance', blocks: [{ heading: 'A', text: 'nothing relevant here', required: 'patch' }] } });
    const stringGates = canExport() === false && !!data.blocks[0].id;   // 'patch' rule active, text lacks it -> blocked
    importData({ meta: { title: 'Y' }, body: {} });
    return stringGates && Array.isArray(data.blocks);
  }));

  // Tier 0 - THE CLASS, not the instance: every malformed/odd `required` shape must
  // fail CLOSED. The one we shipped (string) was charitable; the guarantee is that
  // no unrecoverable shape silently turns the gate off. Parameterized so the whole
  // family is proven, never crashes, and a positive control confirms it's not
  // vacuously rejecting everything.
  const cls = await page.evaluate(() => {
    const gate = (req, text) => { data = { docMode: 'compliance', blocks: [{ id: 'b', heading: 'M', text, required: req }] }; return canExport(); };
    const unrelated = 'totally unrelated prose';
    const mustBlock = [5, true, {}, 'patch', ['patch'], ['patch', null], ['patch', ''], [null], ['', ''], [5, {}]];
    const allBlocked = mustBlock.every(r => gate(r, unrelated) === false);                  // none auto-pass
    const stringGatesThenPasses = gate('patch', unrelated) === false && gate('patch', 'we patched it') === true; // string recoverable
    const arrayWithJunkStillGates = gate(['patch', null], 'we patched it') === true;        // valid keyword survives
    const genuineEmptyPasses = gate([], unrelated) === true;                                // [] = no rule, legit
    const wellFormedPasses = gate(['cause'], 'the cause was clear') === true;               // positive control
    return { allBlocked, stringGatesThenPasses, arrayWithJunkStillGates, genuineEmptyPasses, wellFormedPasses };
  });
  check('malformed `required` class fails CLOSED: no shape (number/bool/object/all-junk array) auto-passes', cls.allBlocked);
  check('recoverable shapes still work (string gates then passes; junk-mixed array gates on the valid keyword)', cls.stringGatesThenPasses && cls.arrayWithJunkStillGates);
  check('genuine empty rule passes; well-formed rule passes (not vacuously rejecting)', cls.genuineEmptyPasses && cls.wellFormedPasses);

  // Tier 3 - privacy: zero network calls during normal editing/export.
  check('offline: no network calls during normal editing/export (privacy claim)', await page.evaluate(() => {
    let calls = 0; const real = window.fetch; window.fetch = (...a) => { calls++; return real(...a); };
    data = blankDoc(); render(); viewMode = 'source'; render(); toggleView();
    data = { docMode: 'compliance', blocks: [{ id: 'r', heading: 'X', text: 'the cause', required: ['cause'] }] }; canExport(); exportData(); toMarkdown();
    window.fetch = real; return calls === 0;
  }));

  check('dark/light toggle flips the body class', await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; }));

  // ── embedded objects: a doc hosting another tool's object, drawn by the shared LocalRender ──
  check('localDoc uses the shared LocalRender module', await page.evaluate(() => typeof LocalRender === 'object' && typeof LocalRender.render === 'function'));
  const emb = await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [{ id: 't', heading: 'Intro', text: 'hi', required: [] }] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Arch' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null, x: 0, y: 0 }, { id: 'a', text: 'Added', parent: 'r', x: 120, y: 60 }], edges: [] } });
    const el = document.querySelector('.block[data-id="' + b.id + '"]');
    const rend = el.querySelector('.embed-render');
    // static render on the page (no inline live iframe), edited via a modal instead
    const staticSvg = !!rend && rend.innerHTML.indexOf('<svg') >= 0 && rend.innerHTML.indexOf('Root') >= 0;
    const noInlineFrame = !el.querySelector('iframe');
    // open the live editor and stream an edit back
    openEmbedEditor(b);
    const modalOpen = !!(document.getElementById('embed-editor') && document.getElementById('embed-editor').classList.contains('on'));
    const fr = document.querySelector('#embed-editor .ee-frame');
    const edited = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Arch2' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null, x: 0, y: 0 }, { id: 'a', text: 'A', parent: 'r', x: 120, y: 60 }, { id: 'c', text: 'C', parent: 'r', x: -120, y: 60 }], edges: [] } };
    window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'embedState', text: JSON.stringify(edited) }, source: fr.contentWindow }));
    const cached = byId(b.id).embed.envelope;
    closeEmbedEditor();
    const env = exportData(); const back = LocalOffice.parse(LocalOffice.serialize(env)).envelope;
    const eb = back.body.blocks.find(x => x.embed);
    return { staticSvg, noInlineFrame, modalOpen, cachedNodes: cached.body.nodes.length, cachedTitle: cached.meta.title,
             rtType: eb && eb.embed.envelope.type, rtNodes: eb && eb.embed.envelope.body.nodes.length, rtTitle: eb && eb.embed.envelope.meta.title, rtValid: LocalOffice.validate(env).ok };
  });
  check('+ Embed draws the object inline via LocalRender (SVG), no inline iframe', emb.staticSvg && emb.noInlineFrame);
  check('double-click / Edit opens a live editor modal', emb.modalOpen);
  check('an edit in the modal (embedState) updates the cached nested envelope', emb.cachedNodes === 3 && emb.cachedTitle === 'Arch2');
  check('save/load round-trips the embedded object AND its edits (state carryover)', emb.rtType === 'mindmap' && emb.rtNodes === 3 && emb.rtTitle === 'Arch2' && emb.rtValid === true);

  // real nested-iframe handoff: the modal editor actually loads the real tool with the object
  await page.evaluate(() => { data = { docMode: 'prose', style: {}, blocks: [] }; const b = addEmbedBlock({ format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Live' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null, x: 0, y: 0 }, { id: 'x', text: 'Leaf', parent: 'r', x: 90, y: 50 }], edges: [] } }); openEmbedEditor(b); });
  let liveNodes = -1, liveOk = false;
  for (let i = 0; i < 24; i++) {
    const fr = page.frames().find(f => /localMindMap/i.test(f.url()));
    if (fr) { try { liveNodes = await fr.evaluate(() => (typeof data === 'object' && data && Array.isArray(data.nodes)) ? data.nodes.length : -1); } catch (e) {} if (liveNodes >= 0) { liveOk = true; break; } }
    await page.waitForTimeout(150);
  }
  check('the live editor modal loads the real tool + hands it the object (2 nodes)', liveOk && liveNodes === 2);
  await page.evaluate(() => closeEmbedEditor());

  // a sheet embeds as a real TABLE inline (author tables in sheets, show in the doc)
  check('a sheet embed renders as a real table inline + round-trips', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'Data' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'Item' }, B1: { v: 'Qty' }, A2: { v: 'Bolt' }, B2: { v: 4 } } }] } });
    const rend = document.querySelector('.block[data-id="' + b.id + '"] .embed-render');
    const table = !!rend && rend.innerHTML.indexOf('<table') >= 0 && rend.innerHTML.indexOf('Item') >= 0 && rend.innerHTML.indexOf('Bolt') >= 0;
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope; const eb = back.body.blocks.find(x => x.embed);
    return table && !!(eb && eb.embed.envelope.type === 'sheet' && eb.embed.envelope.body.sheets[0].cells.B2.v === 4);
  }));

  // graceful degradation: a type with no editor still renders (LocalRender card) + preserves data
  const deg = await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'weirdtype', meta: { title: 'Mystery' }, body: { foo: 1 } });
    const el = document.querySelector('.block[data-id="' + b.id + '"]');
    const hasPh = !!el.querySelector('.embed-ph'), noFrame = !el.querySelector('iframe'), rendered = !!el.querySelector('.embed-render');
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope;
    const eb = back.body.blocks.find(x => x.embed);
    return { hasPh, noFrame, rendered, kept: !!(eb && eb.embed.envelope.type === 'weirdtype' && eb.embed.envelope.body.foo === 1) };
  });
  check('an embed whose tool is unavailable still renders (card) + shows a note, no iframe', deg.hasPh && deg.noFrame && deg.rendered);
  check('unavailable embed still round-trips its data (forward-compat)', deg.kept === true);

  // ✦ Prompt is embed-aware, and an LLM-authored doc with an embed block applies + renders
  check('localDoc ✦ Prompt teaches embedding (sheet table + mind-map FSM)', await page.evaluate(() =>
    LOCALDOC_PROMPT.indexOf('"embed"') >= 0 && LOCALDOC_PROMPT.toLowerCase().indexOf('sheet') >= 0 && LOCALDOC_PROMPT.toLowerCase().indexOf('finite-state') >= 0));
  check('an LLM-authored doc with an embed block applies + renders', await page.evaluate(() => {
    applyOpened({ format: 'localoffice/v1', type: 'doc', meta: { title: 'Gen' }, body: { docMode: 'prose', blocks: [
      { id: 'a', heading: 'Overview', text: 'text', required: [] },
      { id: 'b', embed: { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'Nums' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'K' }, B1: { v: 'V' }, A2: { v: 'x' }, B2: { v: 9 } } }] } } } }
    ] } });
    const eb = data.blocks.find(x => x.embed);
    const rend = document.querySelector('.block[data-id="' + eb.id + '"] .embed-render');
    return !!(eb && eb.embed.envelope.type === 'sheet') && !!rend && rend.innerHTML.indexOf('<table') >= 0;
  }));

  // markdown export references embedded objects by title (does not dump raw JSON)
  const embMd = await page.evaluate(() => { data = { docMode: 'prose', style: {}, blocks: [{ id: 'a', heading: 'Intro', text: 'hello', required: [] }] }; addEmbedBlock({ format: 'localoffice/v1', type: 'runbook', meta: { title: 'Bring-up' }, body: { steps: [] } }); return toMarkdown(); });
  check('markdown export references the embedded object by title', embMd.includes('## Bring-up') && embMd.toLowerCase().includes('embedded runbook'));

  // embedded objects are visibly rendered inline (non-zero geometry)
  check('localDoc: an embedded sheet is a visibly-sized table inline', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'H' }, A2: { v: 'v' } } }] } });
    const t = document.querySelector('.block[data-id="' + b.id + '"] .embed-render table'); if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 5 && r.height > 5;
  }));
  check('localDoc: an embedded mind map is a visibly-sized SVG inline', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'mindmap', meta: { title: 'M' }, body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'a', x: 120, y: 60 }], edges: [] } });
    const g = document.querySelector('.block[data-id="' + b.id + '"] .embed-render svg'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 20 && r.height > 20;
  }));
  check('localDoc: A+/A− scales an embedded object\'s font size', await page.evaluate(() => {
    data = { docMode: 'prose', style: {}, blocks: [] };
    const b = addEmbedBlock({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ cells: { A1: { v: 'x' } } }] } });
    b.embed.scale = 1.5; render();
    const rend = document.querySelector('.block[data-id="' + b.id + '"] .embed-render');
    return !!rend && Math.abs(parseFloat(getComputedStyle(rend).fontSize) - 39) < 1.5;   // 26px * 1.5
  }));
  // live host×child: the doc editor modal boots the REAL Sheet tool with the object
  await page.evaluate(() => { data = { docMode: 'prose', style: {}, blocks: [] }; const b = addEmbedBlock({ format: 'localoffice/v1', type: 'sheet', meta: { title: 'S' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'x' } } }] } }); openEmbedEditor(b); });
  let docSheetOk = false;
  for (let i = 0; i < 26; i++) { const fr = page.frames().find(f => /localSheets/i.test(f.url())); if (fr) { try { docSheetOk = await fr.evaluate(() => typeof Store === 'object' && !!(Store.data && Store.data.sheets)); } catch (e) {} if (docSheetOk) break; } await page.waitForTimeout(150); }
  await page.evaluate(() => closeEmbedEditor());
  check('localDoc modal boots the real Sheet tool with the object', docSheetOk);

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
