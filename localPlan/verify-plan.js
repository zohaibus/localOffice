// Headless verification of LocalPlan after the localoffice/v1 envelope adoption.
// Run: node verify-plan.js
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
  await page.addInitScript(fsMockInit);               // in-memory File System Access API
  await page.setViewportSize({ width: 1400, height: 900 }); // room to prove zoom widens
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE_URL);
  await page.waitForTimeout(150);

  check('LocalPlan boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('shared core is inlined (LocalOffice present)', await page.evaluate(() => typeof LocalOffice === 'object' && !!LocalOffice.createEnvelope));

  const r = await page.evaluate(() => {
    // a representative plan (tracks → sections → items)
    data = { planTitle: 'My Plan', planSubtitle: 'What matters.', tracks: [
      { id: 't1', icon: 'C', title: 'Career', open: true, sections: [
        { name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'Top priority', priority: true }] } ] } ] };

    // export → localoffice/v1 plan envelope (same path exportData uses)
    const env = LocalOffice.createEnvelope('plan', { title: data.planTitle, app: 'localplan@1.0', body: data });
    const text = LocalOffice.serialize(env);
    const o = JSON.parse(text);

    // import the envelope back
    const back = LocalOffice.parse(text).envelope;

    // import a LEGACY { tracks } backup via the coerce seam importData uses
    const legacy = JSON.stringify({ planTitle: 'Legacy plan', tracks: [{ id: 'l1', title: 'Health', sections: [] }] });
    const env2 = LocalOffice.parse(legacy, {
      coerce: raw => (raw && Array.isArray(raw.tracks))
        ? LocalOffice.createEnvelope('plan', { title: raw.planTitle, app: 'localplan@1.0', body: raw }) : null
    }).envelope;

    return {
      format: o.format, type: o.type, title: o.meta.title, app: o.meta.app,
      tracks: back.body.tracks.length, item: back.body.tracks[0].sections[0].items[0].text,
      keepsTitle: back.body.planTitle === 'My Plan',
      legacyType: env2.type, legacyTitle: env2.meta.title, legacyTrack: env2.body.tracks[0].title,
      valid: LocalOffice.validate(env).ok
    };
  });

  check('export writes format localoffice/v1', r.format === 'localoffice/v1');
  check('export writes type plan', r.type === 'plan');
  check('export stamps meta.title from planTitle', r.title === 'My Plan');
  check('export stamps app=localplan@1.0', r.app === 'localplan@1.0');
  check('envelope validates via the shared core', r.valid === true);
  check('round-trip preserves the tracks body', r.tracks === 1 && r.item === 'Top priority');
  check('round-trip preserves planTitle in the body', r.keepsTitle === true);
  check('legacy { tracks } backup is coerced to a plan envelope', r.legacyType === 'plan' && r.legacyTrack === 'Health');
  check('legacy coerce carries the title into meta', r.legacyTitle === 'Legacy plan');

  // a non-plan envelope is rejected by import
  const rej = await page.evaluate(() => {
    try { const e = LocalOffice.parse(JSON.stringify({ format: 'localoffice/v1', type: 'slides', meta: {}, body: {} })).envelope; return e.type === 'slides'; } catch { return false; }
  });
  check('a non-plan envelope is recognizable (so import can reject it)', rej === true);

  // ── File System Access IO is inlined (Open / Save / Save As) ──
  const io = await page.evaluate(() => ({ save: typeof LocalOffice.saveFile, open: typeof LocalOffice.openFile, fs: typeof LocalOffice.supportsFS, dl: typeof LocalOffice.download }));
  check('core File IO inlined (saveFile/openFile/supportsFS/download)', io.save === 'function' && io.open === 'function' && io.fs === 'function' && io.dl === 'function');
  const pe = await page.evaluate(() => { data = { planTitle: 'Q3', planSubtitle: 'x', tracks: [{ id: 't', title: 'T', sections: [] }] }; const e = planEnvelope(); return { type: e.type, title: e.meta.title, tracks: e.body.tracks.length, app: e.meta.app }; });
  check('planEnvelope builds a plan envelope from the live data', pe.type === 'plan' && pe.title === 'Q3' && pe.tracks === 1 && pe.app === 'localplan@1.0');
  check('Open / Save / Save As functions exist', await page.evaluate(() => typeof openPlan === 'function' && typeof savePlan === 'function' && typeof savePlanAs === 'function'));

  // ── plan zoom (must scale width AND height, not just height) ──
  const zoom = await page.evaluate(() => {
    setPlanZoom(1); const w1 = document.querySelector('.container').getBoundingClientRect().width;
    setPlanZoom(1.5);
    const v = getComputedStyle(document.documentElement).getPropertyValue('--plan-zoom').trim();
    const lbl = document.getElementById('zoom-label').textContent;
    const w15 = document.querySelector('.container').getBoundingClientRect().width;
    setPlanZoom(1);
    return { v, lbl, widened: w15 > w1 + 5 };
  });
  check('plan zoom sets the --plan-zoom variable', zoom.v === '1.5');
  check('plan zoom updates the % label', zoom.lbl === '150%');
  check('plan zoom widens the column (uses horizontal space)', zoom.widened === true);

  // ── Print / PDF ──
  check('printPlan is defined', await page.evaluate(() => typeof printPlan === 'function'));

  // ── toolbar surface + dark mode regression ──
  const tb = await page.evaluate(() => { const t = document.querySelector('.toolbar.ui').innerText; return { open: /Open/.test(t), save: /Save/.test(t), saveAs: /Save As/.test(t), print: /Print/.test(t) }; });
  check('toolbar exposes Open / Save / Save As / Print', tb.open && tb.save && tb.saveAs && tb.print);
  const dm = await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; });
  check('dark/light toggle still works', dm === true);

  // ── Start over routes to the brain-dump screen (with skip-to-packs) ──
  page.on('dialog', d => d.accept());                 // accept the "Start over?" confirm
  await page.evaluate(() => resetToWelcome());
  await page.waitForTimeout(50);
  check('Start over opens the brain-dump screen', await page.locator('#braindump-overlay.show').count() === 1);
  check('brain-dump screen still offers the starter-pack skip', (await page.locator('.braindump-skip').innerText()).toLowerCase().includes('starter'));

  // ── brain-dump screen has its own light/dark toggle and follows the theme ──
  check('brain-dump screen has a light/dark toggle', await page.locator('#braindump-theme-btn').count() === 1);
  const bdTheme = await page.evaluate(() => {
    const ov = document.getElementById('braindump-overlay');
    const wasDark = document.body.classList.contains('dark');
    const bg1 = getComputedStyle(ov).backgroundColor;
    document.getElementById('braindump-theme-btn').click();
    const nowDark = document.body.classList.contains('dark');
    const bg2 = getComputedStyle(ov).backgroundColor;
    document.getElementById('braindump-theme-btn').click();
    return { toggled: wasDark !== nowDark, bgChanged: bg1 !== bg2 };
  });
  check('brain-dump toggle flips the theme', bdTheme.toggled === true);
  check('brain-dump screen follows the theme (background changes)', bdTheme.bgChanged === true);

  // ════════════════════════════════════════════════════════════════
  // OPTIONAL LOCAL AI (advisory only) - exercised with a mocked Ollama
  // so it runs with or without Ollama installed. Proves: nothing reaches
  // the plan without validation, and hallucinated ids are dropped.
  // ════════════════════════════════════════════════════════════════
  // (the dialog handler registered above auto-accepts decompose's confirm/alert)
  check('toolbar exposes the ✦ AI panel button', await page.evaluate(() => /✦ AI/.test(document.querySelector('.toolbar.ui').innerText)));

  // install a configurable fake fetch for localhost:11434
  await page.evaluate(() => {
    window.__mock = { generate: '', failTags: false };
    window.fetch = async (url) => {
      url = String(url);
      if (url.includes('/api/tags')) {
        if (window.__mock.failTags) throw new Error('connection refused');
        return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'qwen' }] }) };
      }
      if (url.includes('/api/generate')) return { ok: true, json: async () => ({ response: window.__mock.generate }) };
      return { ok: false, status: 404 };
    };
  });

  // detect → populate model list; show()/hide() toggle the drawer
  await page.evaluate(async () => { await AI.show(); });
  await page.waitForTimeout(30);
  check('AI.show opens the drawer and detect populates models', await page.evaluate(() =>
    !document.getElementById('ai-panel').classList.contains('hidden') && AI.models.length === 2 && document.getElementById('ai-model').options.length === 2));
  check('AI.hide closes the drawer', await page.evaluate(() => { AI.hide(); return document.getElementById('ai-panel').classList.contains('hidden'); }));

  // detect fails gracefully when Ollama is unreachable
  const graceful = await page.evaluate(async () => {
    window.__mock.failTags = true; await AI.detect(); window.__mock.failTags = false;
    return document.getElementById('ai-status').classList.contains('err');
  });
  check('detect fails gracefully (error status) when Ollama is down', graceful === true);

  // Distill: messy text → braindump lines → preview (only parser-valid lines kept)
  const distill = await page.evaluate(async () => {
    data = { planTitle: 'P', planSubtitle: '', tracks: [] };
    window.__mock.generate = 'career > Now: finish report (priority)\nhealth > Soon: book checkup\nthis line has no colon so it cannot parse';
    document.getElementById('ai-distill-input').value = 'some messy notes';
    await aiDistill();
    const ta = document.getElementById('ai-distill-ta').value;
    return { previewShown: !document.getElementById('ai-distill-preview').classList.contains('hidden'), lines: ta.split('\n').filter(Boolean).length };
  });
  check('distill previews only parser-valid lines (drops garbage)', distill.previewShown === true && distill.lines === 2);

  // Distill apply: pipe the preview through the existing importFromText()
  const applied = await page.evaluate(() => {
    aiApplyDistill();
    let items = 0; data.tracks.forEach(t => t.sections.forEach(s => items += s.items.length));
    return { tracks: data.tracks.length, items, hidden: document.getElementById('ai-distill-preview').classList.contains('hidden') };
  });
  check('distill apply imports the reviewed lines into the plan', applied.tracks === 2 && applied.items === 2 && applied.hidden === true);

  // Decompose: valid {steps} appended below the parent (confirm auto-accepted)
  const dec = await page.evaluate(async () => {
    data = { planTitle: 'P', tracks: [{ id: 't1', icon: 'T', title: 'T', open: true, sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'Big task' }] }] }] };
    window.__mock.generate = JSON.stringify({ steps: ['step one', 'step two', 'step three'] });
    const sec = data.tracks[0].sections[0];
    await aiDecompose(sec.items[0], sec);
    const items = data.tracks[0].sections[0].items;
    return { count: items.length, first: items[1].text, hasId: !!items[1].id };
  });
  check('decompose appends the validated steps below the task', dec.count === 4 && dec.first === 'step one' && dec.hasId);

  // Decompose validation: fewer than 2 usable steps → nothing appended
  const decBad = await page.evaluate(async () => {
    data = { planTitle: 'P', tracks: [{ id: 't1', title: 'T', sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'Big' }] }] }] };
    window.__mock.generate = JSON.stringify({ steps: ['only one'] });
    const sec = data.tracks[0].sections[0];
    await aiDecompose(sec.items[0], sec);
    return data.tracks[0].sections[0].items.length;
  });
  check('decompose rejects <2 steps without touching the plan', decBad === 1);

  // Prioritize: validate selected_ids against the SENT set (drop hallucinated + non-active)
  const prio = await page.evaluate(async () => {
    data = { planTitle: 'P', tracks: [{ id: 't1', title: 'Career', sections: [
      { name: 'Now', horizon: 'now', items: [{ id: 'a', text: 'Task A' }, { id: 'b', text: 'Task B' }] },
      { name: 'Later', horizon: 'later', items: [{ id: 'c', text: 'Task C' }] } ] }] };
    // model leaks an internal id into the human strategy text - it must not be shown
    window.__mock.generate = JSON.stringify({ strategy: 'Focus on Task A (a) to unblock work.', selected_ids: ['a', 'ZZZ_hallucinated', 'c'] });
    await aiPrioritize();
    const html = document.getElementById('ai-prio-result').innerHTML;
    return { ids: aiPrioIds.slice(), applyVisible: !document.getElementById('ai-prio-apply').classList.contains('hidden'), leaksId: /\(a\)|ZZZ_hallucinated/.test(html), strat: /Focus on Task A/.test(html) };
  });
  check('prioritize keeps only ids that were actually sent (a)', prio.ids.length === 1 && prio.ids[0] === 'a' && prio.applyVisible);
  check('prioritize strips internal ids from the strategy prose', prio.leaksId === false && prio.strat === true);

  // Apply priorities: star only the validated selection
  const star = await page.evaluate(() => {
    aiApplyPriorities();
    const it = id => data.tracks[0].sections.flatMap(s => s.items).find(i => i.id === id);
    return { a: !!it('a').priority, b: !!it('b').priority, c: !!it('c').priority };
  });
  check('apply stars only the validated task (a), not b/c', star.a === true && star.b === false && star.c === false);

  // the per-item ✦ break down button renders next to + add note
  check('each item row gets a ✦ break down button', await page.evaluate(() => {
    render(); return document.querySelectorAll('.ai-break').length >= 1;
  }));

  // ── File System Access round-trip (mocked picker - the real Chrome/Edge path) ──
  const frt = await page.evaluate(async () => {
    data = { planTitle: 'FS Plan', planSubtitle: '', tracks: [{ id: 't1', icon: 'T', title: 'Track', open: true, sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'ITEMX' }] }] }] };
    fileHandle = null;
    await savePlanAs();                                 // Save As → showSaveFilePicker → write/close
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    data = { planTitle: 'x', tracks: [] };              // clobber
    window.__fsPick = name;
    await openPlan();                                   // showOpenFilePicker → getFile → load
    const opened = { item: data.tracks[0].sections[0].items[0].text, title: data.planTitle };
    data.tracks[0].sections[0].items[0].text = 'EDITED'; await savePlan(); // in-place via the existing handle
    const after = JSON.parse(window.__virtualFS.get(name));
    return { fmt: saved.format, type: saved.type, savedItem: saved.body.tracks[0].sections[0].items[0].text, opened, inplace: after.body.tracks[0].sections[0].items[0].text };
  });
  check('FS: Save As writes a localoffice/v1 plan file through the handle', frt.fmt === 'localoffice/v1' && frt.type === 'plan' && frt.savedItem === 'ITEMX');
  check('FS: Open reads the saved plan back through the handle', frt.opened.item === 'ITEMX' && frt.opened.title === 'FS Plan');
  check('FS: in-place Save writes through the existing handle', frt.inplace === 'EDITED');

  // ── embed: the LocalOffice Hub hands us a file via postMessage ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'plan', meta: { title: 'Embedded plan' }, body: { planTitle: 'Embedded plan', tracks: [{ id: 't1', title: 'T', sections: [] }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, error: m.error, title: data.planTitle, tracks: data.tracks.length, hSet: fileHandle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a plan and acks ok', embed.ok === true && embed.title === 'Embedded plan' && embed.tracks === 1);
  check('embed: plan keeps the file handle for in-place save', embed.hSet === true);

  // ── opening a plan dismisses the first-run brain-dump overlay (Hub regression) ──
  check('opening a plan hides the brain-dump overlay', await page.evaluate(() => {
    showBraindump();                               // simulate first-run (no saved data -> brain-dump showing)
    const wasShown = document.getElementById('braindump-overlay').classList.contains('show');
    applyOpenedPlan({ type: 'plan', meta: { title: 'Opened' }, body: { planTitle: 'Opened', tracks: [{ id: 't1', title: 'T', sections: [] }] } }, null);
    const hidden = !document.getElementById('braindump-overlay').classList.contains('show');
    return wasShown && hidden && data.planTitle === 'Opened';
  }));

  // ── malformed plan bodies must load SAFELY (no crash, no clobber of a good
  // autosave). The open guard only checked Array.isArray(tracks); a track without
  // sections / a section without items / non-array sub-fields crashed render() AND
  // (because data+saveData ran before render) bricked the autosaved good plan. ──
  const mal = await page.evaluate(() => {
    const open = body => { try { applyOpenedPlan({ type: 'plan', meta: {}, body }, null); return 'ok'; } catch (e) { return 'THREW:' + e.message; } };
    return {
      noSections:  open({ planTitle: 'P', tracks: [{ id: 't', title: 'T' }] }),
      noItems:     open({ planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: [{ name: 'N', horizon: 'now' }] }] }),
      itemsStr:    open({ planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: [{ name: 'N', horizon: 'now', items: 'x' }] }] }),
      sectionsObj: open({ planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: {} }] }),
      trackStr:    open({ planTitle: 'P', tracks: ['junk', { id: 't', title: 'T', sections: [] }] }),
      itemStr:     open({ planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: [{ name: 'N', horizon: 'now', items: ['raw string item'] }] }] }),
    };
  });
  check('malformed plan bodies load without crashing render', Object.values(mal).every(v => v === 'ok'));
  check('a string item is coerced to an object with an id (no silent drop/crash)', await page.evaluate(() =>
    data.tracks[0].sections[0].items[0] && typeof data.tracks[0].sections[0].items[0] === 'object' && !!data.tracks[0].sections[0].items[0].id));

  // the autosave only ever persists a VALID body: after any malformed open (now
  // coerced, render-before-save) the autosaved JSON is still parseable with a
  // tracks array - never a half-written corrupt body that bricks the tool on reload.
  check('autosave after a malformed open holds a valid, parseable plan (never bricked)', await page.evaluate(async () => {
    applyOpenedPlan({ type: 'plan', meta: {}, body: { planTitle: 'BAD', tracks: [{ id: 'b', title: 'B' }, 'junk', { id: 'c', title: 'C', sections: {} }] } }, null);
    await new Promise(r => setTimeout(r, 260));   // > the 200ms autosave debounce
    const raw = localStorage.getItem('localplan_data_v1') || '';
    try { const p = JSON.parse(raw); return Array.isArray(p.tracks) && p.tracks.every(t => Array.isArray(t.sections)); } catch (e) { return false; }
  }));

  // coercion must PRESERVE unknown fields (forward-compat) while repairing shape
  check('coercePlanBody preserves unknown track/item fields', await page.evaluate(() => {
    applyOpenedPlan({ type: 'plan', meta: {}, body: { planTitle: 'P', _bodyX: 1, tracks: [{ id: 't', title: 'T', _trackX: 2, sections: [{ name: 'N', horizon: 'now', items: [{ id: 'i', text: 'x', _itemX: 3 }] }] }] } }, null);
    return data._bodyX === 1 && data.tracks[0]._trackX === 2 && data.tracks[0].sections[0].items[0]._itemX === 3;
  }));

  // recurring reset must survive a malformed doneDate (already safe - pin it)
  check('recurring reset survives an invalid doneDate (no crash/wrong reset)', await page.evaluate(() => {
    data = { planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: [{ name: 'N', horizon: 'now', items: [{ id: 'i', text: 'x', recur: 'daily', done: true, doneDate: 'not-a-date' }] }] }] };
    try { processRecurring(); return data.tracks[0].sections[0].items[0].done === true; } catch (e) { return false; }
  }));

  // ── undo / redo (Ctrl+Z / Ctrl+Y) across mutations ──
  check('undo reverts changes, redo reapplies, and Ctrl+Z works', await page.evaluate(() => {
    applyOpenedPlan({ type: 'plan', meta: {}, body: { planTitle: 'P', tracks: [{ id: 't', title: 'T', sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'a', text: 'one' }] }] }] } }, null);
    const n = () => data.tracks[0].sections[0].items.length;
    const base = n();
    data.tracks[0].sections[0].items.push({ id: 'b', text: 'two' }); saveData(); const added = n();
    data.planTitle = 'Renamed'; saveData();
    undo(); const undoneTitle = data.planTitle;     // first undo reverts the rename
    undo(); const undoneCount = n();                // second undo reverts the add
    redo(); const redoneCount = n();
    redo(); const redoneTitle = data.planTitle;
    // keyboard path
    data.tracks[0].sections[0].items.push({ id: 'c', text: 'three' }); saveData(); const k0 = n();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    return base === 1 && added === 2 && undoneTitle === 'P' && undoneCount === 1 && redoneCount === 2 && redoneTitle === 'Renamed' && k0 === 3 && n() === 2;
  }));
  check('opening a file resets undo history (undo never crosses documents)', await page.evaluate(() => {
    applyOpenedPlan({ type: 'plan', meta: {}, body: { planTitle: 'Fresh', tracks: [{ id: 't', title: 'T', sections: [] }] } }, null);
    undo(); // nothing recorded since the open
    return data.planTitle === 'Fresh' && document.getElementById('undo-btn').disabled === true;
  }));

  check('JSON panel Prompt toggle shows the plan schema, then returns to JSON', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea'), pb = jp.querySelector('[data-a="prompt"]');
    if (!pb || pb.hidden) return false;
    pb.click();
    const shown = ta.value.includes('localoffice/v1') && ta.value.includes('"type": "plan"') && ta.value.includes('<describe the plan you want');
    pb.click();
    return shown && ta.value.includes('"format"') && !ta.value.includes('<describe the plan you want');
  }));
  check('a schema-shaped plan applies and renders', await page.evaluate(() => {
    applyOpenedPlan({ type: 'plan', meta: { title: 'Gen' }, body: { planTitle: 'Gen', tracks: [{ id: 't1', icon: 'W', title: 'Work', open: true, sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'ship it', priority: true }] }] }] } }, null);
    return data.tracks.length === 1 && data.tracks[0].sections[0].items[0].text === 'ship it';
  }));

  check('AI in-app Generate drafts a plan and applies it (mocked Ollama)', await page.evaluate(async () => {
    const env = { format: 'localoffice/v1', type: 'plan', meta: { title: 'Gen' }, body: { planTitle: 'Gen', tracks: [{ id: 't1', icon: 'W', title: 'Work', open: true, sections: [{ name: 'Now', horizon: 'now', items: [{ id: 'i1', text: 'ship it', priority: true }] }] }] } };
    const sel = document.getElementById('ai-model'); sel.innerHTML = '<option value="m">m</option>'; sel.value = 'm';
    window.fetch = async (u) => { u = String(u); if (u.indexOf('/api/generate') >= 0) return { ok: true, json: async () => ({ response: JSON.stringify(env) }) }; return { ok: false, status: 404 }; };
    document.getElementById('gen-input').value = 'a small work plan';
    await ogRun();
    const previewShown = !document.getElementById('gen-apply').classList.contains('hidden');
    ogApply();
    return previewShown && data.tracks.length === 1 && data.tracks[0].sections[0].items[0].text === 'ship it';
  }));

  check('Embeds host: + Add embeds an object (LocalRender preview) + modal edit; round-trip preserves body.embeds', await page.evaluate(() => {
    EmbedHost.open();
    const sel = document.querySelector('#eh [data-a="add"]'); if (!sel) return false;
    sel.value = 'mindmap'; sel.dispatchEvent(new Event('change'));
    const arr = data.embeds; const added = Array.isArray(arr) && arr.length === 1 && arr[0].envelope.type === 'mindmap';
    const noDrawerIframe = !document.querySelector('#eh iframe');
    const prev = document.querySelector('#eh .eh-prev'); const previewShown = !!prev && prev.innerHTML.length > 0;
    document.querySelector('#eh .eh-edit').click();
    const modalOpen = !!(document.getElementById('eh-editor') && document.getElementById('eh-editor').classList.contains('on'));
    const fr = document.querySelector('#eh-editor .ee-frame');
    const edited = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Sub' }, body: { nodes: [{ id: 'r', text: 'R', parent: null, x: 0, y: 0 }, { id: 'a', text: 'A', parent: 'r', x: 80, y: 40 }], edges: [] } };
    window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'embedState', text: JSON.stringify(edited) }, source: fr.contentWindow }));
    const cached = data.embeds[0].envelope.body.nodes.length === 2;
    const back = LocalOffice.parse(LocalOffice.stringify(planEnvelope())).envelope;
    const rt = back.body.embeds && back.body.embeds.length === 1 && back.body.embeds[0].envelope.type === 'mindmap' && back.body.embeds[0].envelope.body.nodes.length === 2;
    const hasBtn = [...document.querySelectorAll('button')].some(b => b.textContent.indexOf('Embeds') >= 0);
    return added && noDrawerIframe && previewShown && modalOpen && cached && rt && hasBtn;
  }));

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
