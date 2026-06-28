// Embedded smoke test: load each tool in a REAL iframe (via embed-harness.html),
// hand it a file through the Hub embed protocol, then reach INTO the iframe frame
// (Playwright can evaluate cross-origin frames) to confirm the rendering layer
// behaved exactly as standalone: the file loaded, render ran without error, and -
// for the autosaving tools - no localStorage shadow was written while embedded.
// Run: node verify-embed.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const HARNESS = 'file:///' + path.resolve(__dirname, 'embed-harness.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

const CASES = [
  { name: 'localDeck', file: 'localDeck/localDeck.html', titleExpr: 'deck.meta.title',
    env: { format: 'localoffice/v1', type: 'slides', meta: { title: 'PROBE' }, body: { theme: {}, footer: {}, slides: [{ id: 's1', layout: 'title', blocks: [] }] } } },
  { name: 'localCards', file: 'localCards/localCards.html', titleExpr: 'deck.meta.title',
    env: { format: 'localoffice/v1', type: 'flashcards', meta: { title: 'PROBE' }, body: { deck: { name: 'PROBE' }, scheduler: 'fsrs-lite', cards: [{ id: 'c1', front: 'F', back: 'B' }] } } },
  { name: 'LocalPlan', file: 'localPlan/index.html', titleExpr: 'data.planTitle', lsKey: 'localplan_data_v1',
    env: { format: 'localoffice/v1', type: 'plan', meta: { title: 'PROBE' }, body: { planTitle: 'PROBE', tracks: [{ id: 't1', title: 'T', sections: [] }] } } },
  { name: 'localMindMap', file: 'localMindMap/index.html', titleExpr: 'mapTitle', lsKey: 'localmindmap_data_v1',
    env: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'PROBE' }, body: { nodes: [{ id: 'a', text: 'Hi', x: 0, y: 0, parent: null }], edges: [] } } },
  { name: 'LocalSheets', file: 'localSheets/localsheets.html', titleExpr: 'Store.data.meta.title',
    env: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'PROBE' }, body: { sheets: [{ name: 'S1', cells: {}, cols: 10, rows: 20 }] } } },
  { name: 'localMark', file: 'localMark/index.html', titleExpr: 'title',
    env: { format: 'localoffice/v1', type: 'image', meta: { title: 'PROBE' }, body: { base: '', width: 0, height: 0, overlays: [] } } },
  { name: 'localCheck', file: 'localCheck/index.html', titleExpr: 'title',
    env: { format: 'localoffice/v1', type: 'runbook', meta: { title: 'PROBE' }, body: { steps: [{ id: 'a', kind: 'check', text: 'x', done: false }] } } },
  { name: 'localDoc', file: 'localDoc/index.html', titleExpr: 'title',
    env: { format: 'localoffice/v1', type: 'doc', meta: { title: 'PROBE' }, body: { blocks: [{ id: 'a', heading: 'S', text: '', required: [] }] } } },
];

(async () => {
  const browser = await chromium.launch();
  for (const c of CASES) {
    const page = await browser.newPage();   // fresh page per tool (clean frame + storage)
    page.on('dialog', d => d.accept());
    await page.goto(HARNESS + '#' + encodeURIComponent(JSON.stringify({ file: c.file, env: c.env })));
    let title = '';
    for (let i = 0; i < 50; i++) { title = await page.title(); if (title.startsWith('RESULT:')) break; await page.waitForTimeout(80); }
    let ok = false; try { ok = JSON.parse(title.slice(7)).ok === true; } catch (e) {}
    check(c.name + ': loads + renders in a real iframe (no error)', ok === true);

    const fh = await page.$('#f');
    const frame = fh ? await fh.contentFrame() : null;
    if (!frame) { check(c.name + ': tool frame is present', false); await page.close(); continue; }
    const loaded = await frame.evaluate(c.titleExpr).catch(() => null);
    check(c.name + ': rendered the opened file (correct title in-frame)', loaded === 'PROBE');
    if (c.lsKey) {
      const ls = await frame.evaluate('localStorage.getItem(' + JSON.stringify(c.lsKey) + ')').catch(() => 'ERR');
      check(c.name + ': no localStorage autosave shadow while embedded', ls === null);
    }
    // Save while embedded must DELEGATE to the Hub (post {type:'save'}), NOT call a
    // file picker (blocked in a cross-origin subframe). Trigger Ctrl+S in the frame
    // and confirm the harness (acting as the Hub's write side) received the tool's
    // serialized envelope of the right type - the other half of "doable from the Hub".
    await frame.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    }).catch(() => {});
    await page.waitForTimeout(250);
    const save = await page.evaluate(() => window.__lastSave);
    let savedType = null; try { savedType = JSON.parse(save.text).type; } catch (e) {}
    check(c.name + ': Save while embedded delegates to the Hub (posts the right envelope)', !!save && savedType === c.env.type);
    await page.close();
  }
  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
