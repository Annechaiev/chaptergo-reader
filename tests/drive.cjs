// Usage: node drive.cjs <engine> <device> <url> <out.json>
// Drives every reader function with touch taps; records [key, value] observations. Timing keys end in .reveal/.scroll/.typing.
const pw = require('playwright');
const fs = require('fs');
const [engine, dev, url, out] = process.argv.slice(2);
const obs = []; const note = (k, v) => obs.push([k, v]);
const harness = [];
const INIT = () => {
  window.__log = []; window.__scroll = []; window.__typing = []; window.__ptr = [];
  new MutationObserver((ms) => { for (const m of ms) {
    for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('item')) {
      const typing = !!n.querySelector('.typing');
      window.__log.push({ t: performance.now(), cls: n.className, typing, text: (n.querySelector('.bub') || n).textContent.trim().slice(0, 40) });
      if (typing) window.__typing.push({ add: performance.now(), node: n });
    }
    for (const n of m.removedNodes) if (n.nodeType === 1 && n.querySelector && n.querySelector('.typing')) {
      const e = window.__typing.find(x => x.node === n && !x.rm); if (e) e.rm = performance.now();
    }
  } }).observe(document, { childList: true, subtree: true });
  const tick = () => { window.__scroll.push([performance.now(), scrollY]); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  document.addEventListener('pointerup', (e) => window.__ptr.push(e.pointerType), true);
};
(async () => {
  const b = await pw[engine].launch(process.env.CHROMIUM_PATH && engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const D = pw.devices[dev];
  const ctx = await b.newContext({ ...D });
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (f, a) => p.evaluate(f, a);
  const $tap = async (sel, nth = 0) => {
    const l = p.locator(sel); const c = await l.count();
    if (c < 1) { harness.push(`locator ${sel} count=0 (expected >=1)`); throw new Error('harness: ' + sel); }
    const box = await l.nth(nth).boundingBox();
    // A real finger: tap the centre of the box where it is on screen (no scrolling into view).
    const top = await ev(([s, i]) => { const el = document.querySelectorAll(s)[i]; const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, hit: !!h && (h === el || el.contains(h)) }; }, [sel, nth]);
    if (!top.inView || !top.hit) note(`tapTarget.${sel}#${nth}`, top);
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const state = () => ev(() => ({ sub: document.getElementById('ttlSub').textContent, go: document.getElementById('go').textContent, goDisabled: document.getElementById('go').disabled, goPause: document.getElementById('go').classList.contains('pause'),
    small: document.getElementById('small').textContent, next: document.getElementById('next').textContent, nextDisabled: document.getElementById('next').disabled,
    items: document.querySelectorAll('#stream > .item').length, scrollY: Math.round(scrollY), menu: document.getElementById('top').classList.contains('open') }));
  const layout = (tag) => ev(() => {
    const vh = innerHeight, vw = innerWidth, r = (id) => document.getElementById(id)?.getBoundingClientRect();
    const vis = (el) => el && el.offsetParent !== null;
    const clipped = [...document.querySelectorAll('.bub, .ch-title, .narr, .opt, .go, .small, .next, .tbtn, .ttl b, .toc-row, .seg button, .switch, .book-card, .plate, .toast')].filter(vis)
      .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis').map(el => (el.id || el.className) + ':' + el.scrollWidth + '>' + el.clientWidth);
    const outside = ['go', 'small', 'next'].filter(id => !document.getElementById('reader').hidden).map(id => [id, r(id)]).filter(([, x]) => x.bottom > vh || x.top < 0 || x.left < 0 || x.right > vw).map(([id, x]) => `${id}:${Math.round(x.top)}-${Math.round(x.bottom)}/${vh}`);
    return { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped, outside, goBottom: Math.round(r('go').bottom), vh };
  }).then(v => note(`layout.${tag}`, v));
  // A tap's reveal starts a frame or two later on slow devices; waiting for idle before it starts measures nothing.
  const started = async () => { for (let i = 0; i < 20; i++) { if (await ev(() => document.getElementById('stream').getAttribute('aria-busy') === 'true')) return; await p.waitForTimeout(50); } };
  const idle = async () => { for (let i = 0; i < 400; i++) { if (await ev(() => document.getElementById('stream').getAttribute('aria-busy') !== 'true')) return; await p.waitForTimeout(50); } harness.push('idle timeout'); };
  const mark = () => ev(() => { window.__scroll.length = 0; return performance.now(); });
  const reveal = (t0) => ev((t0) => window.__log.filter(e => e.t >= t0).map(e => [Math.round(e.t - t0), e.typing ? 'typing' : e.cls.replace(/\s*\bin\b/, ''), e.text]), t0);
  const typing = (t0) => ev((t0) => window.__typing.filter(e => e.add >= t0 && e.rm).map(e => Math.round(e.rm - e.add)), t0);
  const scroll = (t0) => ev((t0) => window.__scroll.filter(([x]) => x >= t0).map(([x, y]) => [Math.round(x - t0), Math.round(y)]), t0);
  const storage = () => ev(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
  const fontsWait = () => ev(() => Promise.race([document.fonts.ready.then(() => document.fonts.status), new Promise(r => setTimeout(() => r('timeout'), 15000))]));
  const fresh = async () => { await p.goto(url, { timeout: 300000 }); await ev(() => localStorage.clear()); await p.reload({ timeout: 300000 }); note('fonts', await fontsWait()); await p.waitForTimeout(300); };
  const vw = D.viewport.width, vh = D.viewport.height;
  const step = async (name, fn) => { try { await fn(); } catch (e) { note(`${name}.ERROR`, String(e.message).split('\n')[0]); } };
  const menuOpen = () => ev(() => document.getElementById('top').classList.contains('open'));
  const ensureMenu = async () => { if (!(await menuOpen())) { await p.touchscreen.tap(vw - 6, vh * 0.4); await p.waitForTimeout(350); } };
  // F1 library
  await step('library', async () => {
    await fresh();
    note('library.text', await ev(() => document.getElementById('library').innerText));
    note('library.cards', await ev(() => [...document.querySelectorAll('.book-card')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })));
    note('library.covers', await ev(() => [...document.querySelectorAll('#library img')].map(i => [i.naturalWidth > 0, Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)])));
    note('library.storage', await storage());
    note('library.static.removed', await ev(() => !document.getElementById('static')));
    await layout('library');
  });
  // F2 open book + first page reveal, toast, picture
  await step('open', async () => {
    const t0 = await mark(); await $tap('[data-book]', 0); await idle();
    note('open.reveal', await reveal(t0)); note('open.typing', await typing(t0));
    note('open.state', await state());
    note('open.toast', await ev(() => { const t = document.querySelector('.toast'); if (!t) return null; const r = t.getBoundingClientRect(); return [t.textContent, Math.round(r.top), Math.round(r.width) <= innerWidth - 32 + 1]; }));
    note('open.storage', await storage());
    note('open.ptrType', await ev(() => window.__ptr.slice(-1)[0]));
    note('open.picture', await ev(() => [...document.querySelectorAll('#stream figure.pic img')].map(i => { const r = i.getBoundingClientRect(); return [i.complete && i.naturalWidth > 0, Math.round(r.width), Math.round(r.height), +(r.height / r.width).toFixed(3)]; })));
    note('open.about.styles', await ev(() => [...document.querySelectorAll('#styles img')].map(i => i.naturalWidth > 0)));
    await layout('open');
  });
  // F3 Next x3: slide + reveal
  for (let i = 1; i <= 3; i++) await step(`tap${i}`, async () => {
    const t0 = await mark(); await $tap('#go'); await started(); await idle();
    note(`tap${i}.reveal`, await reveal(t0)); note(`tap${i}.typing`, await typing(t0)); note(`tap${i}.scroll`, await scroll(t0)); note(`tap${i}.state`, await state());
    await layout(`tap${i}`);
  });
  await step('toastGone', async () => { await p.waitForTimeout(7300); note('toast.gone', await ev(() => !document.querySelector('.toast'))); });
  // F4 flush: second tap while revealing shows the rest without typing
  await step('flush', async () => {
    const t0 = await mark(); await $tap('#go'); await p.waitForTimeout(700); await $tap('#go'); await started(); await idle();
    note('flush.reveal', await reveal(t0)); note('flush.state', await state());
  });
  // F5 menu: middle tap closed -> nothing; edge tap opens; text tap closes; edge both sides
  await step('menu', async () => {
    await p.touchscreen.tap(vw / 2, vh * 0.4); await p.waitForTimeout(300); note('menu.middleTap.open', await menuOpen());
    await p.touchscreen.tap(vw - 6, vh * 0.4); await p.waitForTimeout(350);
    note('menu.rightEdge.open', await ev(() => { const t = document.getElementById('top'); const r = t.getBoundingClientRect(); return [t.classList.contains('open'), Math.round(r.top), Math.round(r.bottom), getComputedStyle(t).transform]; }));
    note('menu.buttons', await ev(() => ['booksBtn', 'tocBtn', 'setBtn'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [id, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), !!h && document.getElementById(id).contains(h)]; })));
    await layout('menuOpen');
    const textPt = await ev(() => { const el = [...document.querySelectorAll('#stream .bub, #stream .narr')].find(e => { const r = e.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight - 140; }); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + Math.min(10, r.height / 2)]; });
    note('menu.textPoint', !!textPt);
    if (textPt) { await p.touchscreen.tap(textPt[0], textPt[1]); await p.waitForTimeout(350); note('menu.textTap.open', await menuOpen()); }
    await p.touchscreen.tap(5, vh * 0.4); await p.waitForTimeout(350); note('menu.leftEdge.open', await menuOpen());
    await p.touchscreen.tap(vw / 2, vh * 0.4); await p.waitForTimeout(350); note('menu.pageTap.closes', !(await menuOpen()));
    const edge = Math.max(44, vw * 0.13);
    await p.touchscreen.tap(edge + 4, vh * 0.4); await p.waitForTimeout(300); note('menu.justInsideEdge.open', await menuOpen());
    await p.touchscreen.tap(edge - 4, vh * 0.4); await p.waitForTimeout(300); note('menu.justOutsideEdge.open', await menuOpen());
  });
  // F6 settings panel and every setting
  await step('settings', async () => {
    await ensureMenu();
    await $tap('#setBtn'); await p.waitForTimeout(150);
    note('settings.open', await ev(() => [!document.getElementById('settings').hidden, document.getElementById('setBtn').getAttribute('aria-expanded')]));
    note('settings.controls', await ev(() => [...document.querySelectorAll('#settings button')].map(b => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [b.textContent.trim(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), r.right <= innerWidth && r.bottom <= innerHeight && !!h && b.contains(h), b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked')]; })));
    await layout('settings');
    for (const v of ['1.1', '0.92', '1']) {
      await $tap(`#sizeSeg [data-v="${v}"]`); await p.waitForTimeout(250);
      note(`size.${v}`, await ev(() => ({ fs: getComputedStyle(document.getElementById('app')).getPropertyValue('--fs').trim(), bub: getComputedStyle(document.querySelector('#stream .bub') || document.body).fontSize, narr: getComputedStyle(document.querySelector('#stream .narr') || document.body).fontSize, title: getComputedStyle(document.querySelector('.ch-title')).fontSize, plate: getComputedStyle(document.querySelector('#stream .plate') || document.body).fontSize, scrollY: Math.round(scrollY), items: document.querySelectorAll('#stream > .item').length, stored: localStorage.getItem('cg-size'), pressed: document.querySelector('#sizeSeg [aria-pressed="true"]').dataset.v })));
      await layout(`size${v}`);
    }
    for (const v of ['dark', 'light', 'paper']) {
      await $tap(`#themeSeg [data-v="${v}"]`); await p.waitForTimeout(150);
      note(`theme.${v}`, await ev(() => { const c = (s) => { const e = document.querySelector(s); return e ? [getComputedStyle(e).color, getComputedStyle(e).backgroundColor] : null; }; return { cls: document.getElementById('app').className, body: getComputedStyle(document.body).backgroundColor, bub: c('#stream .bub'), go: c('#go'), panel: c('#settings'), top: c('#top'), stored: localStorage.getItem('cg-theme') }; }));
    }
    for (const v of ['fast', 'slow', 'normal']) { await $tap(`#speedSeg [data-v="${v}"]`); await p.waitForTimeout(100); note(`speed.${v}`, await ev(() => [document.querySelector('#speedSeg [aria-pressed="true"]').dataset.v, localStorage.getItem('cg-speed')])); }
    await $tap('#setBtn'); await p.waitForTimeout(150);
    note('settings.toggleClosed', await ev(() => [document.getElementById('settings').hidden, document.getElementById('setBtn').getAttribute('aria-expanded'), document.getElementById('top').classList.contains('open')]));
  });
  // F7 contents: open, rows, toggle, jump to chapter 2 and back
  await step('toc', async () => {
    await ensureMenu();
    await $tap('#tocBtn'); await p.waitForTimeout(150);
    note('toc.rows', await ev(() => [...document.querySelectorAll('#toc .toc-row')].map(r => { const b = r.getBoundingClientRect(); return [r.innerText.replace(/\s+/g, ' '), r.classList.contains('here'), Math.round(b.height), b.right <= innerWidth]; })));
    note('toc.expanded', await ev(() => document.getElementById('tocBtn').getAttribute('aria-expanded')));
    await $tap('#tocBtn'); await p.waitForTimeout(150); note('toc.toggleClosed', await ev(() => document.getElementById('toc').hidden));
    await $tap('#tocBtn'); await p.waitForTimeout(150);
    const t0 = await mark(); await $tap('#toc .toc-row', 1); await idle();
    note('toc.jump.state', await state()); note('toc.jump.reveal', await reveal(t0)); note('toc.jump.panelHidden', await ev(() => document.getElementById('toc').hidden));
    note('toc.jump.storage', await ev(() => localStorage.getItem('cg-position:nar4')));
    await ensureMenu(); await $tap('#tocBtn'); await p.waitForTimeout(150);
    note('toc.rows.ch2', await ev(() => [...document.querySelectorAll('#toc .toc-row span')].map(s => s.textContent)));
    await $tap('#toc .toc-row', 0); await idle(); note('toc.back.state', await state());
  });
  // F8 Auto at three speeds (scroll speed, typing 650 ms), pause via the main button
  for (const v of ['normal', 'fast', 'slow']) await step(`auto.${v}`, async () => {
    await ensureMenu();
    await $tap('#tocBtn'); await p.waitForTimeout(100); await $tap('#toc .toc-row', 0); await idle(); await p.waitForTimeout(300);
    await ensureMenu();
    await $tap('#setBtn'); await p.waitForTimeout(100); await $tap(`#speedSeg [data-v="${v}"]`); await p.waitForTimeout(100);
    const t0 = await mark(); await $tap('#autoSw'); await p.waitForTimeout(150);
    note(`auto.${v}.on`, await state());
    await p.waitForTimeout(5000);
    note(`auto.${v}.scroll`, (await scroll(t0)).filter((_, i) => i % 6 === 0)); note(`auto.${v}.typing`, await typing(t0)); note(`auto.${v}.reveal`, await reveal(t0));
    await $tap('#setBtn'); await p.waitForTimeout(100);
    await $tap('#go'); await p.waitForTimeout(200);
    note(`auto.${v}.paused`, await state());
  });
  const toEnd = async (tag, optIndex, log) => {
    for (let i = 0; i < 40; i++) {
      const s = await state();
      if (!s.nextDisabled) break;
      const nOpt = await ev(() => document.querySelectorAll('#stream .choice .opt').length);
      if (s.goDisabled && nOpt) {
        if (log) { note(`${tag}.choice${i}`, await ev(() => [...document.querySelectorAll('#stream .choice .opt')].map(o => { const r = o.getBoundingClientRect(); return [o.textContent, Math.round(r.top), Math.round(r.bottom), r.bottom <= document.querySelector('.links').getBoundingClientRect().top]; }))); await layout(`${tag}.choice${i}`); }
        const t0 = await mark(); await $tap('#stream .choice .opt', Math.min(optIndex, nOpt - 1)); await idle();
        if (log) { note(`${tag}.pick${i}.reveal`, await reveal(t0)); note(`${tag}.pick${i}.state`, await state()); }
        continue;
      }
      await $tap('#small'); await p.waitForTimeout(300);
      if (log) note(`${tag}.small${i}.state`, await state());
    }
  };
  // F9 whole chapter, choice, pick, to the end
  await step('whole', async () => {
    if (await menuOpen()) { await p.touchscreen.tap(vw / 2, vh * 0.4); await p.waitForTimeout(300); }
    await toEnd('whole', 0, true);
    note('whole.end.state', await state());
    note('whole.end.mark', await ev(() => document.querySelector('.end-mark')?.textContent || null));
    note('whole.end.storage', await ev(() => localStorage.getItem('cg-position:nar4')));
    note('whole.pictures', await ev(() => [...document.querySelectorAll('#stream figure.pic img')].map(i => { const r = i.getBoundingClientRect(); return [i.complete && i.naturalWidth > 0, Math.round(r.width), Math.round(r.height)]; })));
    await layout('end');
  });
  // F10 resume after reload
  await step('resume', async () => {
    const before = await state();
    await p.reload({ timeout: 300000 }); await fontsWait(); await p.waitForTimeout(300);
    note('resume.library', await ev(() => document.getElementById('library').innerText));
    await $tap('[data-book]', 0); await idle(); await p.waitForTimeout(500);
    const after = await state(); note('resume.state', after);
    note('resume.same', [before.items === after.items, before.sub === after.sub, before.go === after.go, before.scrollY, after.scrollY]);
  });
  // F11 end-of-chapter restart link restarts the chapter; other option of each choice
  await step('reread', async () => {
    const t0 = await mark(); await $tap('#small'); await idle(); note('reread.state', await state()); note('reread.reveal', await reveal(t0));
    await toEnd('reread', 1, false); note('reread.end', await state()); note('reread.items', await ev(() => [...document.querySelectorAll('#stream > .item')].map(e => e.className.replace(/\s*\bin\b/, '') + '|' + e.textContent.trim().slice(0, 30))));
  });
  // F12 next chapter
  await step('nextch', async () => { const t0 = await mark(); await $tap('#next'); await idle(); note('nextch.state', await state()); note('nextch.reveal', await reveal(t0)); });
  // F13 back to library via menu, restart button
  await step('books', async () => {
    await ensureMenu();
    await $tap('#booksBtn'); await p.waitForTimeout(300);
    note('books.library', await ev(() => [!document.getElementById('library').hidden, document.getElementById('reader').hidden, document.getElementById('library').innerText, Math.round(scrollY)]));
    note('books.storage', await ev(() => localStorage.getItem('cg-position:nar4')));
    await layout('library2');
    await $tap('[data-restart]', 0); await idle();
    note('restart.state', await state()); note('restart.storage', await ev(() => localStorage.getItem('cg-position:nar4')));
  });
  // F14 about hide
  await step('about', async () => {
    await ev(() => scrollTo(0, 0)); await p.waitForTimeout(300); note('about.scrolledTop', await ev(() => Math.round(scrollY)));
    await $tap('#aboutHide'); await p.waitForTimeout(300); note('about.hidden', [await ev(() => document.getElementById('about').hidden), await state()]);
  });
  // F15 rotation to landscape and back
  await step('rotate', async () => {
    await p.setViewportSize({ width: vh, height: vw }); await p.waitForTimeout(600); note('rotate.land', await state()); await layout('landscape');
    await p.setViewportSize({ width: vw, height: vh }); await p.waitForTimeout(600); note('rotate.back', await state()); await layout('portrait');
  });
  // F16 second book: toast again, single chapter to end, to library
  await step('book2', async () => {
    await ensureMenu(); await $tap('#booksBtn'); await p.waitForTimeout(300);
    const t0 = await mark(); await $tap('[data-book]', 1); await idle();
    note('book2.open', await state()); note('book2.reveal', await reveal(t0)); note('book2.toast', await ev(() => document.querySelector('.toast')?.textContent || null));
    note('book2.avatars', await ev(() => [...document.querySelectorAll('#stream .ava')].map(i => i.tagName === 'IMG' ? i.naturalWidth > 0 : 'letter')));
    await toEnd('book2', 0, true);
    note('book2.end', await state());
    note('book2.end.storage', await ev(() => localStorage.getItem('cg-position:sys1')));
    await p.reload({ timeout: 300000 }); await fontsWait(); await p.waitForTimeout(300);
    await $tap('[data-book]', 1); await idle(); await p.waitForTimeout(300);
    note('book2.resume', await state());
    const t1 = await mark(); await $tap('#small'); await idle(); note('book2.reread', await state()); note('book2.reread.reveal', await reveal(t1));
    await toEnd('book2opt1', 1, false);
    note('book2.opt1.items', await ev(() => [...document.querySelectorAll('#stream > .item')].map(e => e.className.replace(/\s*\bin\b/, '') + '|' + e.textContent.trim().slice(0, 30))));
    note('book2.allPictures', await ev(() => [...document.querySelectorAll('#stream figure.pic img')].map(i => [i.naturalWidth > 0, Math.round(i.getBoundingClientRect().height)])));
    await $tap('#next'); await p.waitForTimeout(300);
    note('book2.toLibrary', await ev(() => [!document.getElementById('library').hidden, document.getElementById('library').innerText]));
    note('final.storage', await storage());
  });
  note('errors', errors.slice());
  await ctx.close();
  // F17 system dark theme default
  await step('sysdark', async () => {
    const c2 = await b.newContext({ ...D, colorScheme: 'dark' }); const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push('dark pageerror: ' + e.message));
    await p2.goto(url, { timeout: 300000 }); await p2.waitForTimeout(500);
    note('sysdark', await p2.evaluate(() => [document.getElementById('app').className, getComputedStyle(document.body).backgroundColor, localStorage.getItem('cg-theme')]));
    await c2.close();
  });
  // F18 quick open: the card is tapped as soon as it exists, before fonts finish
  await step('quick', async () => {
    const c3 = await b.newContext({ ...D }); await c3.addInitScript(INIT); const p3 = await c3.newPage();
    p3.on('pageerror', (e) => errors.push('quick pageerror: ' + e.message));
    await p3.goto(url, { timeout: 300000, waitUntil: 'domcontentloaded' });
    await p3.waitForSelector('[data-book]', { timeout: 300000 });
    note('quick.fontsAtTap', await p3.evaluate(() => [document.fonts.status, document.fonts.check('16px Spectral'), [...document.styleSheets].length]));
    const bx = await p3.locator('[data-book]').first().boundingBox(); await p3.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2);
    for (let i = 0; i < 400; i++) { if (await p3.evaluate(() => document.getElementById('stream').getAttribute('aria-busy') !== 'true' && document.querySelectorAll('#stream > .item').length > 1)) break; await p3.waitForTimeout(50); }
    await p3.evaluate(() => document.fonts.ready); await p3.waitForTimeout(1500);
    note('quick.state', await p3.evaluate(() => ({ items: [...document.querySelectorAll('#stream > .item')].map(e => e.className.replace(/\s*\bin\b/, '')), scrollY: Math.round(scrollY), fonts: document.fonts.check('16px Spectral') })));
    await c3.close();
  });
  note('errors.final', errors);
  note('harness', harness);
  fs.writeFileSync(out, JSON.stringify({ engine, dev, url, obs }));
  await b.close();
})().catch(e => { console.error(e); fs.writeFileSync(out, JSON.stringify({ engine, dev, url, obs, harness, crash: String(e) })); process.exit(1); });
