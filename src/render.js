/* ════════════════════════════════════════════════════════════════════
   LocalOffice - shared static renderer (LocalRender)
   --------------------------------------------------------------------
   Turns ANY localoffice/v1 envelope body into a self-contained, static
   HTML string, so any tool can DISPLAY an embedded object it doesn't
   itself edit (a sheet's table shown on a deck slide, an FSM mind map in
   a doc, …). Rendering is separated from editing: you view through this
   module; you edit by opening the real tool (live iframe).

   Why a shared *renderer* and not "load the whole tool":
     • single-file tools, no bundler -> code is shared by INLINING this
       module (same pattern as the verify kernel);
     • export must be ONE self-contained file -> it can't reference a
       sibling tool, so the rendered result is emitted inline;
     • a static view is far lighter than a full editor.

   HARD RULES honoured: deterministic (same input -> same output), no
   network, no LLM, output is escaped (safe to inject). Sizing is relative
   (em / %) and colour is `currentColor`, so a host controls scale + theme
   by setting font-size / color on the wrapper.

   No dependencies. Browser (window.LocalRender) + Node (module.exports).
   ════════════════════════════════════════════════════════════════════ */
'use strict';
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.LocalRender = mod;
})(function () {

  const LABELS = { mindmap: 'Mind map', sheet: 'Sheet', runbook: 'Runbook', flashcards: 'Flashcards', plan: 'Plan', slides: 'Slides', doc: 'Document', image: 'Image' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function colToIdx(letters) { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }

  function titleOf(env) { env = env || {}; return (env.meta && env.meta.title) || LABELS[env.type] || env.type || 'object'; }
  function summary(env) {
    env = env || {}; const b = env.body || {};
    switch (env.type) {
      case 'mindmap': { const n = (b.nodes || []).length; return n + ' node' + (n === 1 ? '' : 's'); }
      case 'sheet': { const s = b.sheets && b.sheets[0]; return s ? (Object.keys(s.cells || {}).length + ' cells') : '0 cells'; }
      case 'runbook': { const n = (b.steps || []).length; return n + ' step' + (n === 1 ? '' : 's'); }
      case 'flashcards': { const n = (b.cards || []).length; return n + ' card' + (n === 1 ? '' : 's'); }
      case 'plan': { const n = (b.tracks || []).length; return n + ' track' + (n === 1 ? '' : 's'); }
      case 'slides': { const n = (b.slides || []).length; return n + ' slide' + (n === 1 ? '' : 's'); }
      case 'doc': { const n = (b.blocks || []).length; return n + ' section' + (n === 1 ? '' : 's'); }
      default: return '';
    }
  }

  // ── a labelled fallback card (empty object, or a type this build can't draw) ──
  function card(env) {
    const label = LABELS[(env && env.type)] || (env && env.type) || 'object';
    const sum = summary(env);
    return '<div class="lo-r-card" style="text-align:center;border:1px solid currentColor;border-radius:.5em;padding:.9em 1.1em;display:inline-block">' +
      '<div style="font-size:.62em;opacity:.7;letter-spacing:.04em">◲ ' + esc(label) + '</div>' +
      '<div style="margin-top:.2em">' + esc(titleOf(env)) + '</div>' +
      (sum ? '<div style="font-size:.6em;opacity:.6;margin-top:.15em">' + esc(sum) + '</div>' : '') + '</div>';
  }

  // ── sheet -> a real HTML table of the used range (first sheet), capped ──
  function sheet(body, opts) {
    const sh = (body.sheets && body.sheets[0]) || { cells: {} }; const cells = sh.cells || {}; const parsed = {}; let maxC = 0, maxR = 0, any = false;
    Object.keys(cells).forEach(k => { const m = /^([A-Za-z]+)(\d+)$/.exec(k); if (!m) return; const c = colToIdx(m[1].toUpperCase()), r = parseInt(m[2], 10) - 1; if (c < 0 || r < 0) return; parsed[c + ',' + r] = cells[k]; any = true; if (c > maxC) maxC = c; if (r > maxR) maxR = r; });
    if (!any) return card({ type: 'sheet', body: body });
    const safeCol = s => (typeof s === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/.test(s)) ? s : '';
    const capC = (opts && opts.maxCols) || 8, capR = (opts && opts.maxRows) || 16; const cC = Math.min(maxC, capC - 1), cR = Math.min(maxR, capR - 1);
    let html = '<table class="lo-r-table" style="border-collapse:collapse;width:100%;font-size:.5em;line-height:1.35;font-variant-numeric:tabular-nums">';
    for (let r = 0; r <= cR; r++) {
      html += '<tr>';
      for (let c = 0; c <= cC; c++) {
        const cell = parsed[c + ',' + r]; const v = cell ? (cell.v != null ? cell.v : (cell.f ? ('=' + cell.f) : '')) : '';
        const fmt = (cell && cell.format) || {}; const head = r === 0; const bg = safeCol(fmt.bg), fg = safeCol(fmt.fg);
        const style = 'border:1px solid rgba(128,128,128,.5);padding:.16em .42em;text-align:' + (fmt.align || (typeof v === 'number' ? 'right' : 'left')) + ';' +
          (bg ? ('background:' + bg + ';') : (head ? 'background:rgba(128,128,128,.14);' : '')) + (fg ? ('color:' + fg + ';') : '') +
          ((fmt.bold || head) ? 'font-weight:700;' : '') + (fmt.italic ? 'font-style:italic;' : '');
        html += '<' + (head ? 'th' : 'td') + ' style="' + style + '">' + esc(v) + '</' + (head ? 'th' : 'td') + '>';
      }
      html += '</tr>';
    }
    return html + '</table>';
  }
  function mindmapSVG(body) {
    const placed = (body.nodes || []).filter(n => n && Number.isFinite(n.x) && Number.isFinite(n.y));
    if (placed.length < 1) return '';
    const byId = {}; (body.nodes || []).forEach(n => { byId[n.id] = n; });
    const CMAP = { blue: '#5b87d6', green: '#5d9b48', red: '#cf6655', amber: '#c39a36', purple: '#8a6dc8' };
    const col = n => CMAP[n.color] || ((typeof n.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(n.color)) ? n.color : 'currentColor');
    const sizeOf = n => { const lab = String(n.text == null ? '' : n.text).slice(0, 22); const tw = Math.max(46, Math.min(190, 24 + lab.length * 8.4)), th = 30; if (n.kind === 'circle') { const d = Math.max(tw, th) + 8; return { w: d, h: d }; } if (n.kind === 'triangle') { return { w: tw + 12, h: th + 16 }; } if (n.kind === 'diamond') { return { w: tw + 20, h: th + 22 }; } return { w: tw, h: th }; };
    const bp = (from, to) => { const s = sizeOf(from), hw = s.w / 2 + 3, hh = s.h / 2 + 3, dx = to.x - from.x, dy = to.y - from.y; if (dx === 0 && dy === 0) return { x: from.x, y: from.y }; const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity); return { x: from.x + dx * t, y: from.y + dy * t }; };
    const curve = (a, b) => { const p = bp(a, b), q = bp(b, a); const mx = (p.x + q.x) / 2; return 'M ' + p.x + ' ' + p.y + ' C ' + mx + ' ' + p.y + ', ' + mx + ' ' + q.y + ', ' + q.x + ' ' + q.y; };
    const styleAttrs = st => (st === 'dashed' ? ' stroke-dasharray="6 5"' : '') + ((st === 'arrow' || st === 'arrow2') ? ' marker-end="url(#lr-arw)"' : '') + (st === 'arrow2' ? ' marker-start="url(#lr-arw)"' : '');
    const xs = placed.map(n => n.x), ys = placed.map(n => n.y), pad = 70;
    const minX = Math.min.apply(null, xs) - pad, maxX = Math.max.apply(null, xs) + pad, minY = Math.min.apply(null, ys) - pad, maxY = Math.max.apply(null, ys) + pad;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const marker = '<defs><marker id="lr-arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>';
    const lbl = (a, b, t) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; return '<text x="' + mx + '" y="' + (my - 4) + '" text-anchor="middle" font-size="12" fill="currentColor" fill-opacity="0.75">' + esc(t) + '</text>'; };
    let edges = '';
    (body.nodes || []).forEach(n => { const p = n.parent && byId[n.parent]; if (!(p && Number.isFinite(n.x) && Number.isFinite(p.x))) return; const st = n.linkStyle || 'line'; edges += '<path d="' + curve(p, n) + '" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="2"' + styleAttrs(st) + '/>'; if (n.linkLabel) edges += lbl(p, n, n.linkLabel); });
    (body.edges || []).forEach(e => { const a = byId[e.from], b = byId[e.to]; if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return; const st = e.style || 'line'; edges += '<path d="' + curve(a, b) + '" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="2"' + styleAttrs(st) + '/>'; if (e.label) edges += lbl(a, b, e.label); });
    const shapes = placed.map(n => {
      const label = String(n.text == null ? '' : n.text).slice(0, 22);
      const tw = Math.max(46, Math.min(190, 24 + label.length * 8.4)), th = 30, c = col(n);
      const fillA = ' fill="' + c + '" fill-opacity="0.18" stroke="' + c + '" stroke-opacity="0.78" stroke-width="1.5"';
      const txt = '<text x="' + n.x + '" y="' + (n.y + 4.5) + '" text-anchor="middle" font-size="14" fill="currentColor">' + esc(label) + '</text>';
      if (n.kind === 'circle') { const r = Math.max(tw, th) / 2 + 4; return '<g><circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '"' + fillA + '/>' + txt + '</g>'; }
      if (n.kind === 'triangle') { const hw = tw / 2 + 6, hh = th / 2 + 8, pts = n.x + ',' + (n.y - hh) + ' ' + (n.x + hw) + ',' + (n.y + hh) + ' ' + (n.x - hw) + ',' + (n.y + hh); return '<g><polygon points="' + pts + '"' + fillA + '/><text x="' + n.x + '" y="' + (n.y + hh - 8) + '" text-anchor="middle" font-size="13" fill="currentColor">' + esc(label) + '</text></g>'; }
      if (n.kind === 'diamond') { const hw = tw / 2 + 10, hh = th / 2 + 11, pts = n.x + ',' + (n.y - hh) + ' ' + (n.x + hw) + ',' + n.y + ' ' + n.x + ',' + (n.y + hh) + ' ' + (n.x - hw) + ',' + n.y; return '<g><polygon points="' + pts + '"' + fillA + '/>' + txt + '</g>'; }
      const rx = (n.kind === 'rect') ? 0 : 8;   // rect = sharp corners, default = rounded
      return '<g><rect x="' + (n.x - tw / 2) + '" y="' + (n.y - th / 2) + '" width="' + tw + '" height="' + th + '" rx="' + rx + '"' + fillA + '/>' + txt + '</g>';
    }).join('');
    return '<svg class="lo-r-svg" viewBox="' + minX + ' ' + minY + ' ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">' + marker + edges + shapes + '</svg>';
  }
  function mindmap(body) { const svg = mindmapSVG(body); return svg || card({ type: 'mindmap', body: body }); }

  function runbook(body, opts) {
    const steps = (body.steps || []).slice(0, (opts && opts.maxRows) || 16);
    if (!steps.length) return card({ type: 'runbook', body: body });
    let html = '<ul class="lo-r-list" style="list-style:none;margin:0;padding:0;font-size:.58em;line-height:1.5;text-align:left">';
    steps.forEach(s => { const mark = s.kind === 'note' ? '•' : ((s.done || (s.result && s.result.pass)) ? '☑' : '☐'); html += '<li style="display:flex;gap:.5em"><span>' + mark + '</span><span>' + esc(s.text || '') + '</span></li>'; });
    return html + '</ul>';
  }
  function doc(body, opts) {
    const blocks = (body.blocks || []).slice(0, (opts && opts.maxRows) || 12);
    if (!blocks.length) return card({ type: 'doc', body: body });
    let html = '<div class="lo-r-doc" style="font-size:.55em;line-height:1.4;text-align:left">';
    blocks.forEach(b => { if (b.heading) html += '<div style="font-weight:700;margin:.4em 0 .12em">' + esc(b.heading) + '</div>'; if (b.text) html += '<div style="opacity:.85">' + esc(String(b.text).replace(/[#>*`_]/g, '').slice(0, 220)) + '</div>'; });
    return html + '</div>';
  }
  function plan(body, opts) {
    const tracks = (body.tracks || []).slice(0, (opts && opts.maxRows) || 6);
    if (!tracks.length) return card({ type: 'plan', body: body });
    let html = '<div class="lo-r-plan" style="font-size:.55em;line-height:1.4;text-align:left">';
    tracks.forEach(t => { html += '<div style="font-weight:700;margin-top:.3em">' + esc(t.title || '') + '</div>'; (t.sections || []).slice(0, 3).forEach(sec => { const items = (sec.items || []).slice(0, 4).map(i => esc(i.text || '')).filter(Boolean).join(', '); html += '<div style="opacity:.8">' + esc(sec.name || '') + (items ? ': ' + items : '') + '</div>'; }); });
    return html + '</div>';
  }
  function flashcards(body, opts) {
    const cs = (body.cards || []).slice(0, (opts && opts.maxRows) || 10);
    if (!cs.length) return card({ type: 'flashcards', body: body });
    let html = '<div class="lo-r-cards" style="font-size:.55em;line-height:1.5;text-align:left">';
    cs.forEach(c => { html += '<div><b>' + esc(c.front || '') + '</b> — ' + esc(c.back || '') + '</div>'; });
    return html + '</div>';
  }
  function slides(body, opts) {
    const ss = body.slides || [];
    if (!ss.length) return card({ type: 'slides', body: body });
    let html = '<div class="lo-r-slides" style="font-size:.55em;line-height:1.5;text-align:left">';
    ss.slice(0, (opts && opts.maxRows) || 10).forEach((s, i) => { const tb = (s.blocks || []).find(b => b.role === 'title' || b.type === 'text'); const t = (tb && tb.content) || ('Slide ' + (i + 1)); html += '<div>' + (i + 1) + '. ' + esc(t) + '</div>'; });
    return html + '</div>';
  }

  // Render an envelope's body to a static HTML string. `opts` may cap rows/cols.
  function render(env, opts) {
    env = env || {}; const body = env.body || {};
    switch (env.type) {
      case 'sheet': return sheet(body, opts);
      case 'mindmap': return mindmap(body, opts);
      case 'runbook': return runbook(body, opts);
      case 'doc': return doc(body, opts);
      case 'plan': return plan(body, opts);
      case 'flashcards': return flashcards(body, opts);
      case 'slides': return slides(body, opts);
      default: return card(env);
    }
  }

  return { render, card, summary, titleOf, mindmapSVG, LABELS };
});
