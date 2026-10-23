// Mandatory check before any test library goes to the owner (owner 23.10.2026): chapter titles look like headings, and on an
// iPhone and an Android every book's first screen is captured and five «Далі» taps really add text. Usage:
//   node tests/check-library.cjs <built library .html> [out-dir]     → exit 1 on any failure; sheet.png = all first screens
const fs = require('fs'), path = require('path'), url = require('url');
const pw = require('playwright');
const { execFileSync } = require('child_process');
const [file, outDir = path.join(path.dirname(path.resolve(file || '.')), 'check')] = process.argv.slice(2);
if (!file) { console.error('usage: node tests/check-library.cjs <library.html> [out-dir]'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
const failures = [];
// A heading is short and is not a sentence of the story (a headless source made the product title a chapter with its first paragraph).
for (const book of data.books) for (const ch of book.chapters) {
  const title = ch.title || '';
  if (title.length > 80 || (title.match(/[.!?…]\s/g) || []).length > 1) failures.push(`${book.title}: chapter ${ch.number} title is not a heading: «${title.slice(0, 60)}…»`);
}
fs.mkdirSync(outDir, { recursive: true });
const chromium = process.env.CHROMIUM_PATH || 'C:/Users/AnD/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
(async () => {
  const shots = [];
  for (const [engine, dev] of [['webkit', 'iPhone 13'], ['chromium', 'Pixel 7']]) {
    const b = await pw[engine].launch(engine === 'chromium' && fs.existsSync(chromium) ? { executablePath: chromium } : {});
    const p = await (await b.newContext({ ...pw.devices[dev] })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    const home = url.pathToFileURL(path.resolve(file)).href;
    await p.goto(home); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1200);
    const cards = await p.locator('[data-book]').count();
    if (cards !== data.books.length) failures.push(`${dev}: library shows ${cards} books, data has ${data.books.length}`);
    for (let n = 0; n < cards; n++) {
      const tag = `${engine}-book${n}`;
      await p.goto(home); await p.waitForTimeout(800);
      await p.locator('[data-book]').nth(n).tap(); await p.waitForTimeout(3000);
      const first = path.join(outDir, `${tag}-first.png`); await p.screenshot({ path: first }); shots.push(first);
      // Standard: the chapter's opening picture is the line right under the chapter title.
      const hasPicture = data.books[n].chapters[0].episodes[0] && Object.values(data.books[n].chapters[0].episodes[0].nodes).some((x) => x.kind === 'image');
      const underTitle = await p.evaluate(() => { const items = [...document.querySelectorAll('#stream > .item')];
        const at = items.findIndex((e) => e.querySelector('.ch-title')); const next = items[at + 1]; return !!(next && next.querySelector('img')); });
      if (hasPicture && !underTitle) failures.push(`${dev} book ${n + 1}: the opening picture is not right under the chapter title`);
      // A tap works when the text on screen changes: new lines, finished typing, or the screen turned to built lines.
      const seen = () => p.evaluate(() => [...document.querySelectorAll('#stream > .item')].filter((e) => {
        const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).map((e) => e.textContent.trim()).join('|'));
      const counts = [await p.$$eval('#stream > .item', (els) => els.length)], views = [await seen()];
      for (let i = 0; i < 5; i++) {
        if (await p.locator('.opt').count()) { await p.locator('.opt').first().tap(); await p.waitForTimeout(1500); }
        if (await p.locator('#go').isEnabled()) await p.locator('#go').tap();
        await p.waitForTimeout(2600);
        counts.push(await p.$$eval('#stream > .item', (els) => els.length)); views.push(await seen());
      }
      await p.screenshot({ path: path.join(outDir, `${tag}-after-taps.png`) });
      const changed = views.slice(1).filter((v, i) => v !== views[i]).length;
      if (changed < 5) failures.push(`${dev} book ${n + 1}: «Далі» changed the screen on ${changed} of 5 taps (items ${counts.join('→')})`);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 0) failures.push(`${dev} book ${n + 1}: page is ${wide}px wider than the screen`);
      console.log(`${dev} book ${n + 1}: items ${counts.join('→')}`);
    }
    if (errors.length) failures.push(`${dev}: page errors: ${errors.slice(0, 3).join(' | ')}`);
    await b.close();
  }
  // One sheet of every first screen, to be looked at before the link is sent.
  execFileSync('python', ['-c', `import sys
from PIL import Image
ims=[Image.open(f).convert('RGB') for f in sys.argv[2:]]
ims=[i.resize((int(i.width*720/i.height),720)) for i in ims]
s=Image.new('RGB',(sum(i.width for i in ims)+10*len(ims),720),'white'); x=0
for i in ims: s.paste(i,(x,0)); x+=i.width+10
s.save(sys.argv[1],quality=75)`, path.join(outDir, 'sheet.jpg'), ...shots]);
  console.log('first screens:', path.join(outDir, 'sheet.jpg'));
  if (failures.length) { console.log('CHECK FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('CHECK PASSED: headings, first screens captured, taps add text, no overflow, no page errors');
})().catch((e) => { console.error(e); process.exit(1); });
