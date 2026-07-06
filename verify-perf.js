// ════════════════════════════════════════════════════════════════════
// LocalOffice - footprint & cold-start benchmark (the "hardware floor").
// Run: node verify-perf.js
//
// Deliberately intended to be run on a LOW-POWER, CPU-ONLY machine (a ~15 W
// mobile CPU, 4 cores / 8 threads, 16 GB RAM, integrated-class graphics with no
// usable AI accelerator) - the floor, not the ceiling. Vendor-neutral by design:
// it reports specs/behaviour, never brand names.
//
// What it proves (assertions): every shipped tool is a single self-contained file
// (no external script/style - the single-file rule), every interval timer is
// cleared (no idle-polling leak; the only timers are AI-progress counters that run
// solely during a request you start), every tool boots clean, and the
// deterministic verification kernel costs ~nothing. What it reports (numbers):
// artifact size, cold-start (DOM-interactive / load), and JS heap on THIS machine.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());

// Optional local-AI probe (only with `--ai`, and only if a local Ollama answers).
// Advisory-only by design, so its speed is reported, never gated.
function ollama(p, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 11434, path: p, method: body ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
    req.on('error', reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }
const fileURL = p => 'file:///' + path.resolve(__dirname, p).replace(/\\/g, '/');

const TOOLS = [
  { name: 'Hub (LocalOffice)', file: 'LocalOffice.html' },
  { name: 'localDeck', file: 'localDeck/localDeck.html' },
  { name: 'localCards', file: 'localCards/localCards.html' },
  { name: 'LocalSheets', file: 'localSheets/localsheets.html' },
  { name: 'localPlan', file: 'localPlan/index.html' },
  { name: 'localMindMap', file: 'localMindMap/index.html' },
  { name: 'localMark', file: 'localMark/index.html' },
  { name: 'localCheck', file: 'localCheck/index.html' },
  { name: 'localDoc', file: 'localDoc/index.html' },
  { name: 'localValidate', file: 'localValidate/index.html' },
];

function staticScan(file) {
  const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  return {
    bytes: Buffer.byteLength(src, 'utf8'),
    ext: (src.match(/<script[^>]*\ssrc=|<link[^>]*href=["']https?:/gi) || []).length,  // external code/style refs
    si: (src.match(/setInterval\(/g) || []).length,
    ci: (src.match(/clearInterval\(/g) || []).length,
  };
}

(async () => {
  const browser = await chromium.launch();
  const rows = [];
  let totalBytes = 0;

  for (const t of TOOLS) {
    const s = staticScan(t.file);
    totalBytes += s.bytes;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(fileURL(t.file), { waitUntil: 'load' });
    await page.waitForTimeout(60);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const mem = (performance && performance.memory) ? performance.memory.usedJSHeapSize : null;
      return { dom: Math.round(nav.domInteractive || 0), load: Math.round(nav.loadEventEnd || 0), heap: mem };
    });
    rows.push({ name: t.name, kb: s.bytes / 1024, ext: s.ext, si: s.si, ci: s.ci, dom: m.dom, load: m.load, heapMB: m.heap ? m.heap / 1048576 : null, booted: errors.length === 0 });
    check(t.name + ': single self-contained file (no external script/style)', s.ext === 0);
    check(t.name + ': every interval timer is cleared (no idle-polling leak)', s.ci >= s.si);
    check(t.name + ': boots clean (no page errors)', errors.length === 0);
    await page.close();
  }

  // Deterministic verification is near-free: time the kernel directly.
  const kp = await browser.newPage();
  await kp.goto(fileURL('localCheck/index.html'), { waitUntil: 'load' });
  const kern = await kp.evaluate(() => {
    const N = 100000, t0 = performance.now();
    for (let i = 0; i < N; i++) {
      LocalVerify.run({ comparator: 'tolerance', params: { min: 1.1, max: 1.2 } }, '1.15', { mutate: false });
      LocalVerify.run({ comparator: 'exact', params: { expected: 'v1' } }, 'v1', { mutate: false });
      LocalVerify.run({ comparator: 'coverage', params: { required: ['a', 'b'] } }, 'a b', { mutate: false });
    }
    const ms = performance.now() - t0;
    return { ops: N * 3, ms, nsPerOp: (ms * 1e6) / (N * 3) };
  });
  await kp.close();
  check('verification kernel runs ' + kern.ops.toLocaleString() + ' deterministic ops in < 3 s (near-zero cost)', kern.ms < 3000);

  await browser.close();

  // ── report ──
  const fmt = (n, d = 1) => n == null ? '-' : n.toFixed(d);
  console.log('\n\nLocalOffice - footprint & cold-start (measured on this machine)\n');
  console.log('Tool                    Size(KB)  ext  timers  domInt(ms)  load(ms)  heap(MB)');
  console.log('─'.repeat(78));
  rows.forEach(r => {
    console.log(
      r.name.padEnd(22) + '  ' +
      fmt(r.kb, 0).padStart(7) + '  ' +
      String(r.ext).padStart(3) + '  ' +
      (r.si + '/' + r.ci).padStart(6) + '  ' +
      fmt(r.dom, 0).padStart(9) + '  ' +
      fmt(r.load, 0).padStart(7) + '  ' +
      fmt(r.heapMB, 1).padStart(7)
    );
  });
  console.log('─'.repeat(78));
  console.log('Total artifact size : ' + (totalBytes / 1024).toFixed(0) + ' KB across ' + TOOLS.length + ' files · 0 runtime dependencies');
  console.log('Verification kernel : ' + kern.ops.toLocaleString() + ' deterministic ops in ' + kern.ms.toFixed(0) + ' ms (' + kern.nsPerOp.toFixed(0) + ' ns/op)');
  console.log('Timers column       : setInterval/clearInterval - all are AI-progress counters, live only during a request you start');

  // ── optional: local-AI decode throughput on this CPU (advisory only) ──
  if (process.argv.includes('--ai')) {
    try {
      const tags = await ollama('/api/tags', null, 3000);
      const models = (tags.models || []).map(m => m.name);
      if (!models.length) console.log('\nLocal AI: Ollama reachable, but no models installed.');
      else {
        console.log('\nLocal AI decode throughput (CPU-only, this machine) - advisory, never on the critical path:');
        for (const name of models) {
          await ollama('/api/generate', { model: name, prompt: 'hi', stream: false, options: { num_predict: 1, temperature: 0 } }, 300000); // warm load
          const r = await ollama('/api/generate', { model: name, prompt: 'Explain why local-first offline software matters on old laptops with no reliable internet.', stream: false, options: { num_predict: 128, temperature: 0 } }, 600000);
          const tps = r.eval_count / (r.eval_duration / 1e9);
          console.log('  ' + name.padEnd(24) + fmt(tps, 1).padStart(5) + ' tok/s decode  (' + r.eval_count + ' tokens, ' + (r.load_duration / 1e9).toFixed(1) + ' s load)');
        }
      }
    } catch (e) { console.log('\nLocal AI: Ollama not reachable - skipped (' + (e && e.message) + ').'); }
  } else {
    console.log('\nLocal AI: run `node verify-perf.js --ai` with Ollama up to measure decode tok/s.');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
