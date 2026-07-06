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
  check('default deck theme is light "daylight" (not gloomy)', await page.evaluate(() => { const t = defaultTheme(); return t.preset === 'daylight' && String(t.bg).toLowerCase() === '#f7f8fa'; }));
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

  // ── JSON panel: the "build slides with any LLM" prompt toggle ──
  check('JSON panel has a Prompt toggle with the slides schema, then returns to JSON', await page.evaluate(() => {
    newDeck();
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JSON'); btn.click();
    const jp = document.getElementById('jp'), ta = jp.querySelector('textarea'), pb = jp.querySelector('[data-a="prompt"]');
    if (!pb || pb.hidden) return false;
    pb.click();
    const shown = ta.value.includes('localoffice/v1') && ta.value.includes('"type": "slides"') && /layout/.test(ta.value) && ta.value.includes('<describe the deck you want');
    pb.click();
    const back = ta.value.includes('"format"') && !ta.value.includes('<describe');
    return shown && back;
  }));

  // ── the schema the prompt asks for (layout + role + content) MUST actually
  //    render, or the prompt is useless. Apply an LLM-shaped deck and verify. ──
  check('a schema-shaped deck (layout + role + content) applies and renders', await page.evaluate(() => {
    const env = { format: 'localoffice/v1', type: 'slides', meta: { title: 'Gen Deck' }, body: { slides: [
      { id: 's1', layout: 'title', blocks: [{ role: 'title', content: 'Rollout Plan' }, { role: 'subtitle', content: 'Q3' }] },
      { id: 's2', layout: 'bullets', blocks: [{ role: 'title', content: 'Steps' }, { role: 'body', content: 'Build\nCanary\nFull rollout' }] },
      { id: 's3', layout: 'table', blocks: [{ role: 'title', content: 'Owners' }, { role: 'table', content: 'Task | Owner\nBuild | Priya\nDeploy | Lena' }] } ] } };
    applyOpenedDeck(env, null);
    const b = slides()[1].blocks.find(x => x.role === 'body');
    const t = slides()[2].blocks.find(x => x.role === 'table');
    return slides().length === 3 && deck.meta.title === 'Gen Deck' && b && /Canary/.test(b.content) && t && /Owner/.test(t.content) && slides()[0].layout === 'title';
  }));

  // ── in-app "New deck" mode: generate a whole deck via local Ollama (mocked) → preview → apply ──
  check('AI New-deck mode drafts a deck and applies it', await page.evaluate(async () => {
    window.fetch = async (url) => {
      url = String(url);
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }] }) };
      if (url.endsWith('/api/generate')) return { ok: true, json: async () => ({ response: JSON.stringify({ format: 'localoffice/v1', type: 'slides', meta: { title: 'AI Deck' }, body: { slides: [
        { id: 's1', layout: 'title', blocks: [{ role: 'title', content: 'Vision' }, { role: 'subtitle', content: '2026' }] },
        { id: 's2', layout: 'bullets', blocks: [{ role: 'title', content: 'Now' }, { role: 'body', content: 'Ship\nMeasure' }] } ] } }) }) };
      return { ok: false, status: 404 };
    };
    await AI.detect();
    document.querySelector('input[name="ai-mode"][value="deck"]').checked = true;
    document.getElementById('ai-model').innerHTML = '<option>llama3.2</option>'; document.getElementById('ai-model').value = 'llama3.2';
    document.getElementById('ai-prompt').value = 'a product vision deck';
    await AI.send();
    const previewShown = !document.getElementById('ai-apply-deck').classList.contains('hidden') && /2 slide/.test(document.getElementById('ai-response').textContent);
    AI.applyDeck();
    const applied = slides().length === 2 && deck.meta.title === 'AI Deck' && slides()[1].blocks.find(b => b.role === 'body').content.includes('Measure');
    return previewShown && applied;
  }));

  check('Embeds host: + Add embeds an object (LocalRender preview) + modal edit; round-trip preserves body.embeds', await page.evaluate(() => {
    EmbedHost.open();
    const sel = document.querySelector('#eh [data-a="add"]'); if (!sel) return false;
    sel.value = 'mindmap'; sel.dispatchEvent(new Event('change'));
    const arr = deck.body.embeds; const added = Array.isArray(arr) && arr.length === 1 && arr[0].envelope.type === 'mindmap';
    const noDrawerIframe = !document.querySelector('#eh iframe');
    const prev = document.querySelector('#eh .eh-prev'); const previewShown = !!prev && prev.innerHTML.length > 0;
    document.querySelector('#eh .eh-edit').click();
    const modalOpen = !!(document.getElementById('eh-editor') && document.getElementById('eh-editor').classList.contains('on'));
    const fr = document.querySelector('#eh-editor .ee-frame');
    const edited = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Sub' }, body: { nodes: [{ id: 'r', text: 'R', parent: null, x: 0, y: 0 }, { id: 'a', text: 'A', parent: 'r', x: 80, y: 40 }], edges: [] } };
    window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'embedState', text: JSON.stringify(edited) }, source: fr.contentWindow }));
    const cached = deck.body.embeds[0].envelope.body.nodes.length === 2;
    const back = LocalOffice.parse(LocalOffice.stringify(deck)).envelope;
    const rt = back.body.embeds && back.body.embeds.length === 1 && back.body.embeds[0].envelope.type === 'mindmap' && back.body.embeds[0].envelope.body.nodes.length === 2;
    const hasBtn = [...document.querySelectorAll('button')].some(b => b.textContent.indexOf('Embeds') >= 0);
    return added && noDrawerIframe && previewShown && modalOpen && cached && rt && hasBtn;
  }));

  // ── inline on-slide embedded objects (embed layout) ──
  check('localDeck: embed layout is registered', await page.evaluate(() => !!LAYOUTS.embed && LAYOUT_ORDER.indexOf('embed') >= 0));
  const inl = await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed');
    const created = !!blk && !!blk.embed && blk.embed.envelope === null;
    blk.embed = { envelope: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Arch' }, body: { nodes: [{ id: 'r', text: 'Root', parent: null, x: 100, y: 100 }, { id: 'a', text: 'A', parent: 'r', x: 200, y: 160 }], edges: [] } } };
    syncBlocks(s);   // re-sync on same layout must PRESERVE the object
    const blk2 = s.blocks.find(b => b.type === 'embed');
    const preserved = !!(blk2.embed && blk2.embed.envelope && blk2.embed.envelope.body.nodes.length === 2);
    const html = blockHTML(blk2, theme(), {});
    const hasSvg = html.indexOf('<svg') >= 0 && html.indexOf('lo-r-svg') >= 0 && html.indexOf('Root') >= 0;
    const exp = blockHTML(blk2, theme(), { export: true });
    const expSvg = exp.indexOf('<svg') >= 0 && exp.indexOf('Root') >= 0;
    const back = LocalOffice.parse(LocalOffice.stringify(deck)).envelope;
    const rtBlk = back.body.slides[0].blocks.find(b => b.type === 'embed');
    const rt = !!(rtBlk && rtBlk.embed && rtBlk.embed.envelope.type === 'mindmap' && rtBlk.embed.envelope.body.nodes.length === 2);
    return { created, preserved, hasSvg, expSvg, rt };
  });
  check('localDeck: choosing the embed layout creates an empty embed block', inl.created);
  check('localDeck: syncBlocks preserves the embedded object across re-sync', inl.preserved);
  check('localDeck: a mind map embeds as a real SVG snapshot on the slide', inl.hasSvg);
  check('localDeck: the on-slide embed snapshot is included in HTML export', inl.expSvg);
  check('localDeck: the embedded object round-trips through save/load', inl.rt);
  check('localDeck: a sheet embeds as a real table on the slide + export (author in sheets, show in deck)', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed');
    blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'Budget' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Bolt' }, B2: { v: 12 } } }] } } };
    const html = blockHTML(blk, theme(), {}), exp = blockHTML(blk, theme(), { export: true });
    return html.indexOf('<table') >= 0 && html.indexOf('Item') >= 0 && html.indexOf('Bolt') >= 0 && html.indexOf('>12<') >= 0 && exp.indexOf('<table') >= 0;
  }));
  check('localDeck: uses the shared LocalRender module', await page.evaluate(() => typeof LocalRender === 'object' && typeof LocalRender.render === 'function'));
  check('localDeck: "double-click to edit" hint is never in the block HTML (present/export safe)', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ cells: { A1: { v: 'x' } } }] } } };
    return blockHTML(blk, theme(), {}).indexOf('double-click') < 0 && blockHTML(blk, theme(), { export: true }).indexOf('double-click') < 0;
  }));
  check('localDeck: the edit hint IS shown in the editor stage (#preview, via CSS only)', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ cells: { A1: { v: 'x' } } }] } } };
    renderAll();
    const t = document.querySelector('#preview .t-embed'); if (!t) return false;
    return String(getComputedStyle(t, '::after').content || '').indexOf('double-click') >= 0;
  }));
  check('localDeck: A+/A− scales an embedded object\'s font size', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ cells: { A1: { v: 'x' } } }] } }, scale: 1.6 };
    return blockHTML(blk, theme(), {}).indexOf('font-size:8.00cqw') >= 0;   // 5cqw * 1.6
  }));
  check('localDeck: embed font scale round-trips through save/load', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ cells: { A1: { v: 'x' } } }] } }, scale: 1.9 };
    const back = LocalOffice.parse(LocalOffice.stringify(deck)).envelope;
    return back.body.slides[0].blocks.find(b => b.type === 'embed').embed.scale === 1.9;
  }));
  check('localDeck: slide counter uses tabular figures', await page.evaluate(() => { const el = document.getElementById('counter'); return !!el && getComputedStyle(el).fontVariantNumeric.indexOf('tabular-nums') >= 0; }));
  const modal = await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: blankEmbedEnvelope('mindmap') };
    openEmbedEditor(blk);
    const host = document.getElementById('embed-editor'); const opened = !!(host && host.classList.contains('on'));
    const fr = host.querySelector('.ee-frame');
    const edited = { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'Edited' }, body: { nodes: [{ id: 'r', text: 'R', parent: null, x: 0, y: 0 }, { id: 'a', text: 'A', parent: 'r', x: 80, y: 40 }, { id: 'b', text: 'B', parent: 'r', x: -80, y: 40 }], edges: [] } };
    window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'embedState', text: JSON.stringify(edited) }, source: fr.contentWindow }));
    const updated = blk.embed.envelope.body.nodes.length === 3 && blk.embed.envelope.meta.title === 'Edited';
    closeEmbedEditor();
    const closed = !host.classList.contains('on');
    return { opened, updated, closed };
  });
  check('localDeck: Edit opens a live editor modal running the real tool', modal.opened);
  check('localDeck: edits in the modal stream back into the slide block (embedState)', modal.updated);
  check('localDeck: closing the editor dismisses the modal', modal.closed);

  check('localDeck: ✦ Prompt teaches embedding (sheet table + mind-map FSM)', await page.evaluate(() =>
    LOCALDECK_PROMPT.indexOf('"embed"') >= 0 && LOCALDECK_PROMPT.toLowerCase().indexOf('sheet') >= 0 && LOCALDECK_PROMPT.toLowerCase().indexOf('finite-state') >= 0));
  check('localDeck: an LLM-authored deck with embed slides applies + renders (sheet table + FSM mind map)', await page.evaluate(() => {
    const env = { format: 'localoffice/v1', type: 'slides', meta: { title: 'Gen' }, body: { theme: {}, footer: {}, slides: [
      { id: 's1', layout: 'title', blocks: [{ role: 'title', content: 'Deck' }, { role: 'subtitle', content: 'x' }] },
      { id: 's2', layout: 'embed', blocks: [{ role: 'title', content: 'Budget' }, { role: 'embed', type: 'embed', embed: { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'Budget' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Bolt' }, B2: { v: 5 } } }] } } } }] },
      { id: 's3', layout: 'embed', blocks: [{ role: 'title', content: 'FSM' }, { role: 'embed', type: 'embed', embed: { envelope: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'FSM' }, body: { nodes: [{ id: 'a', text: 'IDLE', parent: null, x: 0, y: 0 }, { id: 'b', text: 'RUN', parent: null, x: 220, y: 0 }], edges: [{ from: 'a', to: 'b', label: 'go' }] } } } }] }
    ] } };
    applyOpenedDeck(env, null);
    const b2 = deck.body.slides[1].blocks.find(b => b.type === 'embed'), b3 = deck.body.slides[2].blocks.find(b => b.type === 'embed');
    const kept = !!(b2 && b2.embed && b2.embed.envelope.type === 'sheet' && b3 && b3.embed && b3.embed.envelope.type === 'mindmap');
    const h2 = blockHTML(b2, theme(), { export: true }), h3 = blockHTML(b3, theme(), { export: true });
    const rendered = h2.indexOf('<table') >= 0 && h2.indexOf('Item') >= 0 && h2.indexOf('>5<') >= 0 && h3.indexOf('<svg') >= 0 && h3.indexOf('IDLE') >= 0;
    return kept && rendered;
  }));

  // ── embedded objects are VISIBLY rendered in the editor (non-zero geometry) ──
  check('localDeck: an embedded sheet is a visibly-sized table in the editor stage', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'T' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'H' }, A2: { v: 'v' } } }] } } };
    renderAll();
    const t = document.querySelector('#preview .t-embed table'); if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 5 && r.height > 5;
  }));
  check('localDeck: an embedded FSM mind map is a visibly-sized SVG in the editor stage', await page.evaluate(() => {
    deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s);
    const blk = s.blocks.find(b => b.type === 'embed'); blk.embed = { envelope: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'F' }, body: { nodes: [{ id: 'a', text: 'IDLE', parent: null, x: 0, y: 0 }, { id: 'b', text: 'RUN', parent: null, x: 200, y: 0 }], edges: [{ from: 'a', to: 'b' }] } } };
    renderAll();
    const g = document.querySelector('#preview .t-embed svg'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 20 && r.height > 20;
  }));

  // ── EXPORT actually renders: build a deck with embed slides, load the EXPORTED single file in a fresh browser ──
  const fs = require('fs');
  const exportHtml = await page.evaluate(() => {
    deck.body.slides = [
      { id: 's1', layout: 'title', blocks: [{ role: 'title', content: 'Deck' }, { role: 'subtitle', content: 'x' }] },
      { id: 's2', layout: 'embed', blocks: [{ role: 'title', content: 'Budget' }, { role: 'embed', type: 'embed', embed: { envelope: { format: 'localoffice/v1', type: 'sheet', meta: { title: 'Budget' }, body: { sheets: [{ name: 'S', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Bolt' }, B2: { v: 12, format: { bg: '#ffd54f' } } } }] } } } }] },
      { id: 's3', layout: 'embed', blocks: [{ role: 'title', content: 'FSM' }, { role: 'embed', type: 'embed', embed: { envelope: { format: 'localoffice/v1', type: 'mindmap', meta: { title: 'FSM' }, body: { nodes: [{ id: 'a', text: 'IDLE', parent: null, x: 0, y: 0, color: '#3d8bd4' }, { id: 'b', text: 'RUN', parent: null, x: 220, y: 0, kind: 'diamond' }], edges: [{ from: 'a', to: 'b', label: 'go', style: 'arrow' }] } } } }] }
    ];
    deck.body.slides.forEach(syncBlocks); cur = 0; renderAll();
    return buildStandaloneHTML();
  });
  const tmp = path.join(__dirname, '_embed_export_test.html');
  fs.writeFileSync(tmp, exportHtml);
  const ep = await browser.newPage();
  const eErrors = []; ep.on('pageerror', e => eErrors.push(String(e))); ep.on('console', m => { if (m.type() === 'error') eErrors.push(m.text()); });
  const extReq = []; ep.on('request', r => { if (/^https?:/i.test(r.url())) extReq.push(r.url()); });
  await ep.goto('file:///' + tmp.replace(/\\/g, '/'));
  await ep.waitForTimeout(150);
  const exp = await ep.evaluate(() => {
    const slides = [...document.querySelectorAll('.slide')];
    slides.forEach(s => s.classList.remove('show')); slides[1].classList.add('show');
    const table = slides[1].querySelector('.t-embed table'); const tR = table ? table.getBoundingClientRect() : { width: 0, height: 0 };
    const tableText = table ? table.innerText : '';
    slides.forEach(s => s.classList.remove('show')); slides[2].classList.add('show');
    const svg = slides[2].querySelector('.t-embed svg'); const sR = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
    return { nSlides: slides.length, hasTable: !!table, tableVisible: tR.width > 20 && tR.height > 20, tableText, hasSvg: !!svg, svgVisible: sR.width > 20 && sR.height > 20, svgText: svg ? svg.textContent : '' };
  });
  await ep.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  check('export: exported deck has all 3 slides', exp.nSlides === 3);
  check('export: embedded sheet renders as a VISIBLE table in the exported file', exp.hasTable && exp.tableVisible && exp.tableText.indexOf('Bolt') >= 0 && exp.tableText.indexOf('12') >= 0);
  check('export: embedded FSM mind map renders as a VISIBLE svg in the exported file', exp.hasSvg && exp.svgVisible && exp.svgText.indexOf('IDLE') >= 0 && exp.svgText.indexOf('RUN') >= 0);
  check('export: a coloured sheet cell keeps its fill colour in the exported file', exportHtml.indexOf('background:#ffd54f') >= 0);
  check('export: a custom node colour + diamond shape survive into the exported file', exportHtml.indexOf('#3d8bd4') >= 0 && exportHtml.indexOf('<polygon') >= 0);
  check('export: exported deck makes ZERO external network requests (offline, self-contained)', extReq.length === 0);
  check('export: exported deck loads with no console/page errors', eErrors.length === 0);

  // ── live host×child: the deck editor modal boots the REAL tool for several embed types ──
  const bootsInModal = async (type, urlRe, probe) => {
    await page.evaluate((ty) => { deck.body.slides = [blankSlide('embed')]; cur = 0; const s = deck.body.slides[0]; syncBlocks(s); const b = s.blocks.find(x => x.type === 'embed'); b.embed = { envelope: blankEmbedEnvelope(ty) }; openEmbedEditor(b); }, type);
    let ok = false;
    for (let i = 0; i < 26; i++) { const fr = page.frames().find(f => urlRe.test(f.url())); if (fr) { try { ok = await fr.evaluate(probe); } catch (e) {} if (ok) break; } await page.waitForTimeout(150); }
    await page.evaluate(() => { if (typeof closeEmbedEditor === 'function') closeEmbedEditor(); });
    await page.waitForTimeout(60);
    return ok;
  };
  check('localDeck modal boots the real Sheet tool with the object', await bootsInModal('sheet', /localSheets/i, () => typeof Store === 'object' && !!(Store.data && Store.data.sheets)));
  check('localDeck modal boots the real Runbook tool with the object', await bootsInModal('runbook', /localCheck/i, () => typeof data === 'object' && Array.isArray(data.steps) && data.steps.length > 0));
  check('localDeck modal boots the real Plan tool with the object', await bootsInModal('plan', /localPlan/i, () => typeof data === 'object' && Array.isArray(data.tracks) && data.tracks.length > 0));

  // ── cross-embed render matrix: EVERY embeddable type renders visibly + with correct content ──
  const matrix = await page.evaluate(() => {
    const cases = {
      sheet:      { env: { type: 'sheet', body: { sheets: [{ cells: { A1: { v: 'Head1' }, B1: { v: 'Head2' }, A2: { v: 'row' }, B2: { v: 9 } } }] } }, needs: ['<table', 'Head1', '>9<', 'tabular-nums'] },
      mindmap:    { env: { type: 'mindmap', body: { nodes: [{ id: 'a', text: 'Root', parent: null, x: 0, y: 0, color: 'green' }, { id: 'b', text: 'Leaf', parent: 'a', x: 120, y: 60 }], edges: [{ from: 'a', to: 'b', style: 'arrow', label: 'go' }] } }, needs: ['<svg', 'Root', ' C ', 'marker-end', '>go<', '#5d9b48'] },
      runbook:    { env: { type: 'runbook', body: { steps: [{ kind: 'check', text: 'Inspect', done: true }, { kind: 'measure', text: 'Volts' }] } }, needs: ['☑', '☐', 'Inspect'] },
      plan:       { env: { type: 'plan', body: { tracks: [{ title: 'Work', sections: [{ name: 'Now', items: [{ text: 'ship it' }] }] }] } }, needs: ['Work', 'ship it'] },
      flashcards: { env: { type: 'flashcards', body: { cards: [{ front: 'Q1', back: 'A1' }] } }, needs: ['Q1', 'A1'] },
      slides:     { env: { type: 'slides', body: { slides: [{ blocks: [{ role: 'title', content: 'Intro' }] }, { blocks: [{ role: 'title', content: 'Next' }] }] } }, needs: ['1. Intro', '2. Next'] },
      doc:        { env: { type: 'doc', body: { blocks: [{ heading: 'Cause', text: 'the root cause' }] } }, needs: ['Cause', 'the root cause'] },
    };
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:440px;height:320px;font-size:24px;color:#111;z-index:99999';
    document.body.appendChild(host);
    const out = {};
    for (const t in cases) {
      const html = LocalRender.render(cases[t].env);
      host.innerHTML = '<div class="probe" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden">' + html + '</div>';
      const el = host.querySelector('.probe > *');
      const box = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      out[t] = { visible: box.width > 8 && box.height > 8, w: Math.round(box.width), h: Math.round(box.height), contentOk: cases[t].needs.every(n => html.indexOf(n) >= 0) };
    }
    host.remove();
    return out;
  });
  console.log('\n  cross-embed render matrix: ' + JSON.stringify(matrix));
  ['sheet', 'mindmap', 'runbook', 'plan', 'flashcards', 'slides', 'doc'].forEach(t => {
    check('cross-embed render: a ' + t + ' renders visibly with correct content', matrix[t] && matrix[t].visible && matrix[t].contentOk);
  });

  console.log(`\n\n${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('Failures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
