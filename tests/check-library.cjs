// Mandatory check before any test library goes to the owner (owner 23.10.2026): chapter titles look like headings, and on an
// iPhone and an Android every book's first screen is captured and five «Далі» taps really add text. Usage:
//   node tests/check-library.cjs <built library .html> [out-dir] [--matrix]   → exit 1 on any failure; sheet.png = all first screens
//   --matrix adds the ten-screen layout check below (about seven minutes); its pictures and measurements go to <out-dir>/layout/.
const fs = require('fs'), path = require('path'), url = require('url');
const pw = require('playwright');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2), matrix = args.includes('--matrix');
const [file, outDir = path.join(path.dirname(path.resolve(file || '.')), 'check')] = args.filter((a) => a !== '--matrix');
if (!file) { console.error('usage: node tests/check-library.cjs <library.html> [out-dir] [--matrix]'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
const failures = [];
// A heading is short and is not a sentence of the story (a headless source made the product title a chapter with its first paragraph).
for (const book of data.books) for (const ch of book.chapters) {
  const title = ch.title || '';
  if (title.length > 80 || (title.match(/[.!?…]\s/g) || []).length > 1) failures.push(`${book.title}: chapter ${ch.number} title is not a heading: «${title.slice(0, 60)}…»`);
}
fs.mkdirSync(outDir, { recursive: true });
// What is inside (owner 23.10.2026: «Прежде чем присылаешь ссылку на тест читалки, проверяешь адекватность того, что находится
// внутри, по всем доступным зрительно и текстово параметрам»): chapters from 1 with no gap, a picture in every chapter, a portrait
// for every speaker with 5+ lines, and content.txt — every chapter's text in node order — to be read before the link is sent.
const report = [];
for (const book of data.books) {
  const numbers = book.chapters.map((ch) => ch.number);
  if (numbers.some((n, i) => n !== i + 1)) failures.push(`${book.title}: chapters ${numbers.join(',')} do not run from 1 without a gap`);
  const lines = {};
  report.push(`# ${book.title}`);
  for (const ch of book.chapters) {
    const nodes = ch.episodes.flatMap((e) => Object.values(e.nodes));
    const pictures = nodes.filter((n) => n.kind === 'image').length;
    // Iron rule (owner 23.10.2026): every chapter opens with its picture, right under the title.
    if (ch.episodes[0]?.nodes[ch.episodes[0].start]?.kind !== 'image') failures.push(`${book.title}: chapter ${ch.number} does not open with a picture`);
    report.push(`## ${ch.number}. ${ch.title} — ${nodes.length} nodes, ${pictures} pictures`);
    // Owner 24.10.2026: «чтоб не больше 3-5 абзацев описания подряд». The reader's path through the chapter (first option at a choice):
    // pictures, scene lines and captions do not end a run, a part boundary neither; a voice or a choice does.
    let run = 0, longest = 0, steps = 0;
    for (const e of ch.episodes) for (let n = e.nodes[e.start]; n && steps++ < 100000;
      n = e.nodes[n.kind === 'choice' ? n.choices[0]?.targetNodeId : n.nextNodeId]) {
      if (n.kind === 'image' || n.role === 'break' || n.role === 'plate') continue;
      run = n.kind === 'message' && n.speaker === 'narrator' && n.presentation !== 'thought' && n.text ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest > 5) failures.push(`${book.title}: chapter ${ch.number} has ${longest} narration bubbles in a row (law: at most 5)`);
    for (const n of nodes) {
      if (n.speaker && n.speaker !== 'narrator') lines[n.speaker] = (lines[n.speaker] || 0) + 1;
      if (n.kind === 'image') report.push('[picture]');
      else if (n.text) report.push(`${n.speaker && n.speaker !== 'narrator' ? `${n.voiceName || n.speaker}${n.presentation === 'thought' ? ' (thought)' : ''}: ` : ''}${n.text}`);
    }
  }
  // Group and unnamed voices are label-only by design (the reader's name filter); portraits belong to characters.
  for (const [key, count] of Object.entries(lines)) if (count >= 5 && key !== 'system' && key !== 'someone' && !key.startsWith('role:') && !book.speakers?.[key]?.asset)
    failures.push(`${book.title}: ${book.speakers?.[key]?.name || key} speaks ${count} lines and has no portrait`);
}
fs.writeFileSync(path.join(outDir, 'content.txt'), report.join('\n'));
const chromium = process.env.CHROMIUM_PATH || 'C:/Users/AnD/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
// Layout matrix (owner 24.10.2026: «проверить верстку для телефонов разных форматов, размеров экранов, чтобы не плыли тексты, блоки,
// меню выпадайка»), behind --matrix because it takes minutes: on ten screens the library, the book's first screen, five «Далі», the
// menu with each panel scrolled to its end, and the chapter end are measured and captured into layout-sheet.jpg.
const MATRIX = [ // [engine, name, width, height, device scale]
  ['chromium', '320x568', 320, 568, 2], ['chromium', '360x740', 360, 740, 3], ['webkit', '375x667-iPhone-SE', 375, 667, 2],
  ['webkit', '390x844-iPhone-13', 390, 844, 3], ['chromium', '393x852', 393, 852, 2.75], ['chromium', '412x915-Pixel-7', 412, 915, 2.625],
  ['webkit', '430x932', 430, 932, 3], ['chromium', '344x882-Fold', 344, 882, 3], ['webkit', '768x1024-tablet', 768, 1024, 2],
  ['webkit', '844x390-landscape', 844, 390, 3]];
const AUDIT = () => {
  const W = innerWidth, H = innerHeight, bad = [], notes = [];
  const shown = (e) => { if (e.closest('[hidden]')) return false; const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 1 || r.height > 1; }; // a 1px box is screen-reader text
  const fixedOf = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(x).position)) return x; return null; };
  const label = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : ''))
    + (e.textContent.trim() ? ` «${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 32)}»` : '');
  const px = (n) => Math.round(n * 10) / 10;
  const wide = document.documentElement.scrollWidth - W;
  if (wide > 0) bad.push(`page is ${wide}px wider than the screen (horizontal scroll)`);
  const all = [...document.querySelectorAll('body *')].filter(shown);
  const onScreen = (r) => r.bottom > 0 && r.top < H;
  for (const e of all) {
    const r = e.getBoundingClientRect(); if (!onScreen(r)) continue;
    const s = getComputedStyle(e), own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !s.display.startsWith('inline') && e.tagName !== 'svg') {
      const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight;
      if (s.textOverflow === 'ellipsis' && dx > 1) notes.push(`${label(e)} cut with «…» (intended truncation, ${dx}px hidden)`);
      else if ((dx > 1 && s.overflowX !== 'visible') || (dy > 1 && s.overflowY !== 'visible' && !['auto', 'scroll'].includes(s.overflowY))) bad.push(`text clipped in ${label(e)}: ${dx > 1 ? dx + 'px wider' : dy + 'px taller'} than its box`);
      else if (dx > 1 && e.clientWidth > 0) bad.push(`text overflows ${label(e)} by ${dx}px`);
    }
    // Anything the reader must reach lies inside the screen width; a fixed control also inside its height (it cannot be scrolled to).
    if (e.matches('button, a, input, select, [role=switch], summary') || (own && !e.closest('button, a'))) {
      if (r.right > W + 1 || r.left < -1) bad.push(`${label(e)} is off-screen sideways: x ${px(r.left)}..${px(r.right)} of ${W}`);
      else if (fixedOf(e) && (r.bottom > H + 1 || r.top < -1) && !fixedOf(e).matches('.top:not(.open)')) {
        const box = fixedOf(e); const bs = getComputedStyle(box);
        if (!['auto', 'scroll'].includes(bs.overflowY) || box.scrollHeight <= box.clientHeight) bad.push(`${label(e)} in fixed ${label(box).split(' ')[0]} is off-screen: y ${px(r.top)}..${px(r.bottom)} of ${H}, and the box does not scroll`);
      }
    }
  }
  // A fixed panel/menu larger than the screen must scroll.
  for (const e of all) { if (!['fixed', 'absolute'].includes(getComputedStyle(e).position) || !e.matches('nav, section, [role=menu], [role=dialog], .panel, [class*=menu], [class*=drawer], [class*=sheet]')) continue;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e), scrolls = ['auto', 'scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight;
    if ((r.bottom > H + 1 || r.top < -1) && !scrolls) bad.push(`menu ${label(e).split(' ')[0]} is ${px(r.height)}px tall, ends at y ${px(r.bottom)} of ${H}, and does not scroll`);
    if (r.right > W + 1 || r.left < -1) bad.push(`menu ${label(e).split(' ')[0]} spans x ${px(r.left)}..${px(r.right)} of ${W}`);
    for (const b of e.querySelectorAll('button, a')) { if (!shown(b)) continue; const q = b.getBoundingClientRect();
      if (q.right > r.right + 1 || q.left < r.left - 1) bad.push(`menu item ${label(b)} sticks out of ${label(e).split(' ')[0]} sideways`); } }
  // A reading line half under a fixed bar or a hint bubble: a line that starts in the open and runs into the bar's button labels, or
  // a line the bubble covers. Lines wholly behind the dock's solid floor wait for the next tap, and the menu covers text by design.
  const bars = all.filter((e) => getComputedStyle(e).position === 'fixed' && e.matches('header, footer, [class*=dock], [class*=bar], .toast, [role=status], [role=alert]') && !e.matches('.top') && onScreen(e.getBoundingClientRect()));
  const solid = bars.map((b) => b.matches('.dock') ? b.querySelector('.dock-in') || b : b).filter(Boolean);
  for (const t of document.querySelectorAll('#stream > .item, main p, article p')) { if (!shown(t)) continue; const box = t.getBoundingClientRect(); if (!onScreen(box)) continue;
    const cut = +(getComputedStyle(t).clipPath.match(/^inset\(\S+ \S+ ([\d.]+)px/) || [0, 0])[1]; // a line revealed in part shows only its top
    const rows = [], walk = document.createTreeWalker(t, NodeFilter.SHOW_TEXT), range = document.createRange();
    while (walk.nextNode()) if (walk.currentNode.textContent.trim()) { range.selectNodeContents(walk.currentNode); rows.push(...[...range.getClientRects()].filter((q) => q.width > 2 && q.top < box.bottom - cut)); }
    for (const b of solid) { if (b.contains(t) || t.contains(b)) continue; const q = b.getBoundingClientRect(), floor = !b.matches('.toast, [role=status], [role=alert]');
      const labels = []; for (const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); w.nextNode();) if (w.currentNode.textContent.trim()) { range.selectNodeContents(w.currentNode); labels.push(...range.getClientRects()); }
      const meets = (l, a) => Math.min(l.right, a.right) > Math.max(l.left, a.left) && Math.min(l.bottom, a.bottom) - Math.max(l.top, a.top) > 1;
      const hit = rows.filter((l) => (floor ? l.top < q.top - 1 && labels.some((a) => meets(l, a)) : meets(l, q)));
      if (hit.length) bad.push(`reading line of ${label(t)} is ${floor ? 'run into the labels of' : 'covered by'} ${label(b).split(' ')[0]}: line y ${px(hit[0].top)}..${px(hit[0].bottom)}, bar y ${px(q.top)}..${px(q.bottom)}`); } }
  // Buttons of one kind (same class; a card taller than 64px is not a button) have one height; an icon group has one size and sits on its button's line.
  const kinds = {};
  for (const b of all) if (b.matches('button, a[class*=btn], a[class*=button], [role=button]') && b.getBoundingClientRect().height <= 64 && onScreen(b.getBoundingClientRect())) (kinds[b.tagName + '.' + (b.className || '')] ||= []).push(b);
  for (const [k, list] of Object.entries(kinds)) { const hs = list.map((b) => px(b.getBoundingClientRect().height)); if (Math.max(...hs) - Math.min(...hs) > 1)
    bad.push(`buttons ${k} differ in height: ${list.map((b, i) => `${label(b).split('»')[0]}» ${hs[i]}`).join(', ')}`); }
  const icons = {};
  for (const s of all) if (s.tagName === 'svg' && onScreen(s.getBoundingClientRect())) (icons[(s.parentElement.className || s.parentElement.tagName) + ''] ||= []).push(s);
  for (const [k, list] of Object.entries(icons)) { const ws = list.map((s) => px(s.getBoundingClientRect().width)); if (Math.max(...ws) - Math.min(...ws) > 0.5) bad.push(`icons in .${k} differ in size: ${ws.join(', ')}`);
    for (const s of list) { const a = s.getBoundingClientRect(), p = s.parentElement.getBoundingClientRect(), off = (a.top + a.bottom) / 2 - (p.top + p.bottom) / 2;
      if (Math.abs(off) > 1.5) bad.push(`icon in ${label(s.parentElement)} sits ${px(off)}px off its button's middle line`); } }
  // Controls laid out in one row share one middle line.
  for (const row of all) { const s = getComputedStyle(row); if (!(s.display.includes('flex') && !s.flexDirection.startsWith('column') && s.flexWrap === 'nowrap') && !row.matches('.top-row')) continue;
    const kids = [...row.children].filter((c) => shown(c) && c.matches('button, a, .book-nav')); if (kids.length < 2) continue;
    const mids = kids.map((c) => { const r = c.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
    if (Math.max(...mids) - Math.min(...mids) > 2) bad.push(`controls in ${label(row).split(' ')[0]} are not on one line: middles ${mids.map(px).join(', ')}`); }
  return { bad: [...new Set(bad)], notes: [...new Set(notes)] };
};
async function layoutMatrix(home, outDir) {
  const dir = path.join(outDir, 'layout'); fs.mkdirSync(dir, { recursive: true });
  const book = data.books.reduce((best, b, i) => (b.chapters.length > data.books[best].chapters.length ? i : best), 0); // the longest contents
  const rows = [], lines = [];
  for (const [engine, name, width, height, scale] of MATRIX) {
    const b = await pw[engine].launch(engine === 'chromium' && fs.existsSync(chromium) ? { executablePath: chromium } : {});
    const ua = pw.devices[engine === 'webkit' ? (width >= 768 ? 'iPad Mini' : 'iPhone 13') : 'Pixel 7'].userAgent;
    const p = await (await b.newContext({ viewport: { width, height }, screen: { width, height }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, userAgent: ua })).newPage();
    const row = [];
    const state = async (tag) => {
      const shot = path.join(dir, `${name}-${tag}.png`); await p.screenshot({ path: shot, scale: 'css' }); row.push(shot);
      const { bad, notes } = await p.evaluate(AUDIT);
      for (const d of bad) failures.push(`${name} ${tag}: ${d}`);
      lines.push(`${name} ${tag}: ${bad.length ? bad.join(' | ') : 'fine'}${notes.length ? ' (note: ' + notes.join('; ') + ')' : ''} [${shot}]`);
    };
    await p.goto(home); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1200);
    await state('a-library');
    await p.locator('[data-book]').nth(book).tap(); await p.waitForTimeout(3000);
    await state('b-first');
    for (let i = 0; i < 5; i++) {
      if (await p.locator('.opt').count()) { await p.locator('.opt').first().tap(); await p.waitForTimeout(1500); }
      if (await p.locator('#go').isEnabled()) await p.locator('#go').tap();
      await p.waitForTimeout(2600);
    }
    await state('c-after-5-taps');
    await p.touchscreen.tap(4, Math.round(height / 2)); await p.waitForTimeout(600); // a side tap opens the menu
    if (!(await p.locator('#top.open').count())) failures.push(`${name}: a side tap did not open the menu`);
    await state('d-menu');
    for (const [btn, panel] of [['#tocBtn', '#toc'], ['#setBtn', '#settings']]) {
      await p.locator(btn).tap(); await p.waitForTimeout(400);
      await p.locator(panel).evaluate((e) => { e.scrollTop = e.scrollHeight; }); await p.waitForTimeout(200);
      await state(`d-menu-${panel.slice(1)}-end`);
      await p.locator(btn).tap(); await p.waitForTimeout(300);
    }
    await p.touchscreen.tap(Math.round(width / 2), Math.round(height * 0.4)); await p.waitForTimeout(400); // a text tap closes the menu
    await p.locator('#small').tap(); await p.waitForTimeout(1500); // «Показати всю главу» runs the chapter to its end
    const end = await p.evaluate(() => ['small', 'next', 'go'].map((id) => document.getElementById(id).textContent.trim()));
    if (end[2] !== 'Кінець глави') failures.push(`${name}: the chapter end was not reached (button reads «${end[2]}»)`);
    await state('e-chapter-end');
    rows.push(row); await b.close();
  }
  fs.writeFileSync(path.join(dir, 'layout.txt'), lines.join('\n'));
  execFileSync('python', ['-c', `import sys, json
from PIL import Image
rows=json.loads(sys.argv[2]); H=300
ims=[[Image.open(f).convert('RGB') for f in r] for r in rows]
ims=[[i.resize((max(1,int(i.width*H/i.height)),H)) for i in r] for r in ims]
w=max(sum(i.width+8 for i in r) for r in ims); s=Image.new('RGB',(w,(H+8)*len(ims)),'white')
for y,r in enumerate(ims):
  x=0
  for i in r: s.paste(i,(x,y*(H+8))); x+=i.width+8
s.save(sys.argv[1],quality=70)`, path.join(dir, 'layout-sheet.jpg'), JSON.stringify(rows)]);
  console.log('layout matrix:', path.join(dir, 'layout-sheet.jpg'), '| measurements:', path.join(dir, 'layout.txt'));
}
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
  if (matrix) await layoutMatrix(url.pathToFileURL(path.resolve(file)).href, outDir);
  // One sheet of every first screen, to be looked at before the link is sent.
  execFileSync('python', ['-c', `import sys
from PIL import Image
ims=[Image.open(f).convert('RGB') for f in sys.argv[2:]]
ims=[i.resize((int(i.width*720/i.height),720)) for i in ims]
s=Image.new('RGB',(sum(i.width for i in ims)+10*len(ims),720),'white'); x=0
for i in ims: s.paste(i,(x,0)); x+=i.width+10
s.save(sys.argv[1],quality=75)`, path.join(outDir, 'sheet.jpg'), ...shots]);
  console.log('first screens:', path.join(outDir, 'sheet.jpg'), '| text to read:', path.join(outDir, 'content.txt'));
  if (failures.length) { console.log('CHECK FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('CHECK PASSED: chapters from 1, pictures in every chapter, portraits for speakers, headings, first screens, taps add text, no overflow, no page errors' + (matrix ? ', layout holds on ten screens' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
