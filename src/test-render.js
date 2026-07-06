// Unit tests for the shared static renderer (src/render.js). Pure, no browser.
// Run: node src/test-render.js
'use strict';
const R = require('./render.js');
let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }
const has = (s, sub) => typeof s === 'string' && s.indexOf(sub) >= 0;

// ── sheet -> real table of the used range ──
const sheetEnv = { type: 'sheet', body: { sheets: [{ name: 'S', cells: { A1: { v: 'Item' }, B1: { v: 'Qty' }, A2: { v: 'Bolt' }, B2: { v: 3 } } }] } };
const sh = R.render(sheetEnv);
check('sheet renders an HTML table', has(sh, '<table'));
check('sheet includes header + body cells', has(sh, 'Item') && has(sh, 'Qty') && has(sh, 'Bolt') && has(sh, '>3<'));
check('sheet row 1 is a header (th)', has(sh, '<th'));
check('sheet table uses tabular figures (numbers align in columns)', has(sh, 'tabular-nums'));
check('sheet numeric cell is right-aligned', has(sh, 'text-align:right'));
check('empty sheet falls back to a labelled card', has(R.render({ type: 'sheet', body: { sheets: [{ cells: {} }] } }), '◲ Sheet'));
check('sheet renders a cell fill colour (format.bg) so row colours show when embedded', has(R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: 'H' }, A2: { v: 'x', format: { bg: '#ffcc00' } } } }] } }), 'background:#ffcc00'));
check('sheet renders a cell text colour (format.fg) + bold', (() => { const s = R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: 'x', format: { fg: '#cc0000', bold: true } } } }] } }); return has(s, 'color:#cc0000') && has(s, 'font-weight:700'); })());
check('sheet ignores an unsafe colour value (no style injection)', !has(R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: 'x', format: { bg: 'red;}body{display:none' } } } }] } }), 'display:none'));
check('mindmap connectors anchor to node borders (do not start at the node centre)', (() => { const s = R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'AAAAA', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'a', x: 300, y: 0 }], edges: [] } }); const m = /d="M ([\-0-9.]+) /.exec(s); return m && parseFloat(m[1]) > 5; })());

// used-range cap (deterministic, bounded)
const wide = { type: 'sheet', body: { sheets: [{ cells: {} }] } };
for (let i = 0; i < 40; i++) wide.body.sheets[0].cells['A' + (i + 1)] = { v: i };
const capped = R.render(wide, { maxRows: 5 });
check('sheet caps the used range (maxRows)', (capped.match(/<tr>/g) || []).length <= 5);

// ── mind map -> SVG of nodes + edges ──
const mm = { type: 'mindmap', body: { nodes: [{ id: 'r', text: 'Root', parent: null, x: 0, y: 0 }, { id: 'a', text: 'A', parent: 'r', x: 100, y: 60 }], edges: [] } };
const svg = R.render(mm);
check('mindmap renders an SVG', has(svg, '<svg') && has(svg, 'viewBox'));
check('mindmap draws node labels', has(svg, '>Root<') && has(svg, '>A<'));
check('mindmap draws parent edges as curved connectors (keeps its flow, no straight lines)', has(svg, 'stroke-opacity="0.35"') && has(svg, ' C ') && !has(svg, '<line'));
check('mindmap with no placed nodes falls back to a card', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'r', text: 'x', parent: null }], edges: [] } }), '◲ Mind map'));

// FSM-style port edges also draw
const fsm = { type: 'mindmap', body: { nodes: [{ id: 's0', text: 'IDLE', parent: null, x: 0, y: 0 }, { id: 's1', text: 'RUN', parent: null, x: 120, y: 0 }], edges: [{ from: 's0', to: 's1', label: 'go' }] } };
check('mindmap draws explicit (FSM) edges between nodes', has(R.render(fsm), 'stroke-opacity="0.55"') && has(R.render(fsm), ' C '));

// ── other body types ──
check('runbook renders a checklist', has(R.render({ type: 'runbook', body: { steps: [{ id: '1', kind: 'check', text: 'Inspect', done: true }, { id: '2', kind: 'measure', text: 'Volts' }] } }), '☑') );
check('runbook shows pending as an empty box', has(R.render({ type: 'runbook', body: { steps: [{ id: '2', kind: 'check', text: 'x', done: false }] } }), '☐'));
check('doc renders headings + text', has(R.render({ type: 'doc', body: { blocks: [{ heading: 'Cause', text: 'the root cause' }] } }), 'Cause'));
check('plan renders tracks + sections', has(R.render({ type: 'plan', body: { tracks: [{ title: 'Work', sections: [{ name: 'Now', items: [{ text: 'ship' }] }] }] } }), 'Work') );
check('flashcards render front - back', has(R.render({ type: 'flashcards', body: { cards: [{ front: 'Q', back: 'A' }] } }), 'Q'));
check('slides render a title list', has(R.render({ type: 'slides', body: { slides: [{ blocks: [{ role: 'title', content: 'Hello' }] }] } }), 'Hello'));
check('unknown type -> labelled card, never throws', has(R.render({ type: 'wat', body: {} }), '◲'));
check('null/empty envelope does not throw', typeof R.render(null) === 'string' && typeof R.render({}) === 'string');

// ── security + determinism (hard rules) ──
const xss = R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: '<script>alert(1)</script>' } } }] } });
check('cell values are HTML-escaped (no raw <script>)', !has(xss, '<script>') && has(xss, '&lt;script&gt;'));
const mmx = R.render({ type: 'mindmap', body: { nodes: [{ id: 'r', text: '<b>x</b>', parent: null, x: 0, y: 0 }, { id: 'a', text: 'y', parent: 'r', x: 50, y: 50 }], edges: [] } });
check('mindmap labels are escaped', !has(mmx, '<b>x</b>') && has(mmx, '&lt;b&gt;'));
check('render is deterministic (same input -> same output)', R.render(sheetEnv) === sh && R.render(mm) === svg);

// helpers
check('summary() reports counts', R.summary(sheetEnv) === '4 cells' && R.summary(mm) === '2 nodes');
check('titleOf() prefers meta.title then label', R.titleOf({ type: 'sheet', meta: { title: 'Budget' } }) === 'Budget' && R.titleOf({ type: 'plan' }) === 'Plan');

// ── deeper coverage ──
check('sheet renders a formula cell as =expr', has(R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: 1 }, A2: { f: 'A1+1' } } }] } }), '=A1+1'));
check('sheet with gaps still builds a grid up to the used range', (() => { const s = R.render({ type: 'sheet', body: { sheets: [{ cells: { A1: { v: 'x' }, C3: { v: 'y' } } }] } }); return has(s, 'x') && has(s, 'y') && (s.match(/<tr>/g) || []).length === 3; })());
check('sheet caps columns (maxCols)', (() => { const cells = {}; 'ABCDEFGHIJ'.split('').forEach(c => cells[c + '1'] = { v: c }); const s = R.render({ type: 'sheet', body: { sheets: [{ cells }] } }, { maxCols: 4 }); return (s.match(/<t[hd]/g) || []).length === 4; })());
check('mindmap FSM (edges only, no parent) draws both nodes + a transition line', (() => { const s = R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'S0', parent: null, x: 0, y: 0 }, { id: 'b', text: 'S1', parent: null, x: 200, y: 0 }], edges: [{ from: 'a', to: 'b' }] } }); return has(s, '>S0<') && has(s, '>S1<') && has(s, 'stroke-opacity="0.55"'); })());
check('mindmap ignores nodes lacking x/y but still renders placed ones', (() => { const s = R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'a', x: 50, y: 50 }, { id: 'c', text: 'C', parent: 'a' }], edges: [] } }); return has(s, '<svg') && has(s, '>A<') && has(s, '>B<'); })());
check('runbook shows note bullet, passing ☑, pending ☐', (() => { const s = R.render({ type: 'runbook', body: { steps: [{ kind: 'note', text: 'n' }, { kind: 'check', text: 'p', done: true }, { kind: 'measure', text: 'q' }] } }); return has(s, '•') && has(s, '☑') && has(s, '☐'); })());
check('runbook honours a verify result.pass as ☑', has(R.render({ type: 'runbook', body: { steps: [{ kind: 'measure', text: 'v', result: { pass: true } }] } }), '☑'));
check('doc strips markdown markers in the preview', (() => { const s = R.render({ type: 'doc', body: { blocks: [{ heading: 'H', text: '## hi **bold** `code`' }] } }); return has(s, 'H') && has(s, 'hi bold code') && !has(s, '**'); })());
check('plan lists section items', has(R.render({ type: 'plan', body: { tracks: [{ title: 'T', sections: [{ name: 'Now', items: [{ text: 'do a' }, { text: 'do b' }] }] }] } }), 'do a'));
check('flashcards escape + render multiple', (() => { const s = R.render({ type: 'flashcards', body: { cards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }] } }); return has(s, 'Q1') && has(s, 'A2'); })());
check('slides number their titles', (() => { const s = R.render({ type: 'slides', body: { slides: [{ blocks: [{ role: 'title', content: 'Alpha' }] }, { blocks: [{ role: 'title', content: 'Beta' }] }] } }); return has(s, '1. Alpha') && has(s, '2. Beta'); })());
check('image type (no renderer) -> card, never throws', has(R.render({ type: 'image', body: { base: '', width: 0, height: 0 } }), '◲ Image'));
check('summary singular vs plural', R.summary({ type: 'mindmap', body: { nodes: [{}] } }) === '1 node' && R.summary({ type: 'runbook', body: { steps: [{}, {}] } }) === '2 steps');
check('opts.maxRows caps runbook/doc/plan lists', (() => { const steps = []; for (let i = 0; i < 30; i++) steps.push({ kind: 'check', text: 't' + i }); return (R.render({ type: 'runbook', body: { steps } }, { maxRows: 6 }).match(/<li/g) || []).length === 6; })());
check('every returned render is a non-empty string', ['sheet', 'mindmap', 'runbook', 'doc', 'plan', 'flashcards', 'slides', 'nope'].every(t => { const s = R.render({ type: t, body: {} }); return typeof s === 'string' && s.length > 0; }));
check('mindmap honours node.color (not monochrome)', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'r', text: 'A', parent: null, x: 0, y: 0, color: 'green' }, { id: 'b', text: 'B', parent: 'r', x: 80, y: 40, color: 'red' }], edges: [] } }), '#5d9b48') && has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'r', text: 'A', parent: null, x: 0, y: 0, color: 'red' }, { id: 'b', text: 'B', parent: 'r', x: 80, y: 40 }], edges: [] } }), '#cf6655'));
check('mindmap uncoloured node stays currentColor', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'r', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'r', x: 80, y: 40 }], edges: [] } }), 'fill="currentColor"'));
// edge styles + labels + node shapes in the snapshot
const em = (edge, extra) => R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: null, x: 200, y: 0 }], edges: [Object.assign({ from: 'a', to: 'b' }, edge)] } }, extra);
check('edge style "arrow" adds a single arrowhead (marker-end, no marker-start)', (() => { const s = em({ style: 'arrow' }); return has(s, 'marker-end="url(#lr-arw)"') && !has(s, 'marker-start'); })());
check('edge style "arrow2" adds a double-headed arrow (marker-start + marker-end)', (() => { const s = em({ style: 'arrow2' }); return has(s, 'marker-start="url(#lr-arw)"') && has(s, 'marker-end="url(#lr-arw)"'); })());
check('edge style "dashed" draws a dashed line', has(em({ style: 'dashed' }), 'stroke-dasharray'));
check('edge style "line"/default is a plain connector (no marker, no dash)', (() => { const s = em({ style: 'line' }); return !has(s, 'marker-') && !has(s, 'stroke-dasharray') && has(s, 'stroke-opacity="0.55"'); })());
check('an explicit edge defines the arrowhead marker', has(em({ style: 'arrow' }), '<marker id="lr-arw"'));
check('edge label is drawn as text', has(em({ label: 'go', style: 'arrow' }), '>go<'));
check('edge label is HTML-escaped', has(em({ label: '<x>', style: 'arrow' }), '&lt;x&gt;'));
check('node kind "circle" renders a <circle>', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'Start', parent: null, x: 0, y: 0, kind: 'circle' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), '<circle'));
check('node kind "triangle" renders a <polygon>', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'D', parent: null, x: 0, y: 0, kind: 'triangle' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), '<polygon'));
check('a plain node stays a <rect>', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), '<rect'));
check('parent link honours node.linkStyle + linkLabel in the snapshot', (() => { const s = R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0 }, { id: 'b', text: 'B', parent: 'a', x: 120, y: 60, linkStyle: 'arrow', linkLabel: 'to' }], edges: [] } }); return has(s, 'marker-end="url(#lr-arw)"') && has(s, '>to<'); })());
check('mindmap node accepts a custom hex colour', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0, color: '#3d8bd4' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), '#3d8bd4'));
check('node kind "rect" renders a sharp rectangle (rx=0)', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'A', parent: null, x: 0, y: 0, kind: 'rect' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), 'rx="0"'));
check('node kind "diamond" renders a <polygon>', (() => { const s = R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'D', parent: null, x: 0, y: 0, kind: 'diamond' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }); return has(s, '<polygon') && has(s, '>D<'); })());
check('coloured circle node uses its colour', has(R.render({ type: 'mindmap', body: { nodes: [{ id: 'a', text: 'S', parent: null, x: 0, y: 0, kind: 'circle', color: 'blue' }, { id: 'b', text: 'B', parent: 'a', x: 90, y: 50 }], edges: [] } }), '#5b87d6'));

console.log(`\n\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
