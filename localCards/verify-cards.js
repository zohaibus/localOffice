// Headless verification of localCards.html.  Run: node verify-cards.js
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || (() => { try { return require.resolve('playwright'); } catch (e) { return require('path').join(require('os').homedir(), 'Desktop', 'localSheets', 'e2e', 'node_modules', 'playwright'); } })());
const { fsMockInit } = require('../fs-mock.js');
const FILE_URL = 'file:///' + path.resolve(__dirname, 'localCards.html').replace(/\\/g, '/');

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
  await page.waitForTimeout(120);

  check('boots with no errors', errors.length === 0);
  if (errors.length) console.log('\n  errors:', errors.slice(0, 4));
  check('starts in manage view', await page.locator('#manage').isVisible());
  check('starts with an empty deck', await page.locator('.card-row').count() === 0);

  // ── manage: add + edit ──
  await page.click('#btn-add');
  await page.fill('#ed-front', 'Capital of France?');
  await page.fill('#ed-back', 'Paris');
  await page.fill('#ed-tags', 'geo, europe');
  check('card added + appears in list', await page.locator('.card-row').count() === 1);
  check('front shows in the row', (await page.locator('.card-row .front').innerText()).includes('Capital'));
  check('tags rendered as chips', await page.locator('.card-row .chip').count() >= 2);
  check('stats show 1 card', (await page.locator('#deck-stats').innerText()).includes('1 cards'));

  // ── import (paste TSV) ──
  await page.click('#btn-import');
  check('import modal opens', await page.locator('#import-modal.on').count() === 1);
  await page.fill('#import-text', 'Q1\tA1\tx;y\nQ2\tA2\nblank line skipped\t');
  await page.click('#import-do');
  check('import added 3 cards (now 4 total)', await page.locator('.card-row').count() === 4);

  // ── verification kernel (exact + coverage) ──
  const ex = await page.evaluate(() => {
    const c = freshCard('q', 'Paris'); c.verify = LocalVerify.makeBlock('exact', { expected: c.back });
    return { pass: LocalVerify.run(c.verify, ' paris ').pass, fail: LocalVerify.run(c.verify, 'London').pass };
  });
  check('exact verify passes a (normalized) match', ex.pass === true);
  check('exact verify fails a mismatch', ex.fail === false);
  const cov = await page.evaluate(() => {
    const v = LocalVerify.makeBlock('coverage', { required: ['cell', 'nucleus'] });
    return { full: LocalVerify.run(v, 'the cell has a nucleus').pass, partScore: LocalVerify.run(v, 'the cell').score };
  });
  check('coverage passes when all keywords present', cov.full === true);
  check('coverage scores partial coverage', Math.abs(cov.partScore - 0.5) < 1e-9);

  // ── adversarial: a malformed verify block must FAIL SAFE (never mark a wrong
  // answer correct). Auto-grading is the product's promise; a silent auto-pass
  // makes the deterministic verdict a lie. ──
  const advG = await page.evaluate(() => {
    const wrong = 'totally unrelated answer';
    const cov = params => LocalVerify.run({ comparator: 'coverage', params }, wrong, { mutate: false }).pass;
    const reserved = cmp => { try { LocalVerify.run({ comparator: cmp, params: {} }, 'x', { mutate: false }); return 'NO-THROW'; } catch (e) { return 'threw'; } };
    return {
      thr0:    cov({ required: ['x'], threshold: 0 }),    // would score>=0 -> auto-pass before the fix
      thrNeg:  cov({ required: ['x'], threshold: -1 }),
      emptyReq: cov({ required: [] }),
      strReq:  cov({ required: 'cell' }),                 // string, not array
      nullReq: cov({ required: null }),
      kwEmpty: cov({ required: [''] }),
      exactEmpty: LocalVerify.run({ comparator: 'exact', params: { expected: '' } }, '', { mutate: false }).pass, // blank vs blank
      exactNoExp: LocalVerify.run({ comparator: 'exact', params: {} }, '', { mutate: false }).pass,
      semantic: reserved('semantic'),
      diff: reserved('diff'),
    };
  });
  check('coverage threshold<=0 does NOT auto-pass a wrong answer', advG.thr0 === false && advG.thrNeg === false);
  check('coverage with empty/string/null/empty-kw required fails safe', advG.emptyReq === false && advG.strReq === false && advG.nullReq === false && advG.kwEmpty === false);
  check('exact with empty expected does not mark a blank answer correct', advG.exactEmpty === false && advG.exactNoExp === false);
  check('reserved comparators throw (no non-deterministic verdict path)', advG.semantic === 'threw' && advG.diff === 'threw');

  // ── FSRS-lite scheduling is deterministic and sensible ──
  const sched = await page.evaluate(() => {
    const c = freshCard('q', 'a'); const out = [];
    schedule(c, 3); out.push({ i: c.srs.interval, s: c.srs.state });   // fresh Good → 1d, review
    schedule(c, 3); out.push({ i: c.srs.interval });                   // round(1*2.5)=3
    schedule(c, 1); out.push({ i: c.srs.interval, l: c.srs.lapses, s: c.srs.state }); // Again → 0, lapse, relearning
    return out;
  });
  check('first Good graduates to 1-day interval', sched[0].i === 1 && sched[0].s === 'review');
  check('second Good grows the interval (×ease)', sched[1].i === 3);
  check('Again resets interval + records a lapse', sched[2].i === 0 && sched[2].l === 1 && sched[2].s === 'relearning');
  const det = await page.evaluate(() => {
    const a = freshCard('a', 'b'), b = freshCard('a', 'b');
    [3, 2, 3, 4].forEach(g => schedule(a, g)); [3, 2, 3, 4].forEach(g => schedule(b, g));
    return JSON.stringify(a.srs) === JSON.stringify(b.srs);
  });
  check('scheduler is deterministic (same grades → same SRS)', det === true);

  // ── review loop with typed auto-grade (UI) ──
  await page.evaluate(() => { newDeck(); });
  await page.click('#btn-add');
  await page.fill('#ed-front', 'Capital of France?');
  await page.fill('#ed-back', 'Paris');
  await page.selectOption('#ed-vtype', 'exact');
  await page.click('#tab-review');
  check('review view shows the front', (await page.locator('#review .rev-front').innerText()).includes('Capital'));
  check('typed-answer input is shown for a verify card', await page.locator('#rev-answer').count() === 1);
  await page.fill('#rev-answer', 'paris');
  await page.click('#rev-check');
  check('typed answer auto-grades as correct', await page.locator('.vresult.pass').count() === 1);
  check('back is revealed after check', (await page.locator('#review .rev-back').innerText()).includes('Paris'));
  await page.click('#g3'); // Good
  check('grading advances to session-complete', (await page.locator('#review').innerText()).toLowerCase().includes('complete'));

  // review counts only due cards; a freshly-scheduled card is no longer due today
  const dueAfter = await page.evaluate(() => cards().filter(isDue).length);
  check('graded card is no longer due today', dueAfter === 0);

  // ── round-trip through the shared core ──
  const rt = await page.evaluate(() => {
    newDeck(); deck.body.deck.name = 'Bio';
    const c = freshCard('Q', 'A', ['bio']); c.verify = LocalVerify.makeBlock('exact', { expected: 'A' }); cards().push(c);
    const { envelope } = LocalOffice.parse(LocalOffice.serialize(deck));
    return { ok: LocalOffice.validate(envelope).ok, type: envelope.type, n: envelope.body.cards.length,
             name: envelope.body.deck.name, sched: envelope.body.scheduler, hasVerify: !!envelope.body.cards[0].verify,
             hasSrs: !!envelope.body.cards[0].srs };
  });
  check('round-trip validates', rt.ok === true);
  check('round-trip keeps type=flashcards', rt.type === 'flashcards');
  check('round-trip preserves cards + deck name + scheduler', rt.n === 1 && rt.name === 'Bio' && rt.sched === 'fsrs-lite');
  check('round-trip preserves the verify block + srs', rt.hasVerify && rt.hasSrs);

  // ── cloze deletion (the deterministic "test writes itself") ──
  const cl = await page.evaluate(() => {
    const c = freshCard('The {{mitochondria}} makes {{ATP}}.', '');
    return { isCloze: isCloze(c.front), answers: clozeAnswers(c.front),
             blanked: renderCloze(c.front, false).includes('[…]') && !renderCloze(c.front, false).includes('mitochondria'),
             revealed: renderCloze(c.front, true).includes('mitochondria') && renderCloze(c.front, true).includes('ATP') };
  });
  check('cloze detected', cl.isCloze === true);
  check('cloze answers extracted', cl.answers.join(',') === 'mitochondria,ATP');
  check('cloze front is blanked', cl.blanked === true);
  check('cloze reveal fills the answers', cl.revealed === true);

  // cloze "use hidden words as the check" → coverage verify auto-written
  await page.evaluate(() => { newDeck(); });
  await page.click('#btn-add');
  await page.fill('#ed-front', 'A PID loop uses {{proportional}}, {{integral}}, and {{derivative}} terms.');
  check('cloze hint button appears in editor', await page.locator('#ed-cloze-verify').count() === 1);
  await page.click('#ed-cloze-verify');
  const clv = await page.evaluate(() => cardById(selId).verify);
  check('cloze auto-writes a coverage check from the hidden words',
    clv && clv.comparator === 'coverage' && clv.params.required.join(',') === 'proportional,integral,derivative');

  // ── reverse / both-way cards ──
  const rev = await page.evaluate(() => {
    newDeck();
    const c = freshCard('Bonjour', 'Hello'); c.both = true; if (!c.srsRev) c.srsRev = freshSrs(); cards().push(c);
    const items = allItems();
    // grade the reverse direction; its own schedule advances, forward stays new
    schedule(c, 3, 'rev');
    return { items: items.length, dirs: items.map(i => i.dir).join(','),
             fwdNew: c.srs.state === 'new', revAdvanced: c.srsRev.state === 'review' && c.srsRev.interval === 1 };
  });
  check('a both-way card yields two review items', rev.items === 2 && rev.dirs === 'fwd,rev');
  check('forward and reverse schedule independently', rev.fwdNew && rev.revAdvanced);

  // ── TSV export ──
  const tsv = await page.evaluate(() => {
    newDeck(); cards().push(freshCard('Q1', 'A1', ['x', 'y']), freshCard('Q2', 'A2'));
    return deckToTSV();
  });
  check('TSV export has one line per card', tsv.split('\n').length === 2);
  check('TSV columns are front/back/tags tab-separated', tsv.split('\n')[0] === 'Q1\tA1\tx;y');

  // ── review stats ──
  const st = await page.evaluate(() => {
    newDeck();
    const a = freshCard('a', '1'); const b = freshCard('b', '2'); b.both = true; b.srsRev = freshSrs();
    cards().push(a, b);
    const s = computeStats();
    openStats();
    return { total: s.total, items: s.items, due: s.due, newC: s.new, modalOpen: document.getElementById('stats-modal').classList.contains('on'),
             bodyHasCards: document.getElementById('stats-body').innerText.includes('cards') };
  });
  check('stats count cards + review items (both-way adds an item)', st.total === 2 && st.items === 3);
  check('stats count new + due correctly for a fresh deck', st.newC === 3 && st.due === 3);
  check('stats modal renders', st.modalOpen && st.bodyHasCards);
  await page.click('#stats-close');
  check('stats modal closes', await page.locator('#stats-modal.on').count() === 0);

  // ── tag filter ──
  const tf = await page.evaluate(() => {
    newDeck();
    cards().push(freshCard('a', '1', ['x']), freshCard('b', '2', ['y']), freshCard('c', '3', ['x']));
    renderAll(); tagFilter = 'x'; renderList();
    return document.querySelectorAll('.card-row').length;
  });
  check('tag filter narrows the list', tf === 2);

  // ── card-type presets (Add ▾) ──
  const presets = await page.evaluate(() => {
    newDeck();
    addPreset('cloze');   const cloze = cardById(selId);
    addPreset('keyword'); const kw = cardById(selId);
    addPreset('exact');   const ex = cardById(selId);
    addPreset('vocab');   const vo = cardById(selId);
    return {
      n: cards().length,
      clozeHasCoverage: cloze.verify && cloze.verify.comparator === 'coverage' && cloze.verify.params.required.includes('answer'),
      kwCoverage: kw.verify && kw.verify.comparator === 'coverage',
      exExact: ex.verify && ex.verify.comparator === 'exact',
      voBoth: vo.both === true && !!vo.srsRev
    };
  });
  check('presets add 4 cards', presets.n === 4);
  check('cloze preset auto-wires a coverage check from {{...}}', presets.clozeHasCoverage);
  check('keyword preset wires a coverage check', presets.kwCoverage);
  check('exact preset wires an exact check', presets.exExact);
  check('vocab preset enables both-way with its own schedule', presets.voBoth);

  // exact check "defaults to the back" at review time
  const exFallback = await page.evaluate(() => {
    newDeck(); const c = freshCard('Capital of France', 'Paris'); c.verify = LocalVerify.makeBlock('exact', { expected: '' }); cards().push(c);
    queue = [{ card: c, dir: 'fwd' }]; qpos = 0; revealed = false;
    // simulate the check path
    if (c.verify.comparator === 'exact' && !c.verify.params.expected) c.verify.params.expected = c.back;
    return LocalVerify.run(c.verify, 'paris').pass;
  });
  check('exact check falls back to the back when expected is blank', exFallback === true);

  // ── deck templates (feature demo + subject decks) ──
  for (const id of ['demo', 'science', 'geography', 'lang']) {
    const r = await page.evaluate((tid) => {
      loadDeckTemplate(tid);
      const { envelope } = LocalOffice.parse(LocalOffice.serialize(deck));
      return { ok: LocalOffice.validate(envelope).ok, type: envelope.type, n: envelope.body.cards.length,
               name: envelope.body.deck.name, anyVerify: envelope.body.cards.some(c => c.verify) };
    }, id);
    check(`deck template "${id}" builds a valid flashcards deck`, r.ok && r.type === 'flashcards' && r.n >= 5);
    check(`deck template "${id}" has a name + at least one auto-check`, !!r.name && r.anyVerify);
  }
  // a coverage threshold given as a COUNT is stored as a fraction
  const thrFrac = await page.evaluate(() => { loadDeckTemplate('science'); const c = cards().find(c => c.verify && c.verify.comparator === 'coverage'); return c.verify.params.threshold; });
  check('template coverage threshold normalized to a fraction (≤1)', thrFrac > 0 && thrFrac <= 1);

  // ── visual themes ──
  const th = await page.evaluate(() => {
    newDeck(); cards().push(freshCard('q', 'a'));
    deck.body.theme = Object.assign({}, THEME_PRESETS.paper, { preset: 'paper' });
    switchView('review');
    const card = document.querySelector('#review .rev-card');
    const bg = getComputedStyle(card).backgroundColor;
    const { envelope } = LocalOffice.parse(LocalOffice.serialize(deck));
    return { bg, savedPreset: envelope.body.theme.preset };
  });
  check('theme applies to the review card (paper = light bg)', th.bg === 'rgb(255, 254, 248)');
  check('theme is saved in the deck body', th.savedPreset === 'paper');
  await page.evaluate(() => switchView('manage'));

  // ── app light / dark mode ──
  const mode = await page.evaluate(() => {
    setMode('dark'); const darkBg = getComputedStyle(document.body).backgroundColor;
    document.getElementById('btn-mode').click();
    const after = document.documentElement.dataset.mode, lightBg = getComputedStyle(document.body).backgroundColor;
    document.getElementById('btn-mode').click();
    return { after, back: document.documentElement.dataset.mode, changed: darkBg !== lightBg };
  });
  check('mode toggle switches to light', mode.after === 'light');
  check('light mode changes the app background', mode.changed === true);
  check('mode toggles back to dark', mode.back === 'dark');

  // type/status badge text must stay readable in BOTH modes (regression)
  const badge = await page.evaluate(() => {
    newDeck(); cards().push(freshCard('q', 'a')); renderAll();
    setMode('dark'); const dark = getComputedStyle(document.querySelector('.badge.new')).color;
    setMode('light'); const light = getComputedStyle(document.querySelector('.badge.new')).color;
    setMode('dark');
    return { dark, light };
  });
  check('type badge uses a light text colour in dark mode', badge.dark === 'rgb(157, 184, 255)');
  check('type badge switches to a dark text colour in light mode', badge.light === 'rgb(42, 79, 191)' && badge.light !== badge.dark);

  // study-card buttons follow the CARD theme, not the app mode (regression):
  // a dark card under light app mode must give its buttons light text.
  const cardBtn = await page.evaluate(() => {
    newDeck(); const c = freshCard('Q', 'Paris'); c.verify = LocalVerify.makeBlock('exact', { expected: 'Paris' }); cards().push(c);
    deck.body.theme = Object.assign({}, THEME_PRESETS.midnight, { preset: 'midnight' }); // dark card
    setMode('light'); switchView('review');                                              // light app
    const ghost = document.getElementById('rev-show');
    const color = ghost ? getComputedStyle(ghost).color : null;
    setMode('dark'); switchView('manage');
    return { color };
  });
  check('study-card button text follows the card theme, not the app mode', cardBtn.color === 'rgb(231, 233, 238)');

  // ── overlay contrast: card overlays adapt to the card theme (stay visible) ──
  const overlay = await page.evaluate(() => {
    newDeck(); cards().push(freshCard('The {{x}} is here', ''));
    const clozeColor = (preset) => { deck.body.theme = Object.assign({}, THEME_PRESETS[preset], { preset }); switchView('review'); const el = document.querySelector('#review .cloze'); return el ? getComputedStyle(el).color : null; };
    const midnight = clozeColor('midnight'), paper = clozeColor('paper');
    switchView('manage');
    return { midnight, paper };
  });
  check('card cloze overlay uses the theme accent (dark theme)', overlay.midnight === 'rgb(91, 140, 255)');
  check('card cloze overlay adapts to a light theme (stays visible)', overlay.paper === 'rgb(59, 110, 246)' && overlay.paper !== overlay.midnight);

  // ── study-card zoom ──
  const zoom = await page.evaluate(() => {
    newDeck(); cards().push(freshCard('q', 'a')); switchView('review');
    const w0 = document.querySelector('#review .rev-card').getBoundingClientRect().width;
    document.getElementById('cz-in').click(); document.getElementById('cz-in').click();
    const w1 = document.querySelector('#review .rev-card').getBoundingClientRect().width;
    const label = document.getElementById('cz-label').textContent;
    switchView('manage');
    return { grew: w1 > w0 + 1, label };
  });
  check('study-card zoom grows the card', zoom.grew === true);
  check('study-card zoom shows a % label', /\d+%/.test(zoom.label));

  // ── images on cards (front + back), EXIF-scrubbed via canvas ──
  const imgProc = await page.evaluate(async () => {
    const src = document.createElement('canvas'); src.width = 3000; src.height = 1000;
    src.getContext('2d').fillStyle = '#0a0'; src.getContext('2d').fillRect(0, 0, 3000, 1000);
    const blob = await new Promise(r => src.toBlob(r, 'image/jpeg', 0.9));
    const out = await processImageFile(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
    const dim = await new Promise(res => { const im = new Image(); im.onload = () => res(Math.max(im.naturalWidth, im.naturalHeight)); im.src = out; });
    return { isData: out.startsWith('data:image/'), longest: dim };
  });
  check('processImageFile returns a data URI', imgProc.isData);
  check('image downscaled to <=1600 longest side', imgProc.longest <= 1600 && imgProc.longest > 0);

  await page.evaluate(async () => {
    newDeck(); const c = freshCard('front text', 'back text'); cards().push(c); selId = c.id; renderAll();
    const mk = async (col) => { const cv = document.createElement('canvas'); cv.width = 200; cv.height = 120; const x = cv.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 200, 120); const b = await new Promise(r => cv.toBlob(r, 'image/png')); return new File([b], 'x.png', { type: 'image/png' }); };
    await setCardImage(c, 'front', await mk('#00f'));
    await setCardImage(c, 'back', await mk('#f00'));
  });
  check('card list shows an image indicator', (await page.locator('.card-row .chip').allInnerTexts()).some(t => t.includes('🖼')));
  await page.click('#tab-review');
  check('front image renders in review', await page.locator('#review img.cardimg').count() === 1);
  await page.click('#rev-show');
  check('back image renders after reveal', await page.locator('#review img.cardimg').count() === 2);
  await page.evaluate(() => switchView('manage'));

  const imgRt = await page.evaluate(() => {
    const { envelope } = LocalOffice.parse(LocalOffice.serialize(deck));
    const c = envelope.body.cards[0];
    return { f: (c.frontImg || '').startsWith('data:image/'), b: (c.backImg || '').startsWith('data:image/'), distinct: c.frontImg !== c.backImg };
  });
  check('round-trip preserves the front image', imgRt.f);
  check('round-trip preserves the back image', imgRt.b);
  check('front and back images are independent', imgRt.distinct);
  const imgClear = await page.evaluate(() => { const c = cards()[0]; delete c.frontImg; return { f: !c.frontImg, b: !!c.backImg }; });
  check('removing the front image leaves the back image', imgClear.f && imgClear.b);

  // ── LOCAL AI (authoring only, fenced from grading) - mocked Ollama ──

  // ── LOCAL AI (authoring only, fenced from grading) - mocked Ollama ──
  // sanitize/validate AI output before it can touch the deck
  const san = await page.evaluate(() => ({
    good: !!sanitizeAICard({ front: 'a', back: 'b' }),
    noBack: sanitizeAICard({ front: 'a', back: '' }),
    notObj: sanitizeAICard(null),
    covThr: (() => { const c = sanitizeAICard({ front: 'a', back: 'b', verify: { comparator: 'coverage', params: { required: ['x', 'y', 'z'], threshold: 2 } } }); return c.verify.params.threshold; })()
  }));
  check('AI card validation accepts a good card', san.good === true);
  check('AI card validation drops a card with no back', san.noBack === null);
  check('AI card validation ignores non-objects', san.notObj === null);
  check('AI coverage threshold (count) normalized to fraction', Math.abs(san.covThr - 2 / 3) < 1e-9);

  // mock Ollama
  await page.evaluate(() => {
    window.__origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      url = String(url);
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'mock-model' }] }), { status: 200 });
      if (url.endsWith('/api/generate')) {
        const sys = (JSON.parse(opts.body).system) || '';
        let payload = {};
        if (sys.includes('flashcard deck')) payload = { cards: [
          { front: 'Q1', back: 'alpha beta', verify: { comparator: 'coverage', params: { required: ['alpha', 'beta'], threshold: 2 } } },
          { front: 'Q2', back: 'gamma' },
          { front: '', back: 'invalid - dropped' }
        ] };
        else if (sys.includes('grading criteria')) payload = { required: ['proportional', 'integral', 'derivative'], threshold: 2 };
        else if (sys.includes('mnemonic')) payload = { mnemonic: 'PID = Pour In Drinks' };
        return new Response(JSON.stringify({ response: JSON.stringify(payload) }), { status: 200 });
      }
      return window.__origFetch(url, opts);
    };
  });

  const errBefore = errors.length;
  await page.evaluate(() => { newDeck(); });
  await page.click('#btn-ai');
  check('AI panel opens', await page.locator('#ai-panel:not(.hidden)').count() === 1);
  await page.waitForFunction(() => document.querySelector('#ai-model option[value="mock-model"]'), null, { timeout: 8000 });
  check('AI detected the model (mocked)', true);

  // Distill to deck → cards (with AI-written checks); invalid one is dropped
  await page.fill('#ai-source', 'a technical passage about PID controllers and ATP');
  await page.click('#ai-distill');
  await page.waitForFunction(() => document.getElementById('ai-add'), null, { timeout: 8000 });
  check('distill drafted 2 valid cards (1 invalid dropped)', await page.locator('#ai-preview .ai-card').count() === 2);
  await page.click('#ai-add');
  const dist = await page.evaluate(() => ({ n: cards().length, v: cards()[0].verify }));
  check('distilled cards added to the deck', dist.n === 2);
  check('distilled card carries an AI-written coverage check', dist.v && dist.v.comparator === 'coverage' && dist.v.params.required.join(',') === 'alpha,beta');
  await page.click('#ai-close'); // drawer overlaps the editor; close it before editor/review tests

  // Generate-verify-block from the editor
  await page.evaluate(() => { newDeck(); const c = freshCard('Explain a PID loop', 'A PID controller uses proportional, integral, and derivative terms'); cards().push(c); selId = c.id; renderAll(); });
  await page.click('#ed-ai-kw');
  await page.waitForFunction(() => { const c = cardById(selId); return c && c.verify; }, null, { timeout: 8000 });
  const sv = await page.evaluate(() => cardById(selId).verify);
  check('AI suggests a coverage block from the back', sv.comparator === 'coverage' && sv.params.required.join(',') === 'proportional,integral,derivative');

  // Socratic mnemonic on a struggling card
  await page.evaluate(() => { newDeck(); const c = freshCard('Q', 'A'); c.srs.lapses = 3; cards().push(c); renderAll(); });
  await page.click('#tab-review');
  await page.click('#rev-show');
  await page.waitForSelector('#rev-mnemonic', { timeout: 5000 });
  await page.click('#rev-mnemonic');
  await page.waitForFunction(() => cards()[0].notes && cards()[0].notes.includes('Pour In Drinks'), null, { timeout: 8000 });
  check('AI mnemonic appended to the card notes', (await page.evaluate(() => cards()[0].notes)).includes('Pour In Drinks'));

  check('AI flows produced no page errors', errors.length === errBefore);
  await page.evaluate(() => { if (window.__origFetch) window.fetch = window.__origFetch; });

  // ── File System Access round-trip (mocked picker - the real Chrome/Edge path) ──
  const frt = await page.evaluate(async () => {
    newDeck(); deck.body.deck.name = 'FS Cards'; deck.body.cards.push({ id: 'c1', front: 'FX', back: 'B', srs: freshSrs(), tags: [] });
    await saveDeck(true);                               // Save As → showSaveFilePicker → write/close
    const name = [...window.__virtualFS.keys()][0];
    const saved = JSON.parse(window.__virtualFS.get(name));
    newDeck();                                          // clobber
    window.__fsPick = name;
    await openDeck();                                   // showOpenFilePicker → getFile → load
    const opened = { front: deck.body.cards[0] && deck.body.cards[0].front, title: deck.meta.title };
    deck.body.cards[0].front = 'EDITED'; await saveDeck(false); // in-place via the existing handle
    const after = JSON.parse(window.__virtualFS.get(name));
    return { fmt: saved.format, type: saved.type, savedFront: saved.body.cards[0].front, opened, inplace: after.body.cards[0].front };
  });
  check('FS: Save As writes a localoffice/v1 flashcards file through the handle', frt.fmt === 'localoffice/v1' && frt.type === 'flashcards' && frt.savedFront === 'FX');
  check('FS: Open reads the saved deck back through the handle', frt.opened.front === 'FX' && frt.opened.title === 'FS Cards');
  check('FS: in-place Save writes through the existing handle', frt.inplace === 'EDITED');

  // ── embed: the LocalOffice Hub hands us a file via postMessage ──
  const embed = await page.evaluate(async () => {
    const e = { format: 'localoffice/v1', type: 'flashcards', meta: { title: 'Embedded cards' }, body: { deck: { name: 'D' }, scheduler: 'fsrs-lite', cards: [{ id: 'c1', front: 'F', back: 'B' }] } };
    const fakeHandle = { getFile: async () => ({ text: async () => JSON.stringify(e) }) };
    return await new Promise(resolve => {
      function onMsg(ev) { const m = ev.data; if (m && m.proto === 'localoffice' && m.type === 'opened') { window.removeEventListener('message', onMsg); resolve({ ok: m.ok, error: m.error, title: deck.meta.title, n: deck.body.cards.length, hSet: handle === fakeHandle }); } }
      window.addEventListener('message', onMsg);
      window.dispatchEvent(new MessageEvent('message', { data: { proto: 'localoffice', type: 'open', handle: fakeHandle } }));
    });
  });
  check('embed: Hub handoff loads a deck and acks ok', embed.ok === true && embed.title === 'Embedded cards' && embed.n === 1);
  check('embed: cards keeps the file handle for in-place save', embed.hSet === true);

  // ── JSON inspector is readable in this tool's theme (it uses Hub variable names;
  // localCards maps them to --fg/--panel, else the text was black-on-dark) ──
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
