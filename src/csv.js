/* ════════════════════════════════════════════════════════════════════
   LocalOffice - shared CSV adapter (LocalCSV)
   --------------------------------------------------------------------
   One RFC-4180-correct CSV parser + serializer, written once and inlined
   into any tool that speaks CSV (LocalSheets, localCards, localPlan, …),
   so the classic footguns (embedded commas, quotes, and newlines) are
   handled in exactly one tested place rather than hand-rolled per tool.

   RFC 4180 rules honoured:
     - fields separated by the delimiter (default comma); records by CRLF or LF.
     - a field containing the delimiter, a double-quote, or a line break is
       wrapped in double-quotes; an embedded double-quote is doubled ("").
     - surrounding whitespace inside a quoted field is preserved.
     - a leading UTF-8 BOM is stripped on parse.
     - a trailing record terminator does NOT produce a phantom empty row.

   No dependencies. Browser (window.LocalCSV) + Node (module.exports).
   ════════════════════════════════════════════════════════════════════ */
'use strict';
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.LocalCSV = mod;
})(function () {

  // parse(text, opts?) -> array of records, each an array of string fields.
  function parse(text, opts) {
    opts = opts || {};
    const delim = opts.delimiter || ',';
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM
    const rows = []; let row = []; let field = ''; let inQuotes = false, sawField = false;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
          else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"') { inQuotes = true; sawField = true; continue; }
      if (c === delim) { row.push(field); field = ''; sawField = true; continue; }
      if (c === '\r') { if (text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; sawField = false; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; sawField = false; continue; }
      field += c; sawField = true;
    }
    // flush a final unterminated record (a trailing newline leaves nothing pending)
    if (field !== '' || row.length || sawField) { row.push(field); rows.push(row); }
    return rows;
  }

  const needsQuote = (s, delim) => s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0;

  // serialize(rows, opts?) -> CSV string. Quotes a field only when required.
  function serialize(rows, opts) {
    opts = opts || {};
    const delim = opts.delimiter || ',';
    const eol = opts.eol || '\r\n';   // RFC-4180 default; pass {eol:'\n'} for Unix
    return (rows || []).map(row => (row || []).map(f => {
      f = (f == null) ? '' : String(f);
      return needsQuote(f, delim) ? '"' + f.replace(/"/g, '""') + '"' : f;
    }).join(delim)).join(eol);
  }

  return { parse, serialize };
});
