/* ════════════════════════════════════════════════════════════════════
   LocalOffice - shared loader/saver core  (localoffice/v1)
   --------------------------------------------------------------------
   The single shared foundation every LocalOffice tool builds on:
     • new / open / save / save-as
     • validate the shared envelope, dispatch on `type`
     • File System Access API with a manual download/upload fallback
     • preserve unknown fields on round-trip (forward-compat)

   No dependencies. No build step. Vanilla JS. The source is the app.
   Works in the browser (window.LocalOffice) and under Node (module.exports)
   so the pure logic can be unit-tested.

   Envelope shape:
     { format:"localoffice/v1",
       type:"sheet|plan|flashcards|mindmap|slides",
       meta:{ id, title, created, modified, app, tags:[] },
       body:{} }
   ════════════════════════════════════════════════════════════════════ */
'use strict';

const FORMAT = 'localoffice/v1';
const FORMAT_PREFIX = 'localoffice/';
const FILE_EXT = '.localoffice.json';

// The body types v1 knows how to produce. Unknown types still LOAD
// (graceful degradation: show title, offer hand-off) - they only warn.
const TYPES = ['sheet', 'plan', 'flashcards', 'mindmap', 'slides', 'image', 'runbook', 'doc'];

// ── small utilities ─────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }

// UUID that works on any context - including file:// where crypto.randomUUID
// and crypto.getRandomValues may be unavailable. Tries the strong sources
// first, falls back to Math.random (fine for a local document id).
function uuid() {
  const c = (typeof crypto !== 'undefined') ? crypto
          : (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto
          : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch (_) { /* fall through */ }
  }
  let rnd;
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    rnd = (i) => b[i];
  } else {
    const arr = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    rnd = (i) => arr[i];
  }
  const h = [];
  for (let i = 0; i < 16; i++) h.push((rnd(i) + 0x100).toString(16).slice(1));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-` +
         `${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Default empty body for each known type. Mirrors the v1 body shapes.
// Unknown types get an empty object.
function freshBody(type) {
  switch (type) {
    case 'sheet':      return { sheets: [] };
    case 'plan':       return { tasks: [] };
    case 'flashcards': return { deck: { name: '' }, scheduler: 'fsrs-lite', cards: [] };
    case 'mindmap':    return { nodes: [], edges: [] };
    case 'slides':     return { theme: {}, slides: [] };
    case 'image':      return { base: '', width: 0, height: 0, overlays: [] };
    default:           return {}; // runbook / doc (v2): minimal until those tools land
  }
}

// ── envelope creation ───────────────────────────────────────────────

/**
 * Build a fresh envelope. Never stamps identifying metadata (author, user,
 * machine) - only id/title/created/modified/app/tags.
 *
 * opts: { title, app, tags, type, body, id }
 */
function createEnvelope(type, opts = {}) {
  if (!TYPES.includes(type)) {
    throw new Error(`createEnvelope: unknown type "${type}"`);
  }
  const ts = nowISO();
  return {
    format: FORMAT,
    type,
    meta: {
      id: opts.id || uuid(),
      title: opts.title || '',
      created: ts,
      modified: ts,
      app: opts.app || '',
      tags: Array.isArray(opts.tags) ? opts.tags.slice() : []
    },
    body: isPlainObject(opts.body) ? opts.body : freshBody(type)
  };
}

// ── validation ──────────────────────────────────────────────────────

// Returns { ok, errors:[], warnings:[], type, formatVersion }.
//  errors   → fatal; the file cannot be treated as an envelope.
//  warnings → loadable but worth surfacing (unknown type, newer format, …).
// Validation never mutates and never strips unknown fields.
function validate(obj) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(obj)) {
    return { ok: false, errors: ['Not a JSON object.'], warnings, type: null, formatVersion: null };
  }

  // format
  let formatVersion = null;
  if (typeof obj.format !== 'string') {
    errors.push('Missing "format" field.');
  } else if (!obj.format.startsWith(FORMAT_PREFIX)) {
    errors.push(`Unrecognized format "${obj.format}" (expected "${FORMAT}").`);
  } else {
    formatVersion = obj.format.slice(FORMAT_PREFIX.length); // e.g. "v1"
    if (obj.format !== FORMAT) {
      warnings.push(`Format "${obj.format}" differs from "${FORMAT}"; reading best-effort.`);
    }
  }

  // type - unknown is a warning, not fatal (graceful degradation)
  if (typeof obj.type !== 'string' || !obj.type) {
    errors.push('Missing "type" field.');
  } else if (!TYPES.includes(obj.type)) {
    warnings.push(`Unknown type "${obj.type}"; this tool can show its title but not render it.`);
  }

  // meta - must be an object; individual fields are filled by normalize()
  if (!isPlainObject(obj.meta)) {
    errors.push('Missing or invalid "meta" object.');
  }

  // body - missing/invalid is recoverable (warn + default {} in normalize)
  if (!isPlainObject(obj.body)) {
    warnings.push('Missing or invalid "body"; treated as empty.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    type: typeof obj.type === 'string' ? obj.type : null,
    formatVersion
  };
}

// Fill in any missing required envelope/meta fields WITHOUT removing unknown
// fields the file already carries (forward-compat). Mutates and returns obj.
function normalize(obj) {
  if (!isPlainObject(obj.meta)) obj.meta = {};
  const m = obj.meta;
  if (typeof m.id !== 'string' || !m.id) m.id = uuid();
  if (typeof m.title !== 'string') m.title = '';
  if (typeof m.created !== 'string') m.created = nowISO();
  if (typeof m.modified !== 'string') m.modified = m.created;
  if (typeof m.app !== 'string') m.app = '';
  if (!Array.isArray(m.tags)) m.tags = [];
  if (!isPlainObject(obj.body)) obj.body = freshBody(obj.type);
  return obj;
}

// ── parse / serialize ───────────────────────────────────────────────

class LoadError extends Error {
  constructor(message, detail) { super(message); this.name = 'LoadError'; this.detail = detail; }
}

/**
 * Parse text → normalized envelope.
 *  opts.coerce(parsedJson) → may return an envelope-shaped object when the
 *    input isn't a localoffice envelope (the seam LocalSheets back-compat
 *    will plug into in step 3). Only invoked when validation fails on
 *    format/type.
 * Throws LoadError on unrecoverable input. Returns { envelope, warnings }.
 */
function parse(text, opts = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new LoadError('File is not valid JSON.', e.message);
  }

  let result = validate(raw);
  let obj = raw;

  if (!result.ok && typeof opts.coerce === 'function') {
    const coerced = opts.coerce(raw);
    if (isPlainObject(coerced)) {
      obj = coerced;
      result = validate(obj);
    }
  }

  if (!result.ok) {
    throw new LoadError('Not a LocalOffice file: ' + result.errors.join(' '), result.errors);
  }

  normalize(obj);
  return { envelope: obj, warnings: result.warnings };
}

// Pure JSON text. Preserves every field (including unknown ones) verbatim.
function stringify(envelope, pretty = true) {
  return JSON.stringify(envelope, null, pretty ? 2 : 0);
}

/**
 * Prepare an envelope for writing: stamp meta.modified, validate, return JSON.
 * Mutates meta.modified in place (real save semantics). Throws if the
 * envelope is structurally invalid.
 */
function serialize(envelope, opts = {}) {
  if (!isPlainObject(envelope)) throw new Error('serialize: not an object');
  const result = validate(envelope);
  if (!result.ok) throw new Error('serialize: invalid envelope - ' + result.errors.join(' '));
  if (opts.touch !== false) {
    if (!isPlainObject(envelope.meta)) envelope.meta = {};
    envelope.meta.modified = nowISO();
  }
  return stringify(envelope, opts.pretty !== false);
}

// ── dispatch on type ────────────────────────────────────────────────

/**
 * Route an envelope to a per-type handler.
 *   handlers: { sheet:fn, plan:fn, …, default:fn }
 * Falls back to handlers.default for unknown/unhandled types (graceful
 * degradation). Throws if neither a matching nor default handler exists.
 */
function dispatch(envelope, handlers = {}) {
  const t = envelope && envelope.type;
  const fn = (t && handlers[t]) || handlers.default;
  if (typeof fn !== 'function') {
    throw new Error(`dispatch: no handler for type "${t}" and no default.`);
  }
  return fn(envelope);
}

// ── suggested filename ──────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function suggestedName(envelope) {
  const base = slugify(envelope && envelope.meta && envelope.meta.title) ||
               (envelope && envelope.type) || 'untitled';
  return base + FILE_EXT;
}

/* ════════════════════════════════════════════════════════════════════
   Browser IO layer - File System Access API + manual fallback.
   Guarded so Node never touches DOM/window. Not unit-tested in Node;
   kept thin so the testable logic above carries the weight.
   ════════════════════════════════════════════════════════════════════ */

function supportsFS() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

// NB: the File System Access API rejects accept-extensions longer than 16
// chars, so we list the real extension '.json' here (not '.localoffice.json',
// which is 17). The compound name still goes in suggestedName on save.
const PICKER_TYPES = [{
  description: 'LocalOffice file',
  accept: { 'application/json': ['.json'] }
}];

// Open a file. Returns { envelope, handle, name, warnings }.
// handle is a FileSystemFileHandle when available (enables in-place save),
// otherwise null (fallback path → save will download).
async function openFile(opts = {}) {
  if (supportsFS()) {
    const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    const file = await handle.getFile();
    const text = await file.text();
    const { envelope, warnings } = parse(text, opts);
    return { envelope, handle, name: file.name, warnings };
  }
  // Fallback: hidden <input type=file>
  const file = await pickFileFallback();
  const text = await file.text();
  const { envelope, warnings } = parse(text, opts);
  return { envelope, handle: null, name: file.name, warnings };
}

function pickFileFallback() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) resolve(f); else reject(new Error('No file selected.'));
    });
    // If the dialog is cancelled there is no reliable event; the promise
    // simply never resolves, which is acceptable for a user-cancelled open.
    document.body.appendChild(input);
    input.click();
  });
}

// Save to an existing handle (in-place). Falls back to download when there
// is no handle or the API is unavailable. Returns { handle, name }.
async function saveFile(envelope, handle, opts = {}) {
  const text = serialize(envelope, opts);
  if (handle && typeof handle.createWritable === 'function') {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { handle, name: handle.name };
  }
  return saveFileAs(envelope, suggestedName(envelope), { ...opts, _text: text });
}

// Save As. Uses the picker when available; otherwise triggers a download.
// Returns { handle, name }.
async function saveFileAs(envelope, suggested, opts = {}) {
  const text = opts._text != null ? opts._text : serialize(envelope, opts);
  const name = suggested || suggestedName(envelope);
  if (supportsFS()) {
    const handle = await window.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { handle, name: handle.name };
  }
  download(text, name);
  return { handle: null, name };
}

// Plain blob download (Firefox/Safari fallback, and any "export" path).
function download(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || ('untitled' + FILE_EXT);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ════════════════════════════════════════════════════════════════════
   EXPORTS
   ════════════════════════════════════════════════════════════════════ */

const LocalOffice = {
  // constants
  FORMAT, FILE_EXT, TYPES,
  // pure logic
  uuid, nowISO, freshBody, createEnvelope, validate, normalize,
  parse, stringify, serialize, dispatch, slugify, suggestedName,
  LoadError,
  // browser IO
  supportsFS, openFile, saveFile, saveFileAs, download
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalOffice;
}
if (typeof window !== 'undefined') {
  window.LocalOffice = LocalOffice;
}
