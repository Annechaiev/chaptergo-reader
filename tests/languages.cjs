// node tests/languages.cjs <phone preview with books in all four languages> [out-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const pw = require('playwright');
const [file, out = 'out'] = process.argv.slice(2);
if (!file) throw new Error('usage: node tests/languages.cjs <preview.html> [out-dir]');
const html = fs.readFileSync(file, 'utf8');
const DATA = /(<script type="application\/json" id="data">)([\s\S]*?)(<\/script>)/;
const books = JSON.parse(html.match(DATA)[2].replace(/<\\\//g, '</')).books;
const copy = {
  uk: ['Бібліотека', 'Читати', 'Далі', 'Зміст', 'Налаштування читання', 'Кінець глави', 'Розділ', 'Цією мовою ще немає книг', 'Пригоди'],
  ru: ['Библиотека', 'Читать', 'Далее', 'Оглавление', 'Настройки чтения', 'Конец главы', 'Глава', 'На этом языке пока нет книг', 'Приключения'],
  en: ['Library', 'Read', 'Next', 'Contents', 'Reading settings', 'End of chapter', 'Chapter', 'No books in this language yet', 'Adventure'],
  es: ['Biblioteca', 'Leer', 'Siguiente', 'Índice', 'Ajustes de lectura', 'Fin del capítulo', 'Capítulo', 'Aún no hay libros en este idioma', 'Aventuras']
};
fs.mkdirSync(out, { recursive: true });
const audit = async (p, language, state) => {
  const issues = await p.evaluate(({ language, uk }) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return !el.closest('[hidden]') && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0 &&
        r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight;
    };
    const bad = [];
    if (document.documentElement.scrollWidth > innerWidth) bad.push('horizontal page overflow');
    for (const el of document.querySelectorAll('button, label, .lbl, .book-tag, .book-action, .book-meta, .ch-kicker, .toast')) {
      if (visible(el) && el.scrollWidth > el.clientWidth) bad.push(`${el.id || el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    // Book titles, names, prose and choice text are book data, not interface copy.
    if (language !== 'uk') for (const el of document.querySelectorAll('#library h1, .book-action, .book-meta, .book-tag, .restart, .top button, #ttlSub, .lbl, .seg button, #autoSw, #toc span, .ch-kicker, .end-mark, .toast, #dock button, #about')) {
      if (!visible(el)) continue;
      if (/[іїєґІЇЄҐ]/u.test(el.textContent) || uk.some((s) => el.textContent.trim() === s)) bad.push(`Ukrainian UI: ${el.textContent.trim().slice(0, 100)}`);
    }
    if (language !== 'uk') for (const el of document.querySelectorAll('[aria-label], [title]')) {
      if (visible(el) && /[іїєґІЇЄҐ]/u.test((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || ''))) bad.push('Ukrainian accessible label');
    }
    return bad;
  }, { language, uk: copy.uk.filter((s) => !['Розділ', 'Пригоди'].includes(s)) });
  assert.deepEqual(issues, [], `${language} ${state}`);
};
const sheet = (destination, shots) => execFileSync('python', ['-c', `import sys
from PIL import Image
ims=[Image.open(f).convert('RGB') for f in sys.argv[2:]]
sheet=Image.new('RGB',(sum(i.width for i in ims),max(i.height for i in ims)),'white')
x=0
for im in ims: sheet.paste(im,(x,0)); x+=im.width
sheet.save(sys.argv[1])`, destination, ...shots]);

(async () => {
  // iPhone-size WebKit and Android-size Chromium, both with real touch events.
  for (const [engine, width, height] of [['webkit', 390, 844], ['chromium', 360, 740]]) {
    const browser = await pw[engine].launch(engine === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    try {
      for (const [language, words] of Object.entries(copy)) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: 'light' });
        const p = await ctx.newPage(), errors = [], shots = [];
        p.on('pageerror', (e) => errors.push(e.message));
        const capture = async (state) => {
          await audit(p, language, state);
          if (width === 390) {
            const shot = path.join(out, `${language}-${state}.png`);
            await p.screenshot({ path: shot, animations: 'disabled' }); shots.push(shot);
          }
        };
        const idle = () => p.waitForFunction(() => document.getElementById('stream').getAttribute('aria-busy') !== 'true');
        await p.goto(pathToFileURL(path.resolve(file)).href);
        await p.evaluate(() => document.fonts.ready);
        assert.equal(await p.locator('#language').inputValue(), 'uk', 'default language');
        await p.locator('#language').selectOption(language);
        assert.equal(await p.locator('html').getAttribute('lang'), language);
        assert.equal(await p.locator('#library h1').textContent(), words[0]);
        const matching = books.map((b, i) => [b, i]).filter(([b]) => (b.lang || 'uk') === language);
        assert.ok(matching.some(([b]) => !b.pending), `${language} needs a preview book`);
        assert.deepEqual(await p.locator('.book-card').evaluateAll((els) => els.map((el) => +el.dataset.book)), matching.map(([, i]) => i), 'language filter and original book indexes');
        assert.equal(await p.locator('.book-action').first().textContent(), words[1]);
        await capture('library');
        await p.reload();
        assert.equal(await p.locator('#language').inputValue(), language, 'persisted language');
        const [book, index] = matching.find(([b]) => !b.pending && b.chapters[0].title.startsWith('Розділ')) || matching.find(([b]) => !b.pending);
        const card = p.locator(`.book-card[data-book="${index}"]`);
        if (book.genres?.includes('Пригоди')) assert.ok((await card.textContent()).includes(words[8]), 'translated genre');
        await card.tap(); await idle();
        assert.equal(await p.locator('#go').textContent(), words[2]);
        if (book.chapters[0].title.startsWith('Розділ')) assert.ok((await p.locator('.ch-kicker').textContent()).startsWith(words[6]), 'translated chapter label');
        await capture('first');
        for (let i = 0; i < 5; i++) {
          const before = await p.locator('#stream').textContent();
          assert.equal(await p.locator('#go').isEnabled(), true);
          await p.locator('#go').tap(); await idle();
          assert.notEqual(await p.locator('#stream').textContent(), before, `tap ${i + 1} adds text`);
          await audit(p, language, `tap ${i + 1}`);
        }
        await p.touchscreen.tap(4, height / 2);
        await p.waitForFunction(() => document.getElementById('top').classList.contains('open'));
        await p.waitForTimeout(250);
        assert.equal((await p.locator('#tocBtn').textContent()).trim(), words[3]);
        await p.locator('#tocBtn').tap();
        assert.equal(await p.locator('#toc').isVisible(), true);
        await capture('menu');
        await p.locator('#setBtn').tap();
        assert.equal(await p.locator('#settings').getAttribute('aria-label'), words[4]);
        await capture('settings');
        await p.touchscreen.tap(width / 2, height * .7);
        await p.locator('#small').tap();
        await p.waitForFunction((end) => document.getElementById('go').textContent === end, words[5]);
        await capture('end');
        assert.equal(await p.locator('#next').isEnabled(), true);
        await p.locator('#small').tap();
        assert.equal(await p.locator('#library').isVisible(), true);
        await audit(p, language, 'resume');
        assert.equal(await p.locator('.restart').count(), 1);
        await p.locator('.restart').tap(); await idle();
        assert.equal(await p.locator('#go').textContent(), words[2], 'restart');
        assert.deepEqual(errors, [], 'page errors');
        if (width === 390) sheet(path.join(out, `sheet-${language}.png`), shots);
        console.log(`PASS ${language} ${width}x${height}: filter, persistence, open, five taps, contents, settings, chapter end, resume, restart, no overflow or Ukrainian UI`);
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
  // Storage may throw on every access. Empty markets and unknown genres still work.
  const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const p = await browser.newPage();
    await p.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } }));
    const fixture = structuredClone(books);
    fixture.forEach((b) => { delete b.lang; b.genres = ['Unlisted genre']; });
    await p.route('https://languages.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html.replace(DATA, (_, a, data, z) => a + JSON.stringify({ books: fixture }).replace(/<\//g, '<\\/') + z) }));
    await p.goto('https://languages.test/');
    assert.equal(await p.locator('#language').inputValue(), 'uk');
    assert.equal(await p.locator('.book-tag').first().textContent(), 'Unlisted genre');
    for (const language of ['ru', 'en', 'es', 'id']) {
      await p.locator('#language').selectOption(language);
      assert.equal(await p.locator('.book-card').count(), 0);
      assert.equal(await p.locator('[role=status]').textContent(), language === 'id' ? 'Belum ada buku dalam bahasa ini' : copy[language][7]);
    }
    await p.locator('#language').selectOption('uk');
    assert.equal(await p.locator('.book-card').count(), books.length);
    console.log('PASS unavailable storage, missing book.lang, empty markets, unknown genre');
  } finally { await browser.close(); }
  console.log('LANGUAGE CHECK PASSED');
})().catch((e) => { console.error(e); process.exitCode = 1; });
