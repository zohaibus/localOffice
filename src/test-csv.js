// Unit tests for the shared CSV adapter (src/csv.js). Pure, no browser.
// Run: node src/test-csv.js
'use strict';
const C = require('./csv.js');
let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── parse: basics ──
check('parses simple rows', eq(C.parse('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]));
check('parses a single field', eq(C.parse('hello'), [['hello']]));
check('empty input -> no rows', eq(C.parse(''), []));
check('preserves empty fields', eq(C.parse('a,,c'), [['a', '', 'c']]));
check('trailing empty field kept', eq(C.parse('a,b,'), [['a', 'b', '']]));
check('leading empty field kept', eq(C.parse(',a'), [['', 'a']]));

// ── parse: line endings ──
check('handles LF', eq(C.parse('a\nb'), [['a'], ['b']]));
check('handles CRLF', eq(C.parse('a\r\nb'), [['a'], ['b']]));
check('handles bare CR', eq(C.parse('a\rb'), [['a'], ['b']]));
check('trailing newline does NOT add a phantom row', eq(C.parse('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]));
check('trailing CRLF does NOT add a phantom row', eq(C.parse('a\r\n'), [['a']]));

// ── parse: quoting (the footguns) ──
check('quoted field with a comma', eq(C.parse('"a,b",c'), [['a,b', 'c']]));
check('quoted field with an embedded newline', eq(C.parse('"line1\nline2",x'), [['line1\nline2', 'x']]));
check('embedded double-quote is un-doubled', eq(C.parse('"she said ""hi""",x'), [['she said "hi"', 'x']]));
check('a field that is only a quoted empty string', eq(C.parse('"",a'), [['', 'a']]));
check('whitespace inside quotes is preserved', eq(C.parse('"  padded  ",x'), [['  padded  ', 'x']]));
check('quoted field followed by newline', eq(C.parse('"a"\n"b"'), [['a'], ['b']]));
check('quoted CRLF inside a field stays intact', eq(C.parse('"a\r\nb"'), [['a\r\nb']]));

// ── parse: misc ──
check('strips a UTF-8 BOM', eq(C.parse('﻿a,b'), [['a', 'b']]));
check('unicode passes through', eq(C.parse('café,日本'), [['café', '日本']]));
check('custom delimiter (tab)', eq(C.parse('a\tb\tc', { delimiter: '\t' }), [['a', 'b', 'c']]));

// ── serialize ──
check('serializes simple rows', C.serialize([['a', 'b'], ['1', '2']], { eol: '\n' }) === 'a,b\n1,2');
check('quotes a field with a comma', C.serialize([['a,b', 'c']]).indexOf('"a,b"') >= 0);
check('quotes a field with a newline', C.serialize([['a\nb']]).indexOf('"a\nb"') >= 0);
check('doubles an embedded quote', C.serialize([['she "said"']]).indexOf('"she ""said"""') >= 0);
check('does NOT quote a plain field', C.serialize([['plain', '42']], { eol: '\n' }) === 'plain,42');
check('coerces numbers/null to strings', C.serialize([[1, null, 2]], { eol: '\n' }) === '1,,2');
check('default EOL is CRLF (RFC-4180)', C.serialize([['a'], ['b']]) === 'a\r\nb');

// ── round-trip (the property that matters) ──
const tricky = [['Name', 'Note', 'Qty'], ['Bolt, M3', 'he said "ok"\nnext line', '12'], ['', 'trailing', '0']];
check('round-trips tricky data exactly (parse(serialize(x)) === x)', eq(C.parse(C.serialize(tricky)), tricky));
check('round-trips with a custom delimiter', eq(C.parse(C.serialize(tricky, { delimiter: ';' }), { delimiter: ';' }), tricky));
check('idempotent: serialize twice is stable', C.serialize(C.parse(C.serialize(tricky))) === C.serialize(tricky));

console.log(`\n\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
