// ════════════════════════════════════════════════════════════════════
// LocalSheets ↔ localoffice/v1 envelope adapter.
//
// Converts the internal workbook `data` (object-keyed sheets, snapshot cells)
// to/from the shared `localoffice/v1` `sheet` envelope (ordered sheets, recipe
// cells). This lives ONLY at the save/load boundary - the engine, Store, undo,
// and structural ops keep their existing in-memory model untouched.
//
// Mapping decisions:
//   • Cells are recipes: formula → { f }, literal → { v: <raw input> }. Cached
//     value/type are NOT stored; they are recomputed on load (deterministic).
//     A cell's `format` (numfmt/bold/…) is preserved as an extension field.
//   • colWidths (by column index) → cols keyed by column LETTER: { A: { w } }.
//   • rowHeights (by row index)   → rows keyed by 1-based row NUMBER: { 1: { h } }.
//   • View state (active sheet, per-sheet selection, theme settings) is
//     disposable → it goes in a sibling `view` block, never in `body`.
//   • Sheet-structural extras LocalSheets owns (merges, tables,
//     conditionalRules, filters) pass through on the sheet object unchanged
//     (forward-compat preserves them; other tools ignore them).
//
// Zero dependencies. Works in Node (require) and the browser (window.SheetEnvelope).
// ════════════════════════════════════════════════════════════════════
'use strict';
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.SheetEnvelope = mod;
})(function () {

  const FORMAT = 'localoffice/v1';
  const APP = 'localsheets@1.2';

  function nowISO() { return new Date().toISOString(); }
  function genId() { return 's' + Math.random().toString(36).slice(2, 10); }
  function uuid() {
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && typeof c.randomUUID === 'function') { try { return c.randomUUID(); } catch (_) {} }
    const a = [];
    for (let i = 0; i < 16; i++) a.push(Math.floor(Math.random() * 256));
    a[6] = (a[6] & 0x0f) | 0x40; a[8] = (a[8] & 0x3f) | 0x80;
    const h = a.map(b => (b + 0x100).toString(16).slice(1));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  function isStrictNumber(v, E) {
    if (E && typeof E.isStrictNumber === 'function') return E.isStrictNumber(v);
    return v !== '' && /^-?\d+(?:\.\d+)?$/.test(String(v));
  }

  // ── cells ──────────────────────────────────────────────────────────
  // What a cell can hold beyond its value: keep this allowlist in sync so the
  // save path never silently drops a shipped per-cell feature. note (comments) and
  // validation (list dropdowns) were being dropped on every round-trip - real data
  // loss. Unknown keys are carried too (forward-compat).
  const KNOWN_CELL = ['raw', 'formula', 'value', 'type', 'format', 'validation', 'note'];
  const KNOWN_CELL_ENV = ['f', 'v', 'format', 'validation', 'note'];
  function cellToEnvelope(cell) {
    const out = cell.formula ? { f: cell.formula } : { v: cell.raw };
    if (cell.format && Object.keys(cell.format).length) out.format = cell.format;
    if (cell.validation != null) out.validation = cell.validation;
    if (cell.note != null) out.note = cell.note;
    for (const k in cell) if (KNOWN_CELL.indexOf(k) === -1) out[k] = cell[k];   // forward-compat
    return out;
  }
  function cellFromEnvelope(c, E) {
    let cell;
    if (c && typeof c.f === 'string') {
      // formula: value/type are placeholders - recalcAll() fills them in.
      cell = { raw: c.f, formula: c.f, value: null, type: 'number' };
    } else {
      const v = (c && c.v != null) ? String(c.v) : '';
      const num = v !== '' && isStrictNumber(v, E);
      cell = { raw: v, value: num ? Number(v) : v, type: num ? 'number' : 'text' };
    }
    if (c && c.format) cell.format = c.format;
    if (c && c.validation != null) cell.validation = c.validation;
    if (c && c.note != null) cell.note = c.note;
    if (c) for (const k in c) if (KNOWN_CELL_ENV.indexOf(k) === -1) cell[k] = c[k];   // forward-compat
    return cell;
  }

  // ── cols / rows ────────────────────────────────────────────────────
  function colsToEnvelope(colWidths, E) {
    const out = {};
    for (const k in colWidths) {
      const name = (E && E.COL_NAMES) ? E.COL_NAMES[+k] : null;
      if (name) out[name] = { w: colWidths[k] };
    }
    return out;
  }
  function colsFromEnvelope(cols, E) {
    const out = {};
    // engine's COL_INDEX is a Map (letter → 0-based index)
    const toIdx = (name) => (E && E.COL_INDEX && typeof E.COL_INDEX.get === 'function')
      ? E.COL_INDEX.get(name)
      : (E && E.COL_NAMES ? E.COL_NAMES.indexOf(name) : -1);
    for (const name in cols) {
      const idx = toIdx(name);
      if (idx != null && idx >= 0) { const c = cols[name]; out[idx] = (c && typeof c === 'object') ? c.w : c; }
    }
    return out;
  }
  function rowsToEnvelope(rowHeights) {
    const out = {};
    for (const k in rowHeights) out[+k + 1] = { h: rowHeights[k] };
    return out;
  }
  function rowsFromEnvelope(rows) {
    const out = {};
    for (const n in rows) { const r = rows[n]; out[+n - 1] = (r && typeof r === 'object') ? r.h : r; }
    return out;
  }

  // ── sheets ─────────────────────────────────────────────────────────
  function sheetToEnvelope(sheet, E) {
    const { cells, colWidths, rowHeights, selR, selC, ...rest } = sheet; // rest = name + merges/tables/conditionalRules/filters/future
    const out = Object.assign({}, rest);
    out.cells = {};
    const cellsObj = (cells && typeof cells === 'object' && !Array.isArray(cells)) ? cells : {};   // guard: malformed cells never crash save
    for (const coord in cellsObj) out.cells[coord] = cellToEnvelope(cellsObj[coord]);
    out.cols = colsToEnvelope(colWidths || {}, E);
    out.rows = rowsToEnvelope(rowHeights || {});
    return out;
  }
  function sheetFromEnvelope(es, E) {
    const { cells, cols, rows, ...rest } = es;
    const sheet = Object.assign({}, rest);
    sheet.cells = {};
    const cellsObj = (cells && typeof cells === 'object' && !Array.isArray(cells)) ? cells : {};   // guard: malformed cells never crash load
    for (const coord in cellsObj) sheet.cells[coord] = cellFromEnvelope(cellsObj[coord], E);
    sheet.colWidths = colsFromEnvelope(cols || {}, E);
    const rh = rowsFromEnvelope(rows || {});
    if (Object.keys(rh).length) sheet.rowHeights = rh;
    sheet.selR = 0; sheet.selC = 0; // restored from the view block by fromEnvelope
    return sheet;
  }

  // ── workbook ───────────────────────────────────────────────────────
  function toEnvelope(data, E, opts) {
    opts = opts || {};
    const order = data.sheetOrder || [];
    return {
      format: FORMAT,
      type: 'sheet',
      meta: {
        id: data._loId || opts.id || uuid(),
        title: (data.meta && data.meta.title) || 'Untitled',
        created: data.created || nowISO(),
        modified: nowISO(),
        app: opts.app || APP,
        tags: (data.meta && data.meta.tags) || []
      },
      body: { sheets: order.map(id => sheetToEnvelope(data.sheets[id], E)) },
      view: {
        active: Math.max(0, order.indexOf(data.activeSheet)),
        selections: order.map(id => ({ r: data.sheets[id].selR || 0, c: data.sheets[id].selC || 0 })),
        settings: data.settings || {}
      }
    };
  }

  // Returns the internal v2.0-shaped `data`. Formula cells are un-evaluated -
  // the caller must run recalcAll() (exactly as loadJSON does today).
  function fromEnvelope(env, E) {
    const arr = (env && env.body && env.body.sheets) || [];
    const ids = arr.map(() => genId());
    const sheets = {};
    arr.forEach((es, i) => { sheets[ids[i]] = sheetFromEnvelope(es, E); });
    if (!ids.length) { const id = genId(); ids.push(id); sheets[id] = { name: 'Sheet1', cells: {}, colWidths: {}, selR: 0, selC: 0 }; }

    const view = (env && env.view) || {};
    (view.selections || []).forEach((sel, i) => {
      if (sheets[ids[i]]) { sheets[ids[i]].selR = (sel && sel.r) || 0; sheets[ids[i]].selC = (sel && sel.c) || 0; }
    });
    const active = (typeof view.active === 'number' && ids[view.active]) ? ids[view.active] : ids[0];

    return {
      version: '2.0',
      tool: 'localsheets',
      _loId: (env && env.meta && env.meta.id) || uuid(),
      meta: { title: (env && env.meta && env.meta.title) || 'Untitled', tags: (env && env.meta && env.meta.tags) || [] },
      created: (env && env.meta && env.meta.created) || nowISO(),
      modified: (env && env.meta && env.meta.modified) || nowISO(),
      sheets,
      sheetOrder: ids,
      activeSheet: active,
      settings: view.settings || { theme: 'auto' }
    };
  }

  // What kind of file is this? Drives the read-both-formats path.
  function detectFormat(obj) {
    if (obj && typeof obj.format === 'string' && obj.format.indexOf('localoffice/') === 0) {
      return obj.type === 'sheet' ? 'envelope' : 'envelope-other';
    }
    if (obj && obj.tool === 'localsheets') {
      const major = parseInt(String(obj.version || '0').split('.')[0], 10);
      if (major === 1) return 'legacy-v1';
      if (major === 2) return 'legacy-v2';
      return 'legacy-unsupported';
    }
    return 'unknown';
  }

  return { FORMAT, APP, toEnvelope, fromEnvelope, detectFormat, cellToEnvelope, cellFromEnvelope, uuid };
});
