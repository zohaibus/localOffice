// Headless verification of localDeck.html using the Playwright install in
// ../localSheets/e2e. Run: node verify-deck.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');

const FILE_URL = 'file:///' + path.resolve(__dirname, 'localDeck.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; process.stdout.write('.'); } else { fail++; fails.push(name); process.stdout.write('F'); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(fsMockInit);               // in-memory File System Access API
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(FILE_URL);
  await page.waitForTimeout(150);

  check('no page/console errors on load', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));

  // ── basics ──────────────────────────────────────────────
  check('starts with 1 slide', await page.locator('.slide-card').count() === 1);
  await page.fill('#deck-title', 'Field Report');
  await page.fill('[data-role="title"]', 'Quarterly Field Report');
  await page.fill('[data-role="subtitle"]', 'June 2026');
  check('preview shows typed title', (await page.locator('#preview').innerText()).includes('Quarterly Field Report'));

  await page.click('#addslide');
  await page.selectOption('#ins-layout', 'bullets');
  await page.fill('[data-role="title"]', 'Findings');
  await page.fill('[data-role="body"]', 'First point\nSecond point\nThird point');
  check('bullets rendered as <li>', await page.locator('#preview li').count() === 3);

  // ── theme + reorder + dup/del ──────────────────────────
  await page.selectOption('#th-preset', 'paper');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#preview')).backgroundColor);
  check('theme preset applied (light bg)', bg === 'rgb(255, 255, 255)');
  await page.locator('.slide-card').nth(1).locator('[data-op="up"]').click();
  check('reorder moved Findings to position 1', (await page.locator('.slide-card').nth(0).innerText()).includes('Findings'));
  await page.locator('.slide-card').nth(0).locator('[data-op="dup"]').click();
  check('duplicate added a slide (3)', await page.locator('.slide-card').count() === 3);
  await page.locator('.slide-card').nth(0).locator('[data-op="del"]').click();
  check('delete removed a slide (2)', await page.locator('.slide-card').count() === 2);

  // ── CODE block ─────────────────────────────────────────
  await page.click('#addslide');
  await page.selectOption('#ins-layout', 'code');
  await page.fill('[data-role="code"]', 'def f(x):\n    return x*2');
  await page.fill('#code-lang', 'python');
  check('code lines rendered', await page.locator('#preview .cl').count() === 2);
  check('line numbers present', await page.locator('#preview .cg').count() === 2);
  check('language label present', (await page.locator('#preview .clang').innerText()) === 'python');
  await page.uncheck('#code-lines');
  check('line numbers toggle off', await page.locator('#preview .cg').count() === 0);

  // ── IMAGE processing: re-encode + downscale (EXIF-strip is structural) ──
  const imgRes = await page.evaluate(async () => {
    // Build a 3000x1000 source image as a File, run it through processImageFile.
    const src = document.createElement('canvas'); src.width = 3000; src.height = 1000;
    const ctx = src.getContext('2d'); ctx.fillStyle = '#0a0'; ctx.fillRect(0, 0, 3000, 1000);
    const blob = await new Promise(r => src.toBlob(r, 'image/jpeg', 0.9));
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    const out = await processImageFile(file);
    const dim = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.src = out; });
    return { isData: out.startsWith('data:image/'), reencoded: out !== ('data:image/jpeg'), longest: Math.max(dim.w, dim.h), out };
  });
  check('processImageFile returns a data URI', imgRes.isData);
  check('image downscaled to <=1600 longest side', imgRes.longest <= 1600 && imgRes.longest > 0);

  // place an image on a real slide via insertImageFromFile, confirm it renders + exports
  await page.evaluate(async () => {
    const src = document.createElement('canvas'); src.width = 400; src.height = 300;
    src.getContext('2d').fillRect(0, 0, 400, 300);
    const blob = await new Promise(r => src.toBlob(r, 'image/png'));
    await insertImageFromFile(new File([blob], 'p.png', { type: 'image/png' }));
  });
  check('image slide added + <img> renders', await page.locator('#preview img.bimg').count() === 1);

  // ── UNDO / REDO ────────────────────────────────────────
  await page.click('#addslide');
  await page.selectOption('#ins-layout', 'section');
  await page.fill('[data-role="heading"]', 'Conclusion');
  check('heading typed', (await page.locator('#preview').innerText()).includes('Conclusion'));
  await page.click('#btn-undo'); // undo the text edit
  check('undo reverted heading text', !(await page.locator('#preview').innerText()).includes('Conclusion'));
  await page.click('#btn-redo');
  check('redo restored heading text', (await page.locator('#preview').innerText()).includes('Conclusion'));

  // ── SPEAKER NOTES ──────────────────────────────────────
  await page.fill('#ins-notes', 'PRIVATE_TALK_TRACK_42');
  const noteState = await page.evaluate(() => ({
    inFile: LocalOffice.serialize(deck).includes('PRIVATE_TALK_TRACK_42'),
    inExport: buildStandaloneHTML().includes('PRIVATE_TALK_TRACK_42'),
  }));
  check('notes saved in file', noteState.inFile === true);
  check('notes EXCLUDED from HTML export', noteState.inExport === false);

  // ── FOOTER ─────────────────────────────────────────────
  await page.check('#ft-show');
  await page.fill('#ft-text', 'Confidential draft');
  const exp1 = await page.evaluate(() => buildStandaloneHTML());
  check('footer text in export', exp1.includes('Confidential draft'));
  check('slide number in export', /<span>\d+ \/ \d+<\/span>/.test(exp1));

  // ── ROUND-TRIP through shared core ─────────────────────
  const rt = await page.evaluate(() => {
    const text = LocalOffice.serialize(deck);
    const { envelope } = LocalOffice.parse(text);
    return { ok: LocalOffice.validate(envelope).ok, type: envelope.type,
             hasImage: JSON.stringify(envelope.body.slides).includes('data:image/'),
             content: JSON.stringify(envelope.body.slides) };
  });
  check('round-trip validates', rt.ok === true);
  check('round-trip keeps type=slides', rt.type === 'slides');
  check('round-trip preserves image data', rt.hasImage === true);
  check('round-trip preserves code content', rt.content.includes('return x*2'));

  // ── FIREWALL: export carries no identifying metadata, even with an image ──
  const exported = await page.evaluate(() => buildStandaloneHTML());
  const meta = await page.evaluate(() => deck.meta);
  check('export contains slide content', exported.includes('Findings'));
  check('export embeds the image (data URI)', exported.includes('data:image/'));
  check('export does NOT contain meta.id', !exported.includes(meta.id));
  check('export does NOT contain meta.app', !exported.includes('localdeck@'));
  check('export does NOT contain created timestamp', !exported.includes(meta.created));
  // identity tokens only - avoid the CSS keyword "user-select"
  check('export has no author/username/machine strings', !/author|username|\bmachine\b|hostname/i.test(exported));
  check('export is a standalone html doc', exported.startsWith('<!DOCTYPE html>') && exported.includes('</html>'));

  // ── FIREWALL hardening: timestamps, unknown identifying meta keys, notes on any
  // layout / at block level, and the raw envelope must NEVER reach the export. ──
  const fw = await page.evaluate(() => {
    deck.meta.modified = 'MODIFIED_SENTINEL_2099';
    deck.meta.author = 'SENTINEL_AUTHOR';        // unknown identifying meta field
    deck.meta.note = 'SENTINEL_UNKNOWN_META';    // unknown custom meta key
    const s = slide();
    s.notes = 'N_FIRST_SLIDE'; if (s.blocks && s.blocks[0]) s.blocks[0].notes = 'BLOCK_LEVEL_NOTE';
    addSlide(); cur = slides().length - 1; slide().layout = 'code'; syncBlocks(slide());
    slide().notes = 'N_CODE_SLIDE';
    renderAll();
    return buildStandaloneHTML();
  });
  check('export omits meta.modified timestamp', !fw.includes('MODIFIED_SENTINEL_2099'));
  check('export omits unknown identifying meta keys', !/SENTINEL_AUTHOR|SENTINEL_UNKNOWN_META/.test(fw));
  check('export omits notes on any layout (title + code slides)', !fw.includes('N_FIRST_SLIDE') && !fw.includes('N_CODE_SLIDE'));
  check('export omits block-object-level notes', !fw.includes('BLOCK_LEVEL_NOTE'));
  check('export never embeds the raw envelope JSON', !/"format"\s*:\s*"localoffice|"meta"\s*:/.test(fw));

  // image scrub: an imported image's source metadata bytes are dropped (canvas
  // re-encode), not just resized - prove a sentinel appended to a PNG is gone.
  const scrubbed = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 60; c.getContext('2d').fillRect(0, 0, 100, 60);
    const bin = atob(c.toDataURL('image/png').split(',')[1]);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const tag = new TextEncoder().encode('EXIFSENTINEL_GPS');
    const tampered = new Uint8Array(bytes.length + tag.length); tampered.set(bytes); tampered.set(tag, bytes.length);
    const out = await processImageFile(new File([new Blob([tampered], { type: 'image/png' })], 'x.png', { type: 'image/png' }));
    return atob(out.split(',')[1]).includes('EXIFSENTINEL_GPS');
  });
  check('image scrub drops injected source metadata bytes (not just resized)', scrubbed === false);

  // ── FORWARD-COMPAT: unknown block type must not crash the renderer ──
  const fc = await page.evaluate(() => {
    deck.body.slides[0].blocks.push({ type: 'futuristic', role: 'x', content: 'KEEPSAFE', x: 5, y: 5, w: 50, h: 20, style: {} });
    cur = 0; renderAll();
    return { rendered: document.querySelector('#preview').innerText.includes('KEEPSAFE'),
             survives: LocalOffice.stringify(deck).includes('"futuristic"') };
  });
  check('unknown block renders as text (no crash)', fc.rendered === true);
  check('unknown block preserved on round-trip', fc.survives === true);

  // ── TEMPLATES ──────────────────────────────────────────
  for (const id of ['design', 'rca', 'demo', 'field']) {
    const r = await page.evaluate((tid) => {
      loadTemplate(tid);
      const text = LocalOffice.serialize(deck);
      const { envelope } = LocalOffice.parse(text);
      return { ok: LocalOffice.validate(envelope).ok, n: envelope.body.slides.length,
               clean: !buildStandaloneHTML().match(/author|username|\bmachine\b|hostname/i) };
    }, id);
    check(`template "${id}" builds a valid multi-slide deck`, r.ok && r.n >= 5);
    check(`template "${id}" export stays anonymous-clean`, r.clean);
  }

  // ── LOCAL AI panel ─────────────────────────────────────
  // (a) detection is graceful whether or not Ollama is actually running here.
  const errBefore = errors.length;
  await page.click('#btn-ai');
  check('AI panel opens', await page.locator('#ai-panel:not(.hidden)').count() === 1);
  await page.waitForFunction(() => { const t = document.getElementById('ai-status').textContent; return t && t !== '…' && t !== 'Detecting Ollama…'; }, null, { timeout: 8000 }).catch(() => {});
  const aiStatus = await page.locator('#ai-status').innerText();
  check('AI detect resolves without throwing', errors.length === errBefore);
  check('AI detect shows a sensible status', /Ollama|Connected|model/i.test(aiStatus));

  // (b) mock Ollama's REST API to drive the full send → apply path offline.
  await page.evaluate(() => {
    window.__origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      url = String(url);
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'mock-model' }] }), { status: 200 });
      if (url.endsWith('/api/generate')) {
        const payload = JSON.parse(opts.body);
        const isPatch = payload.options && payload.options.temperature === 0;
        const text = isPatch ? '{"heading":"AI Heading"}' : 'Hello from AI';
        const enc = new TextEncoder();
        const stream = new ReadableStream({ start(c) {
          c.enqueue(enc.encode(JSON.stringify({ response: text }) + '\n'));
          c.enqueue(enc.encode(JSON.stringify({ done: true }) + '\n')); c.close();
        }});
        return new Response(stream, { status: 200 });
      }
      return window.__origFetch(url, opts);
    };
  });
  await page.evaluate(async () => { await AI.detect(); });
  check('AI model list populated from /api/tags', await page.locator('#ai-model option[value="mock-model"]').count() === 1);

  // Assist mode → freeform text → add to speaker notes
  await page.click('.slide-card');           // select slide 1
  await page.selectOption('#ai-model', 'mock-model');
  await page.evaluate(() => { document.querySelector('input[name="ai-mode"][value="assist"]').checked = true; });
  await page.fill('#ai-prompt', 'say hi');
  await page.click('#ai-send');
  await page.waitForFunction(() => document.getElementById('ai-status').textContent.startsWith('Done'), null, { timeout: 8000 });
  check('AI assist streamed a response', (await page.locator('#ai-response').innerText()).includes('Hello from AI'));
  await page.click('#ai-insert-notes');
  check('AI response added to speaker notes', (await page.evaluate(() => slide().notes)).includes('Hello from AI'));

  // Draft-slide mode → JSON patch → validate → apply to slide
  await page.selectOption('#ins-layout', 'section');
  await page.evaluate(() => { document.querySelector('input[name="ai-mode"][value="slide"]').checked = true; });
  await page.fill('#ai-prompt', 'draft the heading');
  await page.click('#ai-send');
  await page.waitForFunction(() => !document.getElementById('ai-apply-slide').classList.contains('hidden'), null, { timeout: 8000 });
  check('AI patch parsed + apply button shown', true);
  await page.click('#ai-apply-slide');
  check('AI slide patch applied to heading', (await page.evaluate(() => slide().blocks.find(b => b.role === 'heading').content)) === 'AI Heading');

  // patch validation rejects keys not in the layout
  const badPatch = await page.evaluate(() => AI._validateSlidePatch({ bogusRole: 'x' }).ok);
  check('AI patch validation drops invalid roles', badPatch === false);

  // restore real fetch + close panel
  await page.evaluate(() => { if (window.__origFetch) window.fetch = window.__origFetch; });
  await page.click('#ai-close');
  check('AI panel closes', await page.locator('#ai-panel.hidden').count() === 1);

  // ── regression fixes from real-browser feedback ────────
  // bullets: a leading "- "/"* " marker must not produce a DOUBLE bullet
  await page.click('#addslide');
  await page.selectOption('#ins-layout', 'bullets');
  await page.fill('[data-role="body"]', '- Alpha\n* Beta\n1. Gamma');
  check('bullets strip leading markers (no double bullet)', await page.locator('#preview li').count() === 3);
  check('first bullet text has no leading dash', (await page.locator('#preview li').first().innerText()).trim() === 'Alpha');

  // table block renders a <table> with header + rows
  await page.click('#addslide');
  await page.selectOption('#ins-layout', 'table');
  await page.fill('[data-role="table"]', 'Name | Role\nAda | Eng\nGrace | Eng');
  check('table renders a <table>', await page.locator('#preview table.dt').count() === 1);
  check('table has 2 header cells', await page.locator('#preview table.dt thead th').count() === 2);
  check('table has 4 body cells', await page.locator('#preview table.dt tbody td').count() === 4);
  check('table appears in HTML export', (await page.evaluate(() => buildStandaloneHTML())).includes('<table class="dt"'));

  // thumbnails scope container-query units (scaling fix)
  check('thumbnails establish a size container', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.thumb')).containerType === 'size'));

  // colour picker: an 'input' must NOT rebuild the inspector (which would close
  // the native picker mid-drag). Tag the element, fire input, confirm it survives.
  const colorOk = await page.evaluate(() => {
    const el = document.getElementById('th-bg');
    el.__tag = 'keepme';
    el.value = '#123456';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const same = document.getElementById('th-bg');
    return { survived: same && same.__tag === 'keepme', preset: document.getElementById('th-preset').value,
             bg: getComputedStyle(document.querySelector('#preview')).backgroundColor };
  });
  check('colour input does not rebuild the inspector', colorOk.survived === true);
  check('colour input flips preset to custom', colorOk.preset === 'custom');
  check('colour input updates the preview background', colorOk.bg === 'rgb(18, 52, 86)'); // #123456

  // canvas zoom
  await page.click('#zoom-in');
  check('zoom in raises the level above 100%', (await page.locator('#zoom-label').innerText()) !== '100%');
  const zoomedW = await page.evaluate(() => document.querySelector('.slide-frame').getBoundingClientRect().width);
  await page.click('#zoom-fit');
  check('zoom fit resets to 100%', (await page.locator('#zoom-label').innerText()) === '100%');
  const fitW = await page.evaluate(() => document.querySelector('.slide-frame').getBoundingClientRect().width);
  check('zoom actually changes the preview size', zoomedW > fitW);

  // ── present mode: plain + presenter-with-notes ─────────
  await page.click('.slide-card');           // select slide 1
  await page.click('#btn-present');
  check('present (plain) overlay shows', await page.locator('#present.on').count() === 1);
  check('present (plain) has no side notes', await page.locator('#present.with-notes').count() === 0);
  // regression: the present slide must NOT collapse to zero width (black screen)
  const presentW = await page.evaluate(() => document.getElementById('present-slide').getBoundingClientRect().width);
  check('present slide has real width (not a black screen)', presentW > 200);
  await page.keyboard.press('Escape');
  check('present hides on Esc', await page.locator('#present.on').count() === 0);

  // give the current slide notes, then open presenter-with-notes
  await page.evaluate(() => { slide().notes = 'REMEMBER_THIS_LINE'; });
  await page.click('#btn-present-notes');
  check('presenter view shows the side notes panel', await page.locator('#present.with-notes #present-aside').count() === 1);
  check('presenter view displays the speaker notes', (await page.locator('#present-notes').innerText()).includes('REMEMBER_THIS_LINE'));
  check('presenter view shows a slide counter', /\d+ \/ \d+/.test(await page.locator('#pa-counter').innerText()));
  await page.keyboard.press('Escape');
  check('presenter view hides on Esc', await page.locator('#present.on').count() === 0);

  // ── app light / dark theme (editor chrome; separate from the deck theme) ──
  check('a theme toggle button exists', await page.locator('#btn-theme').count() === 1);
  const themeRes = await page.evaluate(() => {
    const bodyBg = () => getComputedStyle(document.body).backgroundColor;
    const wasLight = document.body.classList.contains('light');
    const bg0 = bodyBg();
    toggleAppTheme();
    const flipped = document.body.classList.contains('light') !== wasLight;
    const bg1 = bodyBg();
    let stored = null; try { stored = localStorage.getItem('localdeck_theme'); } catch (e) {}
    toggleAppTheme(); // restore prior state
    return { flipped, changedBg: bg0 !== bg1, stored, restored: document.body.classList.contains('light') === wasLight };
  });
  check('theme toggle flips the body light/dark class', themeRes.flipped === true);
  check('theme toggle changes the editor chrome background', themeRes.changedBg === true);
  check('theme choice is persisted to localStorage', themeRes.stored === 'light' || themeRes.stored === 'dark');
  check('toggling back restores the prior theme', themeRes.restored === true);

  // ── centered title must not be clipped when it wraps to 2+ lines ──
  const ov = await page.evaluate(() => {
    newDeck();                                  // slide 0 is a Title layout (t-title + t-sub)
    const sNew = slide(); sNew.blocks.find(b => b.role === 'title').content = 'A Fairly Long Incident Postmortem Title That Wraps';
    cur = 0; renderAll();
    const title = document.querySelector('#preview .t-title');
    const sub = document.querySelector('#preview .t-sub');
    return { title: title && getComputedStyle(title).overflow, sub: sub && getComputedStyle(sub).overflow };
  });
  check('centered title overflows its box (not clipped top/bottom)', ov.title === 'visible');
  check('non-centered blocks still clip (overflow hidden)', ov.sub === 'hidden');

  // ── Clipboard Protocol: paste a sheet grid / TSV → table slide; text → bullets ──
  const cd = await page.evaluate(() => ({
    grid: clipToDeckContent({ fragment: { format: 'localoffice/clip-v1', kind: 'grid', grid: [['Name', 'Role'], ['Ada', 'Eng']] }, text: '' }),
    tsv: clipToDeckContent({ fragment: null, text: 'Name\tRole\nAda\tEng' }),
    bullets: clipToDeckContent({ fragment: null, text: 'one\ntwo' }),
    empty: clipToDeckContent({ fragment: null, text: '' }),
  }));
  check('clip grid → table slide content (pipe syntax)', cd.grid.layout === 'table' && /Name \| Role/.test(cd.grid.content));
  check('clip TSV → table slide', cd.tsv.layout === 'table' && /Ada \| Eng/.test(cd.tsv.content));
  check('clip plain lines → bullets slide', cd.bullets.layout === 'bullets' && cd.bullets.content === 'one\ntwo');
  check('empty clip → null (nothing pasted)', cd.empty === null);
  const ip = await page.evaluate(() => {
    newDeck(); const before = slides().length;
    insertPastedContent({ layout: 'table', content: 'A | B\nC | D' });
    const blk = slide().blocks.find(b => b.role === 'table');
    return { added: slides().length - before, content: blk && blk.content };
  });
  check('paste inserts a new slide carrying the content', ip.added === 1 && /A \| B/.test(ip.content));

  // ── File System Access round-trip (mocked picker - the real Chrome/Edge path) ──
  const frt = await page.evaluate(async () => {
    newDeck(); deck.meta.title = 'FS Deck';
    await saveDeck(true);                               // Save As → showSaveFilePicker → write/close
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    newDeck();                                          // clobber
    window.__fsPick = name;
    await openDeck();                                   // showOpenFilePicker → getFile → load
    const openedTitle = deck.meta.title;
    deck.meta.title = 'FS Deck 2'; await saveDeck(false); // in-place via the existing handle
    const after = JSON.parse(window.__virtualFS.get(name));
    return { fmt: saved.format, type: saved.type, openedTitle, inplace: after.meta.title };
  });
  check('FS: Save As writes a localoffice/v1 slides file through the handle', frt.fmt === 'localoffice/v1' && frt.type === 'slides');
  check('FS: Open reads the saved deck back through the handle', frt.openedTitle === 'FS Deck');
  check('FS: in-place Save writes through the existing handle', frt.inplace === 'FS Deck 2');

  // ── embed: the LocalOffice Hub hands us a file via postMessage ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'slides', meta: { title: 'Embedded deck' }, body: { theme: {}, slides: [{ id: 's1', layout: 'title', blocks: [] }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, error: m.error, title: deck.meta.title, slides: slides().length, hSet: handle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a deck and acks ok', embed.ok === true && embed.title === 'Embedded deck' && embed.slides === 1);
  check('embed: deck keeps the file handle for in-place save', embed.hSet === true);

  // ── JSON inspector is readable in this tool's theme (it uses Hub variable names;
  // localDeck maps them to --fg/--panel, else the text was black-on-dark) ──
  const jp = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON');
    if (!btn) return { err: 'no JSON button' };
    btn.click();
    const ta = document.querySelector('#jp textarea'); const cs = getComputedStyle(ta);
    const lum = c => { const m = c.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    return { delta: Math.abs(lum(cs.color) - lum(cs.backgroundColor)) };
  });
  check('JSON inspector text contrasts with its background (theme vars resolve)', jp.delta > 80);

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
