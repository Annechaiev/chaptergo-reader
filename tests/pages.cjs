// Pages-mode regression controls, also run by run.sh. No network or model calls.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const pw = require('playwright');
const target = process.argv[2] || path.join(__dirname, '../source/reader-library-9.html');
let html;
const onlyGaps = process.argv.includes('--gaps');
// Identical vectors and JS string offsets to Studio's tests/chaptergo-first-mention.test.ts.
const vectors = [
  { name: "Ukrainian forms", labels: ["Крамєлов", "сивий ліхтарник", "Бревін", "Таврінь", "Терван"], texts: ["Крамєлова зустрів Сивий ліхтарник, Бревін, Таврінь і Терване."], expected: [[[0, 9], [18, 33], [35, 41], [43, 50], [53, 60]]] },
  { name: "once across lines", labels: ["Крамєлов"], texts: ["Крамєлов тут.", "Крамєлова знову."], expected: [[[0, 8]], []] },
  { name: "bubble before narration", labels: ["Терван"], texts: ["Гей, Терване!", "Терван прийшов."], expected: [[[5, 12]], []] },
  { name: "capitalised label", labels: ["Бревін"], texts: ["бревін тут.", "Бревін тут."], expected: [[], [[0, 6]]] },
  { name: "lowercase label at sentence start", labels: ["сивий ліхтарник"], texts: ["Сивий ліхтарник тут."], expected: [[[0, 15]]] },
  { name: "branch A", labels: ["Таврінь"], texts: ["Таврінь ліворуч.", "Таврінь далі."], expected: [[[0, 7]], []] },
  { name: "branch B", labels: ["Таврінь"], texts: ["Тиша.", "Таврінь праворуч."], expected: [[], [[0, 7]]] },
  { name: "overlap keeps earliest", labels: ["сивий ліхтарник", "ліхтарник"], texts: ["сивий ліхтарник.", "ліхтарник."], expected: [[[0, 15]], [[0, 9]]] },
  { name: "word edge and whitespace", labels: ["Терван", "сивий ліхтарник"], texts: ["НеТерван. (Терване), сивий\nліхтарника."], expected: [[[11, 18], [21, 37]]] },
  { name: "short labels stay whole", labels: ["Narl", "Дорн", "Лив"], texts: ["Narch. Дорна. Ливада.", "Narl Дорн Лив."], expected: [[], [[0, 4], [5, 9], [10, 13]]] },
  { name: "bounded suffix", labels: ["Терван"], texts: ["Тервахолодний.", "Терване."], expected: [[], [[0, 7]]] },
  { name: "colliding labels consumed once", labels: ["Дорн", "Дорла"], texts: ["Дорла.", "Дорн.", "Дорла."], expected: [[[0, 5]], [[0, 4]], []] },
];

function marksVectors() {
  const init = html.match(/    const labels = new Set\([\s\S]*?    S.named = new Set\(\);/);
  const marks = html.match(/  function marks\(text\) \{[\s\S]*?(?=  const esc =)/);
  assert.ok(init && marks, 'first-mention implementation exists in the shipped page');
  assert.ok(!init[0].includes('(?<'), 'regex has no iOS-incompatible lookbehind');
  for (const v of vectors) {
    const context = { S: {}, D: { speakers: {} }, chapter: () => ({ episodes: [{ nodes: Object.fromEntries(v.labels.map((voiceName, i) => [i, { speaker: `person${i}`, voiceName }])) }] }), esc: (s) => s };
    vm.createContext(context); vm.runInContext(init[0] + marks[0], context);
    const actual = v.texts.map((text) => {
      const marked = context.marks(text), result = []; let plain = 0, at = 0;
      for (const m of marked.matchAll(/<b class="first-name">(.*?)<\/b>/gs)) {
        plain += m.index - at; result.push([plain, plain + m[1].length]); plain += m[1].length; at = m.index + m[0].length;
      }
      return result;
    });
    assert.deepEqual(actual, v.expected, v.name); console.log(`VECTOR ${v.name}: ${JSON.stringify(actual)}`);
  }
  const context = { S: {}, D: { speakers: {} }, chapter: () => ({ episodes: [{ nodes: {
    a: { speaker: 'system', voiceName: 'Система' }, b: { speaker: 'someone', voiceName: 'Хтось' },
    c: { speaker: 'role:guard', voiceName: 'Вартовий' }, d: { speaker: 'person', voiceName: null },
    system: { speaker: 'person', voiceName: 'Терван' },
  } }] }), esc: (s) => s };
  vm.createContext(context); vm.runInContext(init[0] + marks[0], context);
  assert.equal(context.marks('Система Хтось Вартовий Терван'), 'Система Хтось Вартовий <b class="first-name">Терван</b>');
  console.log('VECTOR excluded keys: [[[23,29]]]');
  const allEpisodes = { S: {}, chapter: () => ({ episodes: [
    { nodes: { a: { speaker: 'person', voiceName: 'Терван' } } },
    { nodes: { b: { speaker: 'guard', voiceName: 'Таврінь' }, c: { speaker: 'person', voiceName: 'Терван' } } },
  ] }), esc: (s) => s };
  vm.createContext(allEpisodes);
  for (let chapter = 0; chapter < 2; chapter++) {
    vm.runInContext('(function () {' + init[0] + marks[0] + '; this.marks = marks; }).call(this);', allEpisodes);
    assert.equal(allEpisodes.marks('Терван і Таврінь.'), '<b class="first-name">Терван</b> і <b class="first-name">Таврінь</b>.');
  }
  console.log('VECTOR all episodes + chapter reset: [[[0,6],[9,16]]] twice');
  const escaped = { S: {}, chapter: () => ({ episodes: [{ nodes: { a: { speaker: 'person', voiceName: 'А.*' } } }] }), esc: (s) => s };
  vm.createContext(escaped); vm.runInContext(init[0] + marks[0], escaped);
  assert.equal(escaped.marks('А.* тут'), '<b class="first-name">А.*</b> тут');
  console.log('VECTOR regex escaping/no lookbehind: [[[0,3]]]');
  // Run the actual render()/line() functions: excluded node kinds and the reader's own pick never consume a mark.
  const rendered = [], nodeContext = { S: { shown: 0, rendered: 0 }, chapter: () => ({ episodes: [{ nodes: { a: { speaker: 'person', voiceName: 'Терван' } } }] }),
    esc: (s) => s, avatar: () => '', chooser: () => null,
    add: (html) => { rendered.push(html); return { querySelectorAll: () => [] }; } };
  const render = html.match(/  function render\(n\) \{[\s\S]*?(?=  \/\/ Moves the pointer)/)[0];
  const line = html.match(/  const line = \(key, name, text,.*?;\n/)[0];
  vm.createContext(nodeContext); vm.runInContext(init[0] + marks[0] + line + render + '\nthis.readersPick = () => line("person", "", "Терван", "picked");', nodeContext);
  nodeContext.render({ kind: 'choice', prompt: 'Терван', choices: [] });
  nodeContext.readersPick();
  nodeContext.render({ kind: 'reveal', fact: { quote: 'Терван' } });
  for (const role of ['break', 'plate']) nodeContext.render({ kind: 'message', speaker: 'narrator', role, text: 'Терван' });
  nodeContext.render({ kind: 'ending', speaker: 'narrator', text: 'Терване!' });
  assert.equal(rendered.filter(s => s.includes('first-name')).length, 1);
  assert.equal(rendered.at(-1), '<b class="first-name">Терване</b>!');
  console.log('VECTOR message/ending scan only: line 5 [[0,7]]');
  assert.ok(!/mode\(\)|m-pages|m-chat|mockup_data/.test(html), 'pages is the only reading mode');
  let frame;
  const sliding = { S: { page: { isConnected: true }, gen: 1 }, scrollY: 100, pageTop: () => 812,
    matchMedia: () => ({ matches: false }), performance: { now: () => 0 },
    requestAnimationFrame: (f) => { frame = f; }, scrollTo: (_, y) => { sliding.scrollY = y; } };
  vm.createContext(sliding);
  vm.runInContext(html.match(/  function alignPage\(smooth = false\) \{[\s\S]*?(?=  function cancel)/)[0], sliding);
  sliding.alignPage(true); frame(233.5); assert.equal(sliding.scrollY, 712.5, 'cubic ease-out at half time');
  frame(466); assert.ok(sliding.scrollY < 800 && sliding.S.sliding);
  frame(467); assert.equal(sliding.scrollY, 800); assert.equal(sliding.S.sliding, false);
  console.log('SLIDE: 467ms, cubic ease-out, 87.5% at 233.5ms PASSED');
}

const message = (text, speaker = 'narrator', extra = {}) => ({ kind: 'message', speaker, text, ...extra });
function fixture(nodes, id = 'pages-test') {
  const entries = nodes.map((n, i) => [`n${i}`, { ...n, nodeId: `n${i}`, nextNodeId: `n${i + 1}` }]);
  const book = { id, title: 'Pages test', author: null,
    img: { picture: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3C/svg%3E' }, imageSizes: { picture: [100, 100] }, speakers: { person: { name: 'Терван', asset: null } },
    chapters: [{ number: 1, title: 'Розділ 1. Перевірка', episodes: [{ start: 'n0', nodes: Object.fromEntries(entries) }] }] };
  // The build's plain-copy asset transfer tolerates a fixture with no pictures.
  return html.replace(/<div class="static" id="static">[\s\S]*?(?=<script type="application\/json" id="data">)/, '<div id="static"></div>')
    .replace(/(<script type="application\/json" id="data">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify({ books: [book] }) + b);
}

async function browserCases() {
  for (const [engine, dev] of [['webkit', 'iPhone 13'], ['webkit', 'iPhone SE'], ['chromium', 'Pixel 7'], ['chromium', 'Galaxy S9+']]) {
    const chromium = process.env.CHROMIUM_PATH || 'C:/Users/AnD/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
    const browser = await pw[engine].launch(engine === 'chromium' && fs.existsSync(chromium) ? { executablePath: chromium } : {});
    try {
      const context = await browser.newContext({ ...pw.devices[dev] }), p = await context.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
      let content;
      await p.route('http://pages.test/**', (r) => r.fulfill({ contentType: 'text/html', body: content }));
      const idle = async () => { await p.waitForFunction(() => document.getElementById('stream').getAttribute('aria-busy') !== 'true'); await p.waitForTimeout(250); };
      const open = async (nodes, saved = null) => {
        content = fixture(nodes); await p.goto('http://pages.test/u45.html');
        await p.evaluate((saved) => { localStorage.clear(); localStorage.setItem('cg-menu-hint:pages-test', '1'); if (saved) localStorage.setItem('cg-position:pages-test', JSON.stringify(saved)); }, saved);
        await p.reload(); await p.evaluate(() => document.fonts.ready); await p.locator('[data-book]').tap(); await idle();
      };
      const nodes = Array.from({ length: 35 }, (_, i) => i % 3 === 0 ? message(`Терване, репліка ${i}.`, 'person', { voiceName: 'Терван' }) : message(`Терван іде. Абзац ${i}. ` + 'Тихо навколо. '.repeat(8)));
      nodes.push({ kind: 'ending', speaker: 'narrator', text: 'Терван зупинився.' });
      if (!onlyGaps) {
      for (const speaker of ['narrator', 'person']) {
        await open([message('Довгий абзац. '.repeat(180), speaker, speaker === 'person' ? { voiceName: 'Терван' } : {}),
          { kind: 'ending', speaker: 'narrator', text: 'Завершення.' }]);
        await p.locator('#go').tap(); await idle();
        const overflow = await p.evaluate(() => {
          const el = document.querySelector('#stream > .narr, #stream > .row'), r = el.getBoundingClientRect();
          return { reachesDock: r.bottom > document.querySelector('.links').getBoundingClientRect().top, clip: getComputedStyle(el).clipPath };
        });
        assert.ok(!overflow.reachesDock || overflow.clip !== 'none', `${dev}: oversized ${speaker} continues on whole lines`);
        let position = await p.evaluate(() => JSON.parse(localStorage.getItem('cg-position:pages-test')));
        // A reply first moves intact onto a new page; its next page is the continuation.
        if (position.line === 0) { await p.locator('#go').tap(); await idle(); position = await p.evaluate(() => JSON.parse(localStorage.getItem('cg-position:pages-test'))); }
        assert.ok(position.line > 0, `${dev}: continuation saves the first line at the page top`);
        await p.reload(); await p.evaluate(() => document.fonts.ready); await p.locator('[data-book]').tap(); await idle();
        const restored = await p.evaluate(() => JSON.parse(localStorage.getItem('cg-position:pages-test')));
        assert.deepEqual([restored.block, restored.line], [position.block, position.line], `${dev}: nonzero line resumes`);
      }
      await open(nodes);
      const view = () => p.evaluate(() => [...document.querySelectorAll('#stream > .item')].filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).visibility !== 'hidden' && r.bottom > 12 && r.top < document.querySelector('.links').getBoundingClientRect().top; }).map(e => e.textContent).join('|'));
      const first = await view();
      await p.evaluate(() => {
        for (const [type, y] of [['touchstart', 400], ['touchmove', 300], ['touchend', null]]) {
          const e = new Event(type, { bubbles: true, cancelable: true }); e.touches = y == null ? [] : [{ clientY: y }]; document.getElementById('stream').dispatchEvent(e);
        }
      });
      await idle();
      const pull = await view(); assert.notEqual(pull, first, `${dev}: pull advances a page`);
      await open(nodes); await p.locator('#go').tap(); await idle(); assert.equal(await view(), pull, `${dev}: pull = Далі`);
      // The slide's frame loop must use the approved duration and cubic easing.
      assert.match(html, /\(now - start\) \/ 467/); assert.match(html, /1 - \(1 - k\) \*\* 3/);
      for (let i = 0; i < 45 && await p.locator('#go').isEnabled(); i++) {
        const cut = await p.evaluate(() => {
          const limit = document.querySelector('.links').getBoundingClientRect().top;
          return [...document.querySelectorAll('#stream > .item')].filter(e => {
            const r = e.getBoundingClientRect(), c = getComputedStyle(e);
            return c.visibility !== 'hidden' && r.top >= 12 && r.top < limit && r.bottom > limit + 1 && c.clipPath === 'none' && !e.matches('.pic');
          }).map(e => e.className);
        });
        assert.deepEqual(cut, [], `${dev}: no cut block at rest`);
        await p.locator('#go').tap(); await idle();
      }
      assert.equal(await p.locator('#go').textContent(), 'Кінець глави');
      assert.match(await view(), /Терван зупинився/, `${dev}: end includes story text`);
      assert.equal(await p.locator('.first-name').count(), 1, `${dev}: name marked once across pages`);
      const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('cg-position:pages-test')));
      assert.ok(Number.isInteger(saved.block) && Number.isInteger(saved.line), `${dev}: saved block + line`);
      const before = await view(); await p.reload(); await p.evaluate(() => document.fonts.ready); await p.locator('[data-book]').tap(); await idle(); assert.equal(await view(), before, `${dev}: resume current shape`);
      await open(nodes, { ch: 0, rendered: 6, choices: {}, page: 3, offset: 0 });
      const migrated = await p.evaluate(() => JSON.parse(localStorage.getItem('cg-position:pages-test')));
      assert.equal(migrated.block, 3, `${dev}: old saved page restored`); assert.equal(migrated.line, 0);
      }
      // Measure letter-cap tops and last baselines, rather than invisible line-box leading.
      // Native text-box and the forced fallback both use the actual reader's rendering and font sizes.
      const spacingNodes = [message('НАРАЦІЯ'), message('РЕПЛІКА', 'person', { voiceName: 'Терван' }),
        message('ДУМКА', 'person', { voiceName: 'Терван', presentation: 'thought' }),
        message('МІСЦЕ', 'narrator', { role: 'plate' }), { kind: 'image', asset: 'picture' }, { kind: 'ending', speaker: 'narrator', text: 'ОСТАННІЙ РЯДОК' }];
      await open(spacingNodes); await p.locator('#small').tap(); await idle();
      const gaps = await p.evaluate((onlyGaps) => {
        const stream = document.getElementById('stream');
        const samples = [...stream.querySelectorAll(':scope > .item')].filter(e => !e.matches('.about'));
        const results = [];
        const fallback = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
          .find(r => r.conditionText === 'not (text-box: trim-both cap alphabetic)');
        if (!fallback) throw new Error('missing text-box fallback');
        const style = document.createElement('style'); document.head.append(style);
        // Each neighbour type in each direction, including heading/end. Reuse rendered blocks, not a second layout.
        stream.innerHTML = '';
        for (const a of samples) for (const b of samples) {
          const pair = [a.cloneNode(true), b.cloneNode(true)]; pair.forEach(e => e.classList.remove('in')); stream.append(...pair);
        }
        const edges = (el) => {
          if (el.matches('.row')) return { top: textEdges(el.querySelector('.who')).top, bottom: Math.max(...[...el.querySelectorAll('.ava,.bub')].map(e => e.getBoundingClientRect().bottom)) };
          if (el.matches('.narr,.end-mark')) return textEdges(el);
          if (el.matches('.plate')) return textEdges(el.querySelector('span') || el);
          if (el.querySelector('.ch-title')) return { top: el.getBoundingClientRect().top, bottom: textEdges(el.querySelector('.ch-title')).bottom };
          return el.getBoundingClientRect();
        };
        function textEdges(el) {
          const marker = () => { const s = document.createElement('i'); s.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; return s; };
          const first = marker(), last = marker(), cap = document.createElement('i');
          cap.style.cssText = 'position:absolute;height:1cap;width:0'; el.prepend(first); el.append(last, cap);
          const top = first.getBoundingClientRect().top - cap.getBoundingClientRect().height, bottom = last.getBoundingClientRect().top;
          first.remove(); last.remove(); cap.remove(); return { top, bottom };
        }
        for (const old of (onlyGaps ? [true] : [false, true])) for (const size of ['0.92', '1', '1.1']) {
          document.getElementById('app').style.setProperty('--fs', size);
          style.textContent = old ? '#reader * { text-box: normal !important; }' + [...fallback.cssRules].map(r => r.cssText).join('\n') : '';
          const blocks = [...stream.children], values = [];
          for (let i = 0; i < blocks.length; i += 2) { const a = edges(blocks[i]), b = edges(blocks[i + 1]); values.push([blocks[i].className, blocks[i + 1].className, +(b.top - a.bottom).toFixed(3)]); }
          results.push({ fallback: old, size, values });
        }
        return results;
      }, onlyGaps);
      fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'out', `pages-gaps-${engine}-${dev.replaceAll(' ', '-')}.json`), JSON.stringify(gaps));
      for (const row of gaps) {
        const bad = row.values.filter(([, , gap]) => Math.abs(gap - 27.2) > 1);
        assert.deepEqual(bad, [], `${dev}: gaps fallback=${row.fallback} size=${row.size}: ${JSON.stringify(bad)}`);
        console.log(`GAPS ${dev} fallback=${row.fallback} size=${row.size}: ${row.values.length} pairs, ${Math.min(...row.values.map(x => x[2]))}..${Math.max(...row.values.map(x => x[2]))}px`);
      }
      assert.deepEqual(errors, [], `${dev}: page errors`);
      if (!onlyGaps) console.log(`PAGES ${dev}: pull = Далі; whole blocks; nonempty end; 467ms cubic slide; once; old/new resume PASSED`);
      await context.close();
    } finally { await browser.close(); }
  }
}

(async () => {
  if (/^https?:/.test(target)) {
    const response = await fetch(target); if (!response.ok) throw new Error(`HTTP ${response.status}`); html = await response.text();
  } else html = fs.readFileSync(target.startsWith('file:') ? require('node:url').fileURLToPath(target) : path.resolve(target), 'utf8');
  if (!onlyGaps) marksVectors(); await browserCases(); console.log('PAGES CHECK PASSED');
})().catch((e) => { console.error(e.name + ': ' + e.message.split('\n')[0]); if ('actual' in e) console.error(JSON.stringify({ actual: e.actual, expected: e.expected })); process.exitCode = 1; });
