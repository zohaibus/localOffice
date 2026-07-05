// Headless verification of localMindMap (body type `mindmap`, localoffice/v1).
// Run: node verify-mindmap.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');
const FILE_URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());                 // auto-accept confirm/prompt
  await page.addInitScript(fsMockInit);               // in-memory File System Access API
  await page.goto(FILE_URL);
  await page.waitForTimeout(150);

  check('localMindMap boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('shared core is inlined (LocalOffice present)', await page.evaluate(() => typeof LocalOffice === 'object' && !!LocalOffice.createEnvelope));
  check('a fresh map seeds exactly one root node', await page.evaluate(() => data.nodes.length === 1 && data.nodes[0].parent === null));

  // ── envelope round-trip (+ legacy coerce + forward-compat) ──
  const r = await page.evaluate(() => {
    mapTitle = 'Project map';
    data = { nodes: [
      { id: 'a', text: 'Root', x: 100, y: 100, parent: null, collapsed: false },
      { id: 'b', text: 'Child', x: 300, y: 100, parent: 'a', collapsed: false } ],
      edges: [{ from: 'a', to: 'b', label: 'rel' }],
      _custom: { keep: 'me' } };
    const env = exportData();
    const text = LocalOffice.serialize(env);
    const o = JSON.parse(text);
    const back = LocalOffice.parse(text).envelope;

    // legacy bare { nodes } coerced into an envelope
    const legacy = JSON.stringify({ title: 'Bare map', nodes: [{ id: 'x', text: 'Lone', x: 0, y: 0, parent: null }] });
    const env2 = LocalOffice.parse(legacy, { coerce: raw => (raw && Array.isArray(raw.nodes)) ? LocalOffice.createEnvelope('mindmap', { title: raw.title, app: 'localmindmap@1.0', body: raw }) : null }).envelope;

    return {
      format: o.format, type: o.type, title: o.meta.title, app: o.meta.app,
      valid: LocalOffice.validate(env).ok,
      nodes: back.body.nodes.length, edges: back.body.edges.length,
      keptUnknown: back.body._custom && back.body._custom.keep === 'me',
      legacyType: env2.type, legacyNode: env2.body.nodes[0].text, legacyTitle: env2.meta.title
    };
  });
  check('export writes format localoffice/v1', r.format === 'localoffice/v1');
  check('export writes type mindmap', r.type === 'mindmap');
  check('export stamps meta.title', r.title === 'Project map');
  check('export stamps app=localmindmap@1.0', r.app === 'localmindmap@1.0');
  check('envelope validates via the shared core', r.valid === true);
  check('round-trip preserves nodes and edges', r.nodes === 2 && r.edges === 1);
  check('round-trip preserves unknown body fields (forward-compat)', r.keptUnknown === true);
  check('legacy bare { nodes } is coerced to a mindmap envelope', r.legacyType === 'mindmap' && r.legacyNode === 'Lone');
  check('legacy coerce carries the title into meta', r.legacyTitle === 'Bare map');

  // importData applies an envelope to live state
  const imp = await page.evaluate(() => {
    importData(LocalOffice.createEnvelope('mindmap', { title: 'Imported', app: 'localmindmap@1.0', body: { nodes: [{ id: 'r', text: 'Hi', x: 0, y: 0, parent: null }], edges: [] } }));
    return { title: mapTitle, n: data.nodes.length };
  });
  check('importData loads an envelope into the live map', imp.title === 'Imported' && imp.n === 1);

  // ── corrupt-graph robustness: a self-parent or parent CYCLE must NOT hang or
  // crash. render() runs inside open, so a hand-edited/corrupt file with a cycle
  // would otherwise wedge the whole tab. Every walk is bounded by a visited set.
  // (If any of these looped, the test process would time out instead of passing.)
  check('a self-parented node renders without an infinite loop', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'R', x: 0, y: 0, parent: null, collapsed: false }, { id: 's', text: 'Self', x: 1, y: 1, parent: 's', collapsed: false }], edges: [] };
    selectedId = 'a'; render(); return document.querySelectorAll('#world .node').length === 2;
  }));
  check('a parent cycle renders + fits + tidies without looping or overflowing', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: 'b', collapsed: false }, { id: 'b', text: 'B', x: 1, y: 1, parent: 'a', collapsed: false }], edges: [] };
    selectedId = 'a'; render(); fitView();
    try { tidyAll(); } catch (e) { return false; }   // layoutTree must not stack-overflow
    return true;
  }));
  check('deleteNode on a self-parented node terminates and removes it', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'R', x: 0, y: 0, parent: null, collapsed: false }, { id: 's', text: 'S', x: 1, y: 1, parent: 's', collapsed: false }], edges: [] };
    selectedId = 's'; deleteNode('s'); return !byId('s') && data.nodes.length === 1;
  }));
  check('descendantCount on a cycle terminates', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: 'b' }, { id: 'b', text: 'B', x: 1, y: 1, parent: 'a' }], edges: [] };
    const c = descendantCount('a'); return Number.isFinite(c);
  }));
  check('a node loaded with missing x/y gets finite coords (no NaN SVG)', await page.evaluate(() => {
    importData(LocalOffice.createEnvelope('mindmap', { title: 'NaNmap', app: 'localmindmap@1.0', body: { nodes: [{ id: 'a', text: 'R', parent: null }, { id: 'b', text: 'C', parent: 'a' }], edges: [] } }));
    render(); return Number.isFinite(byId('a').x) && Number.isFinite(byId('b').y);
  }));
  // dangling refs are already safe (missing parent terminates the walk; dangling edge drops) - pin it
  check('a dangling parent / dangling edge renders safely (no crash)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: 'GHOST', collapsed: false }], edges: [{ from: 'a', to: 'NOPE', label: 'x' }] };
    selectedId = 'a'; render(); return document.querySelectorAll('#world .node').length === 1;
  }));

  // a non-mindmap envelope is recognizable so open can reject it
  check('a non-mindmap envelope is recognizable (so open can reject)', await page.evaluate(() => {
    try { return LocalOffice.parse(JSON.stringify({ format: 'localoffice/v1', type: 'slides', meta: {}, body: {} })).envelope.type === 'slides'; } catch { return false; }
  }));

  // ── File System Access IO is inlined ──
  const io = await page.evaluate(() => ({ save: typeof LocalOffice.saveFile, open: typeof LocalOffice.openFile, fs: typeof LocalOffice.supportsFS, dl: typeof LocalOffice.download }));
  check('core File IO inlined (saveFile/openFile/supportsFS/download)', io.save === 'function' && io.open === 'function' && io.fs === 'function' && io.dl === 'function');
  check('New / Open / Save / Save As / Print functions exist', await page.evaluate(() => ['newMind', 'openMind', 'saveMind', 'saveMindAs', 'printMind'].every(f => typeof window[f] === 'function')));

  // ── structural edits ──
  const child = await page.evaluate(() => {
    newMind(true); render();
    const rootId = data.nodes[0].id;
    const n = addChild(rootId);
    return { count: data.nodes.length, parent: n.parent === rootId, offsetRight: n.x > data.nodes[0].x, selected: selectedId === n.id, text: n.text };
  });
  check('addChild appends a node parented to the target', child.count === 2 && child.parent && child.selected);
  check('addChild places the new node to the right (deterministic, not auto-layout)', child.offsetRight === true);

  const sibling = await page.evaluate(() => {
    const childId = selectedId;
    const s = addSibling(childId);
    return { count: data.nodes.length, sameParent: s.parent === byId(childId).parent };
  });
  check('addSibling adds a node under the same parent', sibling.count === 3 && sibling.sameParent === true);

  // collapse hides descendants (rendered node count drops)
  const collapse = await page.evaluate(() => {
    newMind(true);
    const root = data.nodes[0].id;
    const c1 = addChild(root); const g1 = addChild(c1.id); addChild(c1.id);
    render();
    const before = document.querySelectorAll('#world .node').length;
    toggleCollapse(c1.id);
    const after = document.querySelectorAll('#world .node').length;
    const badge = document.querySelector('.node[data-id="' + c1.id + '"] .toggle').textContent;
    return { before, after, badge };
  });
  check('collapse hides the subtree (fewer rendered nodes)', collapse.before === 4 && collapse.after === 2);
  check('a collapsed node shows a +count badge', /^\+\d/.test(collapse.badge));

  // Del (default, Visio-like): delete ONLY the node, re-parent its children up
  const del = await page.evaluate(() => {
    newMind(true);
    const root = data.nodes[0].id;
    const c1 = addChild(root); const g1 = addChild(c1.id);
    deleteNode(c1.id);
    return { nodes: data.nodes.length, g1parent: byId(g1.id) ? byId(g1.id).parent : 'GONE', root };
  });
  check('Del deletes only the node and re-parents its children (branch survives)', del.nodes === 2 && del.g1parent === del.root);
  // Shift+Del (deleteBranch): remove the node and its whole subtree + dependent edges
  const delB = await page.evaluate(() => {
    newMind(true);
    const root = data.nodes[0].id;
    const c1 = addChild(root); const g1 = addChild(c1.id);
    data.edges.push({ from: root, to: g1.id, label: 'x' });
    deleteBranch(c1.id);
    return { nodes: data.nodes.length, edges: data.edges.length };
  });
  check('deleteBranch removes the node, its descendants, and dependent edges', delB.nodes === 1 && delB.edges === 0);
  check('delete refuses to remove the last node', await page.evaluate(() => { newMind(true); deleteNode(data.nodes[0].id); return data.nodes.length === 1; }));

  // cross-links render as dashed paths with a label
  const links = await page.evaluate(() => {
    newMind(true);
    const root = data.nodes[0].id;
    const c = addChild(root);
    data.edges.push({ from: root, to: c.id, label: 'depends on' });
    render();
    return { xlink: document.querySelectorAll('#edges path.xlink').length, label: /depends on/.test(document.getElementById('edges').innerHTML), parentLink: document.querySelectorAll('#edges path.link').length };
  });
  check('parent→child relationships render as links', links.parentLink === 1);
  check('explicit edges render as labeled cross-links', links.xlink === 1 && links.label === true);

  // ── view: pan/zoom + fit ──
  const view = await page.evaluate(() => {
    zoom = 1; applyView();
    const start = world.style.transform;
    zoomBy(1.1);
    const z = zoom; const lbl = document.getElementById('zoom-label').textContent;
    fitView();
    return { changed: world.style.transform !== start, zoomedIn: z > 1, lbl, hasTransform: /scale\(/.test(world.style.transform) };
  });
  check('zoom updates the world transform and % label', view.zoomedIn === true && /\d+%/.test(view.lbl));
  check('fitView recomputes the transform (scale present)', view.hasTransform === true);

  // ── theme toggle ──
  check('dark/light toggle flips the body class', await page.evaluate(() => { const a = document.body.classList.contains('dark'); toggleTheme(); const b = document.body.classList.contains('dark'); toggleTheme(); return a !== b; }));
  check('toolbar exposes New / Open / Save / Print', await page.evaluate(() => { const t = document.querySelector('.toolbar').innerText; return /New/.test(t) && /Open/.test(t) && /Save/.test(t) && /Print/.test(t); }));

  // ── node category colors ──
  const col = await page.evaluate(() => {
    newMind(true); render();
    const id = data.nodes[0].id; selectedId = id;
    setNodeColor('blue');
    const colored = byId(id).color, hasClass = !!document.querySelector('.node[data-id="' + id + '"].c-blue');
    setNodeColor('default');
    return { colored, hasClass, cleared: byId(id).color === undefined };
  });
  check('setNodeColor stores a color and tags the node DOM', col.colored === 'blue' && col.hasClass === true);
  check('setNodeColor("default") clears the color', col.cleared === true);
  check('color survives the envelope round-trip', await page.evaluate(() => {
    newMind(true); selectedId = data.nodes[0].id; setNodeColor('green');
    const back = LocalOffice.parse(LocalOffice.serialize(exportData())).envelope;
    return back.body.nodes[0].color === 'green';
  }));

  // ── image nodes (canvas EXIF-scrub) ──
  const img = await page.evaluate(async () => {
    newMind(true);
    const id = data.nodes[0].id;
    const cv = document.createElement('canvas'); cv.width = 6; cv.height = 6; const ctx = cv.getContext('2d'); ctx.fillStyle = '#09f'; ctx.fillRect(0, 0, 6, 6);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'shot.png', { type: 'image/png' });
    await setNodeImage(byId(id), file);
    render();
    return { has: !!byId(id).image && byId(id).image.indexOf('data:image') === 0, rendered: !!document.querySelector('.node[data-id="' + id + '"] img.node-img') };
  });
  check('setNodeImage stores a scrubbed data URL on the node', img.has === true);
  check('the image renders inside the node', img.rendered === true);
  check('removeNodeImage clears it', await page.evaluate(() => { const id = data.nodes[0].id; removeNodeImage(id); render(); return !byId(id).image && !document.querySelector('.node[data-id="' + id + '"] img.node-img'); }));

  // ── touch drag a node ──
  const touch = await page.evaluate(() => {
    newMind(true); zoom = 1; applyView(); render();
    const id = data.nodes[0].id;
    const el = document.querySelector('.node[data-id="' + id + '"]');
    const b = { x: byId(id).x, y: byId(id).y };
    const mk = (type, x, y) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); };
    el.dispatchEvent(mk('touchstart', 100, 100));
    document.dispatchEvent(mk('touchmove', 220, 190));
    document.dispatchEvent(mk('touchend', 220, 190));
    return { dx: byId(id).x - b.x, dy: byId(id).y - b.y };
  });
  check('a one-finger touch drag moves a node', touch.dx > 80 && touch.dy > 60);

  // ════════════════════════════════════════════════════════════════
  // OPTIONAL LOCAL AI - mocked Ollama (runs with or without Ollama).
  // ════════════════════════════════════════════════════════════════
  check('toolbar exposes the ✦ AI button', await page.evaluate(() => /✦ AI/.test(document.querySelector('.toolbar').innerText)));
  await page.evaluate(() => {
    window.__mock = { generate: '', failTags: false };
    window.fetch = async (url) => {
      url = String(url);
      if (url.includes('/api/tags')) { if (window.__mock.failTags) throw new Error('refused'); return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'qwen' }] }) }; }
      if (url.includes('/api/generate')) return { ok: true, json: async () => ({ response: window.__mock.generate }) };
      return { ok: false, status: 404 };
    };
  });
  await page.evaluate(async () => { await AI.show(); });
  await page.waitForTimeout(30);
  check('AI.show opens the drawer and detect populates models', await page.evaluate(() => !document.getElementById('ai-panel').classList.contains('hidden') && AI.models.length === 2));
  check('AI.hide closes the drawer', await page.evaluate(() => { AI.hide(); return document.getElementById('ai-panel').classList.contains('hidden'); }));
  check('detect fails gracefully when Ollama is down', await page.evaluate(async () => { window.__mock.failTags = true; await AI.detect(); window.__mock.failTags = false; return document.getElementById('ai-status').classList.contains('err'); }));

  // Expand: validated children appended to the selected node (confirm auto-accepted)
  const expand = await page.evaluate(async () => {
    newMind(true); selectedId = data.nodes[0].id;
    window.__mock.generate = JSON.stringify({ children: ['Heatsink sizing', 'Active cooling', 'Throttling limits'] });
    await aiExpand();
    const kids = childrenOf(data.nodes[0].id);
    return { count: data.nodes.length, kids: kids.length, first: kids[0] && kids[0].text };
  });
  check('AI expand appends the validated sub-nodes as children', expand.count === 4 && expand.kids === 3 && expand.first === 'Heatsink sizing');
  check('AI expand rejects <2 children without touching the map', await page.evaluate(async () => {
    newMind(true); selectedId = data.nodes[0].id;
    window.__mock.generate = JSON.stringify({ children: ['only one'] });
    await aiExpand();
    return data.nodes.length === 1;
  }));

  // Distill: nested text → preview → add (root + descendants)
  const distill = await page.evaluate(async () => {
    newMind(true);
    window.__mock.generate = JSON.stringify({ root: 'System', children: [{ text: 'Sensor', children: [{ text: 'Filter' }] }, { text: 'Power' }] });
    document.getElementById('ai-distill-input').value = 'some rfc text';
    await aiDistillToMap();
    const previewShown = !document.getElementById('ai-distill-preview').classList.contains('hidden');
    const before = data.nodes.length;
    aiApplyDistill();
    const roots = data.nodes.filter(n => !n.parent);
    return { previewShown, before, added: data.nodes.length - before, roots: roots.length, hasFilter: data.nodes.some(n => n.text === 'Filter') };
  });
  check('AI distill shows a preview before changing the map', distill.previewShown === true && distill.before === 1);
  check('AI distill adds the whole nested tree on apply', distill.added === 4 && distill.hasFilter === true);
  check('AI distill adds a second root (drops beside existing content)', distill.roots === 2);

  // typing in the AI textarea must not fire canvas shortcuts (Space/Tab/Enter)
  check('canvas shortcuts are suppressed while the AI textarea is focused', await page.evaluate(() => {
    newMind(true); selectedId = data.nodes[0].id;
    document.getElementById('ai-panel').classList.remove('hidden'); // textarea can't focus while display:none
    const ta = document.getElementById('ai-distill-input'); ta.focus();
    const before = data.nodes.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); // would addChild if not guarded
    return data.nodes.length === before;
  }));

  // ── tidy layout: the distilled subtree must not overlap (the reported bug) ──
  const tidy = await page.evaluate(() => {
    newMind(true);
    window.__mock.generate = JSON.stringify({ root: 'Sys', children: [
      { text: 'A', children: [{ text: 'A1' }, { text: 'A2' }] },
      { text: 'B', children: [{ text: 'B1' }, { text: 'B2' }] } ] });
    document.getElementById('ai-distill-input').value = 'x';
    return aiDistillToMap().then(() => { aiApplyDistill();
      const fresh = data.nodes.filter(n => n.text !== 'Central idea');
      const pos = fresh.map(n => n.x + ',' + n.y);
      const uniquePos = new Set(pos).size === pos.length;            // no two new nodes share a point
      const byT = {}; fresh.forEach(n => byT[n.text] = n);
      const childRight = byT['A1'].x > byT['A'].x && byT['B1'].x > byT['B'].x;  // depth → x
      const leavesDistinct = byT['A1'].y !== byT['A2'].y;            // leaves stacked, not overlapping
      return { uniquePos, childRight, leavesDistinct };
    });
  });
  check('tidy layout gives every distilled node a unique position', tidy.uniquePos === true);
  check('tidy layout pushes children right of their parent (depth → x)', tidy.childRight === true);
  check('tidy layout stacks sibling leaves without overlap', tidy.leavesDistinct === true);

  // ── per-node font size ──
  const fz = await page.evaluate(() => {
    newMind(true); const id = data.nodes[0].id; selectedId = id;
    setNodeFont(1);                                 // m → l
    const big = byId(id).size, hasL = !!document.querySelector('.node[data-id="' + id + '"].fz-l');
    setNodeFont(-1); setNodeFont(-1);               // l → m → s
    const small = byId(id).size;
    setNodeFont(1);                                 // s → m (cleared)
    return { big, hasL, small, cleared: byId(id).size === undefined };
  });
  check('setNodeFont enlarges the node text (m→l) and tags the DOM', fz.big === 'l' && fz.hasL === true);
  check('setNodeFont shrinks down to s', fz.small === 's');
  check('font size returns to default with no stored field', fz.cleared === true);

  // ── snap to grid ──
  const snapRes = await page.evaluate(() => {
    newMind(true); zoom = 1; applyView(); render();
    snap = true;                                    // emulate the toggle being on
    const id = data.nodes[0].id;
    const el = document.querySelector('.node[data-id="' + id + '"]');
    const md = (x, y) => el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    const mv = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    const mu = (x, y) => document.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
    md(0, 0); mv(53, 67); mu(53, 67);               // move by a non-grid delta
    const n = byId(id); snap = false;
    return { x: n.x, y: n.y };
  });
  check('snap-to-grid rounds node coordinates to the grid', snapRes.x % 20 === 0 && snapRes.y % 20 === 0);

  // ── templates ──
  const tpl = await page.evaluate(() => {
    loadTemplate('system-arch');
    const root = data.nodes.find(n => !n.parent);
    const colored = data.nodes.some(n => n.color === 'blue') && data.nodes.some(n => n.color === 'green');
    const pos = data.nodes.map(n => n.x + ',' + n.y);
    return { title: mapTitle, count: data.nodes.length, rootText: root.text, colored, unique: new Set(pos).size === pos.length };
  });
  check('a template loads a populated, titled map', tpl.title === 'System architecture' && tpl.count >= 6 && tpl.rootText === 'Edge Device');
  check('template nodes carry category colors', tpl.colored === true);
  check('template is laid out without overlapping nodes', tpl.unique === true);

  // ── friendly wrong-file handoff ──
  check('wrong file type names the right sister tool', await page.evaluate(() => toolForType('plan') === 'LocalPlan' && toolForType('sheet') === 'LocalSheets' && toolForType('slides') === 'localDeck'));

  // ── explicit Tidy (branch + all) with Ctrl+Z undo ──
  const tidyBr = await page.evaluate(() => {
    newMind(true);
    const root = data.nodes[0]; root.x = 500; root.y = 500;
    const a = createChild(root.id, 'A'), b = createChild(root.id, 'B');
    a.x = 999; a.y = -999; b.x = -999; b.y = 999;     // scatter the children
    selectedId = root.id;
    tidyBranch(root.id);
    return { rootPinned: root.x === 500 && root.y === 500, childrenRight: byId(a.id).x > 500 && byId(b.id).x > 500, distinct: byId(a.id).y !== byId(b.id).y };
  });
  check('Tidy branch keeps the branch root pinned where it was', tidyBr.rootPinned === true);
  check('Tidy branch lays children out to the right, non-overlapping', tidyBr.childrenRight === true && tidyBr.distinct === true);

  const undoRes = await page.evaluate(() => {
    const before = { x: byId(data.nodes.find(n => n.text === 'A').id).x };   // post-tidy
    undo();                                            // restore pre-tidy scatter (full-state restore: re-find after)
    const a = data.nodes.find(n => n.text === 'A');
    return { restored: a.x === 999 && a.y === -999, changed: a.x !== before.x };
  });
  check('Ctrl+Z undo restores the pre-tidy positions', undoRes.restored === true && undoRes.changed === true);

  // ── full undo / redo across structural + style edits ──
  check('undo/redo: add child -> undo removes -> redo restores', await page.evaluate(() => {
    newMind(true); const root = data.nodes[0]; const n0 = data.nodes.length;
    addChild(root.id); const added = data.nodes.length;
    undo(); const undone = data.nodes.length;
    redo(); const redone = data.nodes.length;
    return added === n0 + 1 && undone === n0 && redone === n0 + 1;
  }));
  check('undo: a color change is reversible', await page.evaluate(() => {
    newMind(true); const root = data.nodes[0]; selectedId = root.id;
    setNodeColor('blue'); const colored = byId(root.id).color === 'blue';
    undo(); const cleared = !byId(root.id).color;
    return colored && cleared;
  }));
  check('undo: a delete is reversible (subtree comes back)', await page.evaluate(() => {
    newMind(true); const root = data.nodes[0]; const c = createChild(root.id, 'doomed'); saveLocal(); render();
    selectedId = c.id; deleteNode(c.id); const gone = !data.nodes.some(n => n.text === 'doomed');
    undo(); const back = data.nodes.some(n => n.text === 'doomed');
    return gone && back;
  }));
  check('redo works via Ctrl+Y on the keyboard', await page.evaluate(() => {
    newMind(true); const root = data.nodes[0]; const n0 = data.nodes.length;
    addChild(root.id); undo(); const u = data.nodes.length;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    return u === n0 && data.nodes.length === n0 + 1;
  }));

  const tidyAllRes = await page.evaluate(() => {
    newMind(true);
    const r1 = data.nodes[0]; const r2 = { id: 'r2', text: 'Second root', x: 0, y: 0, parent: null, collapsed: false }; data.nodes.push(r2);
    createChild(r1.id, 'x'); createChild(r2.id, 'y');
    tidyAll();
    const roots = data.nodes.filter(n => !n.parent);
    const pos = data.nodes.map(n => n.x + ',' + n.y);
    return { rootsSeparated: roots[0].y !== roots[1].y, unique: new Set(pos).size === pos.length };
  });
  check('Tidy all stacks multiple roots without overlap', tidyAllRes.rootsSeparated === true && tidyAllRes.unique === true);

  // ── Clipboard Protocol: paste a sheet grid / TSV → node cluster ──
  const cn = await page.evaluate(() => ({
    grid: clipToNodeTexts({ fragment: { format: 'localoffice/clip-v1', kind: 'grid', grid: [['Sensors', 'green'], ['Compute', 'blue']] }, text: '' }),
    tsv: clipToNodeTexts({ fragment: null, text: 'Alpha\tA\nBeta\tB' }),
    lines: clipToNodeTexts({ fragment: null, text: 'one\ntwo\nthree' }),
    empty: clipToNodeTexts({ fragment: null, text: '   ' }),
  }));
  check('clip grid → one node label per row', cn.grid.length === 2 && cn.grid[0] === 'Sensors  green');
  check('clip TSV → one node per row', cn.tsv.length === 2 && cn.tsv[0] === 'Alpha  A');
  check('clip plain lines → one node per line', cn.lines.length === 3 && cn.lines[2] === 'three');
  check('empty clip → no nodes', cn.empty.length === 0);
  check('paste cluster adds nodes under the selection', await page.evaluate(() => {
    newMind(true); const root = data.nodes[0].id; selectedId = root; addNodeCluster(['x', 'y', 'z']); return childrenOf(root).length === 3;
  }));

  // ── File System Access round-trip (mocked picker - the real Chrome/Edge path) ──
  const frt = await page.evaluate(async () => {
    newMind(true); mapTitle = 'FS Roundtrip'; data.nodes[0].text = 'ROOTX';
    await saveMindAs();                                  // showSaveFilePicker → createWritable → write → close
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    newMind(true);                                       // clobber state
    window.__fsPick = name;
    await openMind();                                    // showOpenFilePicker → getFile → load
    const opened = { root: data.nodes[0].text, title: mapTitle };
    data.nodes[0].text = 'EDITED'; await saveMind();     // in-place via the existing handle
    const after = JSON.parse(window.__virtualFS.get(name));
    return { fmt: saved.format, type: saved.type, savedRoot: saved.body.nodes[0].text, opened, inplace: after.body.nodes[0].text };
  });
  check('FS: Save As writes a localoffice/v1 mindmap through the handle', frt.fmt === 'localoffice/v1' && frt.type === 'mindmap' && frt.savedRoot === 'ROOTX');
  check('FS: Open reads the saved file back through the handle', frt.opened.root === 'ROOTX' && frt.opened.title === 'FS Roundtrip');
  check('FS: in-place Save writes through the existing handle', frt.inplace === 'EDITED');

  // ── embed: the LocalOffice Hub hands us a file via postMessage ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Embedded map' }, body: { nodes: [{ id: 'a', text: 'Hi', x: 0, y: 0, parent: null }], edges: [] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, error: m.error, title: mapTitle, n: data.nodes.length, hSet: fileHandle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a map and acks ok', embed.ok === true && embed.title === 'Embedded map' && embed.n === 1);
  check('embed: map keeps the file handle for in-place save', embed.hSet === true);

  // ── schematic affordances: gate kinds ──
  const gk = await page.evaluate(() => {
    newMind(true); const id = data.nodes[0].id; selectedId = id;
    setNodeKind('and');
    const k = byId(id).kind, hasGlyph = !!document.querySelector('.node[data-id="' + id + '"] .gate-glyph'), hasClass = !!document.querySelector('.node[data-id="' + id + '"].gate');
    setNodeKind('none');
    return { k, hasGlyph, hasClass, cleared: byId(id).kind === undefined, svg: gateGlyph('xor').indexOf('<svg') === 0 };
  });
  check('setNodeKind tags a gate kind and renders its glyph', gk.k === 'and' && gk.hasGlyph === true && gk.hasClass === true);
  check('clearing the kind removes it', gk.cleared === true);
  check('gateGlyph returns an SVG for a gate kind', gk.svg === true);

  // ── port-anchored edges (signal flow) for gate→gate links ──
  const pe = await page.evaluate(() => {
    newMind(true); const a = data.nodes[0]; a.kind = 'and'; const b = createChild(a.id, 'B'); b.kind = 'or'; const c = createChild(a.id, 'C'); render();
    linkFrom = a.id; finishLink(b.id);                 // gate → gate
    const g = data.edges.find(e => e.from === a.id && e.to === b.id);
    linkFrom = b.id; finishLink(c.id);                 // gate → plain
    const plain = data.edges.find(e => e.from === b.id && e.to === c.id);
    return { gatePorts: !!(g && g.fromPort === 'r' && g.toPort === 'l'), plainNoPorts: !!(plain && !plain.fromPort) };
  });
  check('a gate→gate link is port-anchored (out→in)', pe.gatePorts === true);
  check('a link touching a non-gate stays centre-anchored', pe.plainNoPorts === true);

  // ── AI: plot a state machine from code (mocked Ollama) ──
  const sm = await page.evaluate(async () => {
    window.fetch = async (url) => { url = String(url); if (url.includes('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }] }) }; if (url.includes('/api/generate')) return { ok: true, json: async () => ({ response: JSON.stringify({ states: ['IDLE', 'RUN', 'DONE'], transitions: [{ from: 'IDLE', to: 'RUN', label: 'start' }, { from: 'RUN', to: 'DONE' }, { from: 'X', to: 'RUN' }] }) }) }; return { ok: false, status: 404 }; };
    newMind(true); const before = data.nodes.length;
    document.getElementById('ai-sm-input').value = 'always @(posedge clk) case(state) ...';
    await aiStateMachine();
    const previewShown = !document.getElementById('ai-sm-preview').classList.contains('hidden');
    aiApplyStateMachine();
    const stateNodes = data.nodes.filter(n => !n.parent && ['IDLE', 'RUN', 'DONE'].indexOf(n.text) !== -1).length;
    const portEdges = data.edges.filter(e => e.fromPort === 'r').length;
    return { previewShown, added: data.nodes.length - before, stateNodes, portEdges };
  });
  check('AI plots a state machine (states as nodes)', sm.previewShown === true && sm.stateNodes === 3 && sm.added === 3);
  check('transitions become port-anchored edges; invalid refs dropped', sm.portEdges === 2);

  check('JSON panel Prompt toggle shows the mindmap schema, then returns to JSON', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea'), pb = jp.querySelector('[data-a="prompt"]');
    if (!pb || pb.hidden) return false;
    pb.click();
    const shown = ta.value.includes('localoffice/v1') && ta.value.includes('"type": "mindmap"') && ta.value.includes('<describe the mind map you want');
    pb.click();
    return shown && ta.value.includes('"format"') && !ta.value.includes('<describe the mind map you want');
  }));
  check('a schema-shaped mindmap applies and renders', await page.evaluate(() => {
    applyOpenedMind({ type: 'mindmap', meta: { title: 'Gen' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null }, { id: 'a', text: 'A', parent: 'r' }, { id: 'b', text: 'B', parent: 'r' }], edges: [] } }, null);
    render();
    return data.nodes.length === 3 && byId('a').parent === 'r' && Number.isFinite(byId('a').x);
  }));

  check('AI in-app Generate drafts a map and applies it (mocked Ollama)', await page.evaluate(async () => {
    const env = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Gen' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null }, { id: 'a', text: 'A', parent: 'r' }, { id: 'b', text: 'B', parent: 'r' }], edges: [] } };
    const sel = document.getElementById('ai-model'); sel.innerHTML = '<option value="m">m</option>'; sel.value = 'm';
    window.fetch = async (u) => { u = String(u); if (u.indexOf('/api/generate') >= 0) return { ok: true, json: async () => ({ response: JSON.stringify(env) }) }; return { ok: false, status: 404 }; };
    document.getElementById('gen-input').value = 'a tiny tree';
    await ogRun();
    const previewShown = !document.getElementById('gen-apply').classList.contains('hidden');
    ogApply();
    return previewShown && data.nodes.length === 3 && byId('a').parent === 'r' && Number.isFinite(byId('a').x);
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
    const back = LocalOffice.parse(LocalOffice.stringify(exportData())).envelope;
    const rt = back.body.embeds && back.body.embeds.length === 1 && back.body.embeds[0].envelope.type === 'mindmap' && back.body.embeds[0].envelope.body.nodes.length === 2;
    const hasBtn = [...document.querySelectorAll('button')].some(b => b.textContent.indexOf('Embeds') >= 0);
    return added && noDrawerIframe && previewShown && modalOpen && cached && rt && hasBtn;
  }));

  // ── node shapes: circle + triangle ──
  check('setNodeKind adds a circle shape (kind + DOM class)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'S', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    setNodeKind('circle'); const el = document.querySelector('.node[data-id="a"]');
    return byId('a').kind === 'circle' && !!el && el.classList.contains('shape-circle');
  }));
  check('setNodeKind triangle then none clears it', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'D', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    setNodeKind('triangle'); const tri = byId('a').kind === 'triangle' && document.querySelector('.node[data-id="a"]').classList.contains('shape-triangle');
    setNodeKind('none'); return tri && byId('a').kind === undefined;
  }));
  // ── styled / labelled / clickable cross-links ──
  const twoNodes = "data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: null }], edges: [] };";
  check('finishLink creates a cross-link defaulting to an arrow, and selects it', await page.evaluate((tn) => {
    eval(tn); selectedId = 'a'; render(); startLink('a'); finishLink('b');
    return data.edges.length === 1 && data.edges[0].style === 'arrow' && selectedEdge === 0;
  }, twoNodes));
  check('selecting an edge shows the edge bar', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; render(); selectEdge(0);
    return selectedEdge === 0 && !document.getElementById('edge-bar').classList.contains('hidden');
  }, twoNodes));
  check('edge style: arrow renders a marker, dashed renders a dash-array', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; render();
    const arrow = document.getElementById('edges').innerHTML.indexOf('marker-end="url(#mm-arw)"') >= 0;
    selectEdge(0); setEdgeStyle('dashed');
    return arrow && data.edges[0].style === 'dashed' && document.getElementById('edges').innerHTML.indexOf('stroke-dasharray') >= 0;
  }, twoNodes));
  check('edge style: double arrow renders both markers', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow2' }]; render();
    const h = document.getElementById('edges').innerHTML;
    return h.indexOf('marker-start="url(#mm-arw)"') >= 0 && h.indexOf('marker-end="url(#mm-arw)"') >= 0;
  }, twoNodes));
  check('setEdgeLabel writes the label + draws it', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; render(); selectEdge(0); setEdgeLabel('go');
    return data.edges[0].label === 'go' && document.getElementById('edges').innerHTML.indexOf('>go<') >= 0;
  }, twoNodes));
  check('clicking an edge hit-path selects it', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; selectedEdge = null; render();
    const hit = document.querySelector('#edges .xhit'); if (!hit) return false;
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return selectedEdge === 0;
  }, twoNodes));
  check('deleteEdge removes the selected link + hides the bar', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; render(); selectEdge(0); deleteEdge();
    return data.edges.length === 0 && selectedEdge === null && document.getElementById('edge-bar').classList.contains('hidden');
  }, twoNodes));
  check('selecting a node deselects any edge + hides the bar', await page.evaluate((tn) => {
    eval(tn); data.edges = [{ from: 'a', to: 'b', style: 'arrow' }]; render(); selectEdge(0); selectNode('a');
    return selectedEdge === null && document.getElementById('edge-bar').classList.contains('hidden');
  }, twoNodes));
  check('edge style + label + node shape round-trip through serialize', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null, kind: 'circle' }, { id: 'b', text: 'B', x: 200, y: 0, parent: null }], edges: [{ from: 'a', to: 'b', style: 'arrow2', label: 'x' }] };
    const back = LocalOffice.parse(LocalOffice.stringify(exportData())).envelope;
    return back.body.nodes[0].kind === 'circle' && back.body.edges[0].style === 'arrow2' && back.body.edges[0].label === 'x';
  }));
  check('clicking the edge bar does NOT deselect the edge (bar persists until Done/✕)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: null }], edges: [{ from: 'a', to: 'b', style: 'arrow' }] };
    render(); selectEdge(0);
    const bar = document.getElementById('edge-bar');
    bar.querySelector('[data-es="dashed"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));   // used to deselect via the canvas handler
    return selectedEdge === 0 && !bar.classList.contains('hidden');
  }));
  check('connectors anchor to node borders, not centres (line does not run through the text)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'AAAAA', x: 0, y: 0, parent: null }, { id: 'b', text: 'BBBBB', x: 300, y: 0, parent: 'a' }], edges: [] };
    render();
    const d = document.querySelector('#edges path.link').getAttribute('d');
    const m = /^M ([\-0-9.]+) /.exec(d);
    return m && parseFloat(m[1]) > 5;   // exits a's RIGHT border (x>0), not its centre (x=0)
  }));
  // ── parent→child connections are now clickable + labelable + styleable ──
  const pTwo = "data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: 'a' }], edges: [] };";
  check('a parent→child connection is clickable (hit-path selects it)', await page.evaluate((tn) => {
    eval(tn); render();
    const hit = document.querySelector('#edges .xhit[data-parent="b"]'); if (!hit) return false;
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return selectedParent === 'b' && selectedEdge === null && !document.getElementById('edge-bar').classList.contains('hidden');
  }, pTwo));
  check('styling a parent connection stores it on the child + renders the marker', await page.evaluate((tn) => {
    eval(tn); render(); selectParentLink('b'); setEdgeStyle('arrow');
    return byId('b').linkStyle === 'arrow' && document.getElementById('edges').innerHTML.indexOf('marker-end="url(#mm-arw)"') >= 0;
  }, pTwo));
  check('labelling a parent connection stores it on the child + draws it', await page.evaluate((tn) => {
    eval(tn); render(); selectParentLink('b'); setEdgeLabel('flows to');
    return byId('b').linkLabel === 'flows to' && document.getElementById('edges').innerHTML.indexOf('flows to') >= 0;
  }, pTwo));
  check('deleting a parent connection detaches the child (parent → null), keeps both nodes', await page.evaluate((tn) => {
    eval(tn); render(); selectParentLink('b'); deleteEdge();
    return data.nodes.length === 2 && byId('b').parent === null && selectedParent === null;
  }, pTwo));
  check('parent connection style + label round-trip through serialize', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: 'a', linkStyle: 'dashed', linkLabel: 'L' }], edges: [] };
    const back = LocalOffice.parse(LocalOffice.stringify(exportData())).envelope;
    return back.body.nodes[1].linkStyle === 'dashed' && back.body.nodes[1].linkLabel === 'L';
  }));
  // ── standalone shape node ──
  check('picking a shape with nothing selected creates a new shape node', await page.evaluate(() => {
    newMind(true); const before = data.nodes.length;
    selectNode(null); selectedId = null;   // ensure nothing selected
    setNodeKind('triangle');
    return data.nodes.length === before + 1 && byId(selectedId).kind === 'triangle' && byId(selectedId).parent === null;
  }));
  // ── full colour palette + more shapes ──
  check('setNodeColor accepts a custom hex (c-custom class + inline --nc)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    setNodeColor('#3d8bd4'); const el = document.querySelector('.node[data-id="a"]');
    return byId('a').color === '#3d8bd4' && el.classList.contains('c-custom') && el.style.getPropertyValue('--nc') === '#3d8bd4';
  }));
  check('node hex colour + rect/diamond kind round-trip through serialize', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null, color: '#3d8bd4', kind: 'diamond' }], edges: [] };
    const back = LocalOffice.parse(LocalOffice.stringify(exportData())).envelope;
    return back.body.nodes[0].color === '#3d8bd4' && back.body.nodes[0].kind === 'diamond';
  }));
  check('named colours still work (c-blue class)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    setNodeColor('blue'); return document.querySelector('.node[data-id="a"]').classList.contains('c-blue');
  }));
  check('rectangle + diamond shapes apply their classes', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    setNodeKind('rect'); const rectOk = document.querySelector('.node[data-id="a"]').classList.contains('shape-rect');
    setNodeKind('diamond'); const diaOk = document.querySelector('.node[data-id="a"]').classList.contains('shape-diamond');
    return rectOk && diaOk && isShape('rect') && isShape('diamond');
  }));
  check('the colour palette popover opens with swatches + a custom picker', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    toggleColorPop(); const pop = document.getElementById('color-pop');
    const ok = !pop.classList.contains('hidden') && pop.querySelectorAll('.cp-grid button').length >= 12 && !!document.getElementById('color-custom');
    hideColorPop(); return ok;
  }));
  // ── shape nodes stay canvas-positioned (the "arrow points to empty space" bug) ──
  check('a triangle node stays absolutely positioned at its x,y centre (links reach it)', await page.evaluate(() => {
    data = { nodes: [{ id: 'b', text: 'D', x: 700, y: 520, parent: null, kind: 'triangle' }], edges: [] };
    panX = 0; panY = 0; zoom = 1; applyView(); render();
    const el = document.querySelector('.node[data-id="b"]');
    if (getComputedStyle(el).position !== 'absolute') return false;
    const nb = el.getBoundingClientRect(), wb = document.getElementById('world').getBoundingClientRect();
    return Math.abs((nb.left + nb.width / 2 - wb.left) - 700) < 6 && Math.abs((nb.top + nb.height / 2 - wb.top) - 520) < 6;
  }));
  // ── node size range (A− / A+) ──
  check('A+/A− resizes a node across an extended range (xs…xxl)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }], edges: [] }; selectedId = 'a'; render();
    for (let i = 0; i < 5; i++) setNodeFont(1); const big = byId('a').size;
    for (let i = 0; i < 8; i++) setNodeFont(-1); const small = byId('a').size;
    return big === 'xxl' && small === 'xs';
  }));
  // ── drag an endpoint to re-connect (Visio-style) ──
  check('re-connecting a cross-link endpoint re-points it to another node', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: null }, { id: 'c', text: 'C', x: 400, y: 0, parent: null }], edges: [{ from: 'a', to: 'b', style: 'arrow' }] };
    render(); selectEdge(0); reconnectEndpoint('to', 'c');
    return data.edges[0].from === 'a' && data.edges[0].to === 'c';
  }));
  check('re-connecting a parent connection re-parents the child', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: 'a' }, { id: 'c', text: 'C', x: 400, y: 0, parent: null }], edges: [] };
    render(); selectParentLink('b'); reconnectEndpoint('parent', 'c');
    return byId('b').parent === 'c';
  }));
  check('re-parenting onto a descendant is blocked (no cycle)', await page.evaluate(() => {
    data = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0, parent: null }, { id: 'b', text: 'B', x: 200, y: 0, parent: 'a' }, { id: 'c', text: 'C', x: 400, y: 0, parent: 'b' }], edges: [] };
    render(); selectParentLink('b'); reconnectEndpoint('parent', 'c');   // c is b's descendant → refused
    return byId('b').parent === 'a';
  }));

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
