// Headless verification of LocalOffice.html (the Hub).
// FS folder-pick and the live iframe handoff need a real browser gesture, so
// here we test the Hub's pure indexing/filter/sort logic + dashboard render
// against mock file records. Run: node verify-hub.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const FILE_URL = 'file:///' + path.resolve(__dirname, 'LocalOffice.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

function env(type, title, tags, modified) {
  return JSON.stringify({ format: 'localoffice/v1', type, meta: { id: 'x', title, tags: tags || [], modified: modified || '' }, body: {} });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(120);

  check('Hub boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('shared core is inlined (parseMeta present)', await page.evaluate(() => typeof LocalOffice === 'object' && typeof LocalOffice.parseMeta === 'function'));
  check('Hub logic is exposed', await page.evaluate(() => typeof Hub === 'object' && typeof Hub.indexFiles === 'function'));

  // ── indexFiles: parses meta, flags unreadable files ──
  const idx = await page.evaluate((recs) => Hub.indexFiles(recs), [
    { name: 'a.localoffice.json', path: 'a.localoffice.json', text: env('plan', 'Q3 plan', ['work'], '2026-06-10T00:00:00Z') },
    { name: 'b.localoffice.json', path: 'deep/b.localoffice.json', text: env('mindmap', 'Arch map', ['work', 'hw'], '2026-06-12T00:00:00Z') },
    { name: 'c.localoffice.json', path: 'c.localoffice.json', text: '{ not json' },
    { name: 'd.localoffice.json', path: 'd.localoffice.json', text: env('slides', '', [], '2026-06-01T00:00:00Z') },
  ]);
  check('indexFiles reads type + title from meta', idx[0].type === 'plan' && idx[0].title === 'Q3 plan' && idx[0].ok === true);
  check('indexFiles keeps the relative path', idx[1].path === 'deep/b.localoffice.json');
  check('indexFiles flags unreadable files (still listed)', idx[2].ok === false && !!idx[2].error);
  check('indexFiles falls back to filename when title is empty', idx[3].title === 'd.localoffice.json');

  // ── collectTypes / collectTags ──
  check('collectTypes lists the distinct types', JSON.stringify(await page.evaluate((r) => Hub.collectTypes(Hub.indexFiles(r)), [
    { name: 'a', text: env('plan', 'P') }, { name: 'b', text: env('sheet', 'S') }, { name: 'c', text: env('plan', 'P2') }]))
    === JSON.stringify(['plan', 'sheet']));
  check('collectTags lists unique sorted tags', JSON.stringify(await page.evaluate((r) => Hub.collectTags(Hub.indexFiles(r)), [
    { name: 'a', text: env('plan', 'P', ['z', 'a']) }, { name: 'b', text: env('sheet', 'S', ['a', 'm']) }]))
    === JSON.stringify(['a', 'm', 'z']));

  // ── filterSort ──
  const fs = await page.evaluate((recs) => {
    const list = Hub.indexFiles(recs);
    return {
      all: Hub.filterSort(list, {}).map(e => e.title),
      byType: Hub.filterSort(list, { type: 'mindmap' }).map(e => e.title),
      byTag: Hub.filterSort(list, { tag: 'hw' }).map(e => e.title),
      byQuery: Hub.filterSort(list, { query: 'arch' }).map(e => e.title),
      recent: Hub.filterSort(list, { sort: 'recent' }).map(e => e.title),
      title: Hub.filterSort(list, { sort: 'title' }).map(e => e.title),
    };
  }, [
    { name: 'a', text: env('plan', 'Q3 plan', ['work'], '2026-06-10T00:00:00Z') },
    { name: 'b', text: env('mindmap', 'Arch map', ['work', 'hw'], '2026-06-12T00:00:00Z') },
    { name: 'c', text: env('slides', 'Demo deck', [], '2026-06-01T00:00:00Z') },
  ]);
  check('filterSort by type narrows to one', fs.byType.length === 1 && fs.byType[0] === 'Arch map');
  check('filterSort by tag narrows correctly', fs.byTag.length === 1 && fs.byTag[0] === 'Arch map');
  check('filterSort by query matches title', fs.byQuery.length === 1 && fs.byQuery[0] === 'Arch map');
  check('filterSort recent = newest modified first', fs.recent[0] === 'Arch map' && fs.recent[2] === 'Demo deck');
  check('filterSort title = alphabetical', fs.title[0] === 'Arch map' && fs.title[1] === 'Demo deck' && fs.title[2] === 'Q3 plan');

  // ── tool registry ──
  check('toolFor maps every body type to a single-file tool', await page.evaluate(() =>
    Hub.toolFor('plan').file === 'localPlan/index.html' && Hub.toolFor('slides').file === 'localDeck/localDeck.html' &&
    Hub.toolFor('sheet').file === 'localSheets/localsheets.html' && Hub.toolFor('flashcards').file === 'localCards/localCards.html' &&
    Hub.toolFor('mindmap').file === 'localMindMap/index.html' && Hub.toolFor('bogus') === null));

  // ── dashboard render (via the test hook) ──
  const dash = await page.evaluate((recs) => {
    Hub._loadForTest(recs);
    return {
      cards: document.querySelectorAll('#grid .card').length,
      empty: document.getElementById('empty').hidden,
      badges: [...document.querySelectorAll('#grid .badge')].map(b => b.textContent),
      typeOptions: document.getElementById('f-type').options.length,
      count: document.getElementById('count').textContent,
    };
  }, [
    { name: 'a', text: env('plan', 'Q3 plan', ['work'], '2026-06-10T00:00:00Z') },
    { name: 'b', text: env('mindmap', 'Arch map', ['hw'], '2026-06-12T00:00:00Z') },
  ]);
  check('dashboard renders a card per file', dash.cards === 2);
  check('dashboard hides the empty state once files load', dash.empty === true);
  check('dashboard shows a type badge on each card', dash.badges.includes('plan') && dash.badges.includes('mindmap'));
  check('dashboard populates the type filter (All + 2 types)', dash.typeOptions === 3);
  check('dashboard shows a file count', /2 of 2/.test(dash.count));

  // ── viewer scaffolding present (the iframe handoff target) ──
  check('viewer overlay + iframe exist', await page.evaluate(() => !!document.getElementById('vframe') && !!document.getElementById('viewer')));

  // ── localValidate: the Hub's spec-conformance utility (no body type of its own) ──
  check('VALIDATE_TOOL points at localValidate', await page.evaluate(() =>
    Hub.VALIDATE_TOOL && Hub.VALIDATE_TOOL.file === 'localValidate/index.html' && Hub.VALIDATE_TOOL.name === 'localValidate'));
  check('every file card offers a Validate action', await page.evaluate(() => {
    Hub._loadForTest([{ name: 'a', text: JSON.stringify({ format: 'localoffice/v1', type: 'plan', meta: { id: 'x', title: 'P' }, body: {} }) }]);
    return document.querySelectorAll('#grid .card .val').length === 1;
  }));
  check('openValidate(entry) opens localValidate with the file to check (handoff armed)', await page.evaluate(() => {
    Hub.openValidate({ type: 'plan', title: 'P', text: 'TXT', name: 'p.localoffice.json' });
    return document.getElementById('viewer').classList.contains('on') &&
      /localValidate\/index\.html$/.test(document.getElementById('vframe').getAttribute('src')) &&
      Hub.hasOpenable() === true;
  }));
  check('openValidate(null) launches localValidate blank (no file handoff)', await page.evaluate(() => {
    Hub.openValidate(null);
    return Hub.hasOpenable() === false && /localValidate\/index\.html$/.test(document.getElementById('vframe').getAttribute('src'));
  }));
  check('the header Validate button launches the utility', await page.evaluate(() => {
    document.getElementById('viewer').classList.remove('on');
    document.getElementById('btn-validate').click();
    return document.getElementById('viewer').classList.contains('on') && /localValidate\//.test(document.getElementById('vframe').getAttribute('src'));
  }));
  await page.evaluate(() => { Hub._setPendingForTest(null); document.getElementById('vframe').src = 'about:blank'; document.getElementById('viewer').classList.remove('on'); });

  // ── Open workspace folder: fall back to Files… when the directory picker is blocked (e.g. file://) ──
  check('Open workspace folder falls back to Files… on a blocked picker, but not on cancel', await page.evaluate(async () => {
    const fi = document.getElementById('file-input'); const orig = fi.click; let clicks = 0; fi.click = () => { clicks++; };
    window.showDirectoryPicker = async () => { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; };
    await pickWorkspace(); const afterBlocked = clicks;                 // blocked -> fallback (1)
    window.showDirectoryPicker = async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; };
    await pickWorkspace(); const afterCancel = clicks;                  // cancel -> no fallback (still 1)
    fi.click = orig;
    return afterBlocked === 1 && afterCancel === 1;
  }));

  // ── theme toggle ──
  check('theme toggle flips the body class', await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; }));

  // ── open message must NOT bundle the handle (cross-origin deserialization) ──
  const om = await page.evaluate(() => Hub.buildOpenMessages({ text: 'TXT', name: 'n.localoffice.json', handle: { fake: 1 } }));
  check('open message carries text and NO handle (deliverable cross-origin)', om[0].type === 'open' && om[0].text === 'TXT' && !('handle' in om[0]));
  check('handle is sent as a separate best-effort message', om.length === 2 && om[1].type === 'open-handle' && !!om[1].handle);
  check('no handle → only the open message is sent', (await page.evaluate(() => Hub.buildOpenMessages({ text: 'x' }).length)) === 1);

  // ── Hub-mediated save: the top frame writes for the (picker-blocked) iframe ──
  const inplace = await page.evaluate(async () => {
    let written = null;
    const handle = { name: 'wb.localoffice.json', createWritable: async () => ({ write: async (d) => { written = d; }, close: async () => {} }) };
    Hub._setPendingForTest({ name: 'wb.localoffice.json', handle, text: 'OLD' });
    let reply = null;
    await Hub.handleSave({ proto: 'localoffice', type: 'save', id: '1', text: 'NEWCONTENT' }, { postMessage: (m) => { reply = m; } });
    return { written, ok: reply && reply.ok, name: reply && reply.name };
  });
  check('Hub save writes in-place through the held handle', inplace.written === 'NEWCONTENT' && inplace.ok === true && inplace.name === 'wb.localoffice.json');

  const saveAs = await page.evaluate(async () => {
    let picked = false, written = null;
    window.showSaveFilePicker = async (opts) => { picked = true; return { name: opts.suggestedName, createWritable: async () => ({ write: async (d) => { written = d; }, close: async () => {} }) }; };
    const handle = { name: 'orig.localoffice.json', createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    Hub._setPendingForTest({ name: 'orig.localoffice.json', handle, text: 'OLD' });
    let reply = null;
    await Hub.handleSave({ id: 'as', text: 'ASNEW', name: 'as.localoffice.json', asNew: true }, { postMessage: (m) => { reply = m; } });
    return { picked, written, ok: reply && reply.ok, name: reply && reply.name, adopted: Hub._index === undefined };
  });
  check('Hub Save As shows the picker even when a handle is held', saveAs.picked === true && saveAs.written === 'ASNEW' && saveAs.ok === true && saveAs.name === 'as.localoffice.json');

  const viaPicker = await page.evaluate(async () => {
    let written = null;
    window.showSaveFilePicker = async (opts) => ({ name: opts.suggestedName, createWritable: async () => ({ write: async (d) => { written = d; }, close: async () => {} }) });
    Hub._setPendingForTest({ name: 'x', handle: null, text: 'OLD' });
    let reply = null;
    await Hub.handleSave({ id: '2', text: 'PICKED', name: 'new.localoffice.json' }, { postMessage: (m) => { reply = m; } });
    return { written, ok: reply && reply.ok };
  });
  check('Hub save shows the picker when it has no handle, then writes', viaPicker.written === 'PICKED' && viaPicker.ok === true);

  const cancelled = await page.evaluate(async () => {
    window.showSaveFilePicker = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
    Hub._setPendingForTest({ name: 'x', handle: null });
    let reply = null;
    await Hub.handleSave({ id: '3', text: 'T', name: 'n' }, { postMessage: (m) => { reply = m; } });
    return reply;
  });
  check('Hub save reports cancellation cleanly (no crash)', cancelled.ok === false && cancelled.error === 'cancelled');

  // ── "Start something new" chooser ──
  check('NEW_ITEMS offers a new doc for every body type', await page.evaluate(() => {
    const types = Hub.NEW_ITEMS.map(i => i.type).sort();
    return JSON.stringify(types) === JSON.stringify([...LocalOffice.TYPES].sort()) &&
           Hub.NEW_ITEMS.every(i => Hub.toolFor(i.type)); // each maps to a real tool
  }));
  check('landing screen renders a New button per type', await page.evaluate(() =>
    document.querySelectorAll('#newgrid .newbtn').length === Hub.NEW_ITEMS.length));
  check('header New popover is filled and toggles', await page.evaluate(() => {
    const filled = document.querySelectorAll('#new-menu .newbtn').length === Hub.NEW_ITEMS.length;
    const before = document.getElementById('new-menu').hidden;
    document.getElementById('btn-new').click();
    const open = !document.getElementById('new-menu').hidden;
    document.body.click(); // outside click closes
    const closed = document.getElementById('new-menu').hidden;
    return filled && before === true && open && closed;
  }));

  // ── new doc: opens the tool blank (sends NO "open") + adopts handle on first save ──
  const fresh = await page.evaluate(() => {
    Hub.newDoc('sheet');
    const p = Hub._pending();
    return { isNew: p && p.isNew === true, noHandle: p && p.handle === null,
             noOpen: Hub.hasOpenable() === false, viewerOn: document.getElementById('viewer').classList.contains('on') };
  });
  check('newDoc starts a blank session (isNew, no handle)', fresh.isNew && fresh.noHandle);
  check('newDoc sends no "open" - the tool keeps its fresh default', fresh.noOpen === true);
  check('newDoc opens the viewer', fresh.viewerOn === true);

  const newSave = await page.evaluate(async () => {
    let picked = false, written = null;
    window.showSaveFilePicker = async (opts) => { picked = true; return { name: opts.suggestedName, createWritable: async () => ({ write: async (d) => { written = d; }, close: async () => {} }) }; };
    Hub.newDoc('runbook');
    let reply = null;
    await Hub.handleSave({ id: 'n1', text: 'FIRST', name: 'note.localoffice.json' }, { postMessage: (m) => { reply = m; } });
    const p = Hub._pending();
    return { picked, written, ok: reply && reply.ok, adopted: !!(p && p.handle), nowReal: p && p.isNew === false };
  });
  check('new doc first save shows the picker and writes', newSave.picked === true && newSave.written === 'FIRST' && newSave.ok === true);
  check('new doc adopts the handle (no re-prompt on next save)', newSave.adopted === true && newSave.nowReal === true);
  await page.evaluate(() => { Hub._setPendingForTest(null); document.getElementById('viewer').classList.remove('on'); });

  // ── leaving a tool waits for the frame to unload (so a cancelled "Leave?" guard
  //    keeps you IN the tool, not stranded on the dashboard). ──
  const leave = await page.evaluate(async () => {
    const fr = document.getElementById('vframe'), viewer = document.getElementById('viewer');
    await new Promise(res => { fr.addEventListener('load', res, { once: true }); fr.src = 'data:text/html,<p>tool</p>'; });
    viewer.classList.add('on');               // simulate a tool open
    Hub.closeViewer();
    const stillOnSync = viewer.classList.contains('on');   // must NOT hide synchronously (that was the bug)
    await new Promise(res => { const t = setInterval(() => { if (!viewer.classList.contains('on')) { clearInterval(t); res(); } }, 10); setTimeout(() => { clearInterval(t); res(); }, 1500); });
    return { stillOnSync, hiddenAfterUnload: !viewer.classList.contains('on') };
  });
  check('closeViewer keeps the tool visible until the frame unloads (Cancel stays put)', leave.stillOnSync === true);
  check('closeViewer hides the viewer once the frame has unloaded', leave.hiddenAfterUnload === true);
  await page.evaluate(() => { document.getElementById('vframe').src = 'about:blank'; document.getElementById('viewer').classList.remove('on'); });

  // ── REAL iframe + postMessage handoff per tool (not synthetic) ──
  // Uses embed-harness.html to drive the actual ready→open→opened path that the
  // Hub uses. (The handle field is file://-cross-origin-uncloneable, so the Hub
  // sends text-first; this verifies that text path end-to-end for every tool.)
  const HARNESS = 'file:///' + path.resolve(__dirname, 'embed-harness.html').replace(/\\/g, '/');
  const cases = [
    ['localDeck', { file: 'localDeck/localDeck.html', env: { format: 'localoffice/v1', type: 'slides', meta: { title: 'PROBE' }, body: { theme: {}, footer: {}, slides: [{ id: 's1', layout: 'title', blocks: [] }] } } }],
    ['localCards', { file: 'localCards/localCards.html', env: { format: 'localoffice/v1', type: 'flashcards', meta: { title: 'PROBE' }, body: { deck: { name: 'D' }, scheduler: 'fsrs-lite', cards: [{ id: 'c1', front: 'F', back: 'B' }] } } }],
    ['LocalPlan', { file: 'localPlan/index.html', env: { format: 'localoffice/v1', type: 'plan', meta: { title: 'PROBE' }, body: { planTitle: 'PROBE', tracks: [{ id: 't1', title: 'T', sections: [] }] } } }],
    ['localMindMap', { file: 'localMindMap/index.html', env: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'PROBE' }, body: { nodes: [{ id: 'a', text: 'Hi', x: 0, y: 0, parent: null }], edges: [] } } }],
    ['LocalSheets', { file: 'localSheets/localsheets.html', env: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'PROBE' }, body: { sheets: [{ name: 'S1', cells: {}, cols: 10, rows: 20 }] } } }],
    ['localMark', { file: 'localMark/index.html', env: { format: 'localoffice/v1', type: 'image', meta: { title: 'PROBE' }, body: { base: '', width: 0, height: 0, overlays: [] } } }],
    ['localCheck', { file: 'localCheck/index.html', env: { format: 'localoffice/v1', type: 'runbook', meta: { title: 'PROBE' }, body: { steps: [{ id: 'a', kind: 'check', text: 'x', done: false }] } } }],
    ['localDoc', { file: 'localDoc/index.html', env: { format: 'localoffice/v1', type: 'doc', meta: { title: 'PROBE' }, body: { blocks: [{ id: 'a', heading: 'S', text: '', required: [] }] } } }],
  ];
  for (const [name, cfg] of cases) {
    await page.goto(HARNESS + '#' + encodeURIComponent(JSON.stringify(cfg)));
    let title = '';
    for (let i = 0; i < 40; i++) { title = await page.title(); if (title.startsWith('RESULT:')) break; await page.waitForTimeout(80); }
    let ok = false; try { ok = JSON.parse(title.slice(7)).ok === true; } catch (e) {}
    check('real iframe handoff loads ' + name, ok === true);
  }

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
