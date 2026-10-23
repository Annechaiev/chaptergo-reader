"""Reader behaviour mockup (owner 23.10.2026): one library, the same chapter three times — as now, «как мессенджер», «страницы без пустоты».

Usage: python build/mockup.py source/reader-library-9.html mockup/source.html
Then:  python build/phone.py mockup/source.html mockup/index.html
Other builders import engine(): a book's `mode` (now / chat / pages) picks its behaviour.
"""
import json
import re
import sys

SWAPS = []


def swap(old, new):
    SWAPS.append((old, new))


def engine(page):
    for old, new in SWAPS:
        assert page.count(old) == 1, f"expected one match: {old[:70]!r} ({page.count(old)})"
        page = page.replace(old, new)
    return page


def mockup_data(page):
    # The same chapter three times; the mode rides on the book.
    match = re.search(r'(<script type="application/json" id="data">)(.*?)(</script>)', page, re.S)
    books = json.loads(match.group(2).replace("<\\/", "</"))["books"]
    base = next(b for b in books if b["id"] == "sys1")
    modes = [("now", "Как сейчас", "Как у сотрудницы: потяни экран пальцем — под текстом пусто"),
             ("chat", "Вариант 1: как мессенджер", "Новые реплики встают внизу над кнопками, прочитанное уезжает вверх"),
             ("pages", "Вариант 2: страницы без пустоты", "Экран листается, как сейчас; палец вверх — то же, что «Далі»")]
    mock = [{**base, "id": f"mock-{mode}", "mode": mode, "title": title, "author": note} for mode, title, note in modes]
    data = json.dumps({"books": mock}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return page[:match.start(2)] + data + page[match.end(2):]


swap("@keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }",
     "@keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }\n"
     "/* Mockup modes: pages keep the block that does not fit unseen; chat has no empty screen under the newest line. */\n"
     ".later { visibility: hidden; }\n"
     ".m-chat .stream { padding-bottom: calc(var(--dock-h) + 40px + env(safe-area-inset-bottom, 0px)); }\n"
     "/* Chat mode starts at the chapter title: the guide card above it would otherwise open the first screen. */\n"
     ".m-chat #about { display: none; }\n"
     "/* Variant 2 spacing (owner 23.10.2026): every gap between blocks is one value, 20% under today's gap between two replies\n"
     "   (34px from a bubble to the letter tops of the next name -> 27.2px). A text block's edges are its letter tops and last baseline. */\n"
     ".m-pages .stream { gap: 27.2px; }\n"
     ".m-pages .row { margin-bottom: 0; }\n"
     ".m-pages .row .who { text-box: trim-start cap alphabetic; }\n"
     ".m-pages .narr { margin-block: 0; text-box: trim-both cap alphabetic; }\n"
     ".m-pages .plate { margin: 0; }\n"
     ".m-pages .plate span { text-box: trim-both cap alphabetic; }\n"
     ".m-pages figure.pic { margin: 0; }\n"
     ".m-pages .end-mark { padding: 0; text-box: trim-both cap alphabetic; }\n"
     ".m-pages .ch-title { margin-bottom: 0; text-box: trim-end cap alphabetic; }\n"
     ".m-pages .ch-title:empty { display: none; }\n"
     ".m-pages .ch-kicker:has(+ .ch-title:empty) { text-box: trim-end cap alphabetic; }\n"
     ".m-pages .first-name { color: var(--ac); font-weight: 600; }")

# Pages mode, owner 23.10.2026: the first time a name shown as an avatar label (Очумєлов, рудий городовик) appears in the
# text, it gets the label's look. A label word matches its inflected forms by its stem; a capitalised name matches only capitalised.
swap("    S.rendered = 0; S.choices = saved?.choices || {};",
     """    S.rendered = 0; S.choices = saved?.choices || {};
    const labels = new Set(chapter().episodes.flatMap((e) => Object.values(e.nodes)).filter((x) => D.speakers[x.speaker] && x.voiceName).map((x) => x.voiceName));
    S.labels = [...labels].map((label) => [label, new RegExp("(?<!\\\\p{L})" + label.trim().split(/\\s+/u).map((w) =>
      (w.length > 6 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "\\\\p{L}*").join("\\\\s+"),
      label[0] === label[0].toLowerCase() ? "iu" : "u")]);
    S.named = new Set();""")

swap('if (n.speaker === "narrator" && n.presentation !== "thought") return add(esc(n.text), "p", "narr in");',
     'if (n.speaker === "narrator" && n.presentation !== "thought") return add(marks(n.text), "p", "narr in");')

swap("""<div class="bub">${thought ? '<i class="puff" aria-hidden="true"></i>' : ""}${esc(text)}</div>""",
     """<div class="bub">${thought ? '<i class="puff" aria-hidden="true"></i>' : ""}${marks(text)}</div>""")

swap("  const esc = (t) =>",
     """  function marks(text) {
    if (mode() !== "pages") return esc(text);
    const hits = S.labels.filter(([label]) => !S.named.has(label)).map(([label, re]) => [re.exec(text), label]).filter(([m]) => m)
      .map(([m, label]) => [m.index, m[0].length, label]).sort((a, b) => a[0] - b[0]);
    let out = "", at = 0;
    for (const [i, len, label] of hits) {
      if (i < at) continue;
      out += esc(text.slice(at, i)) + `<b class="first-name">${esc(text.slice(i, i + len))}</b>`; at = i + len; S.named.add(label);
    }
    return out + esc(text.slice(at));
  }
  const esc = (t) =>""")

swap('    $("ttlName").textContent = D.title;',
     '    $("ttlName").textContent = D.title;\n'
     '    app.classList.toggle("m-chat", D.mode === "chat"); app.classList.toggle("m-pages", D.mode === "pages");')

# The caption's text in its own box: a flex row's bare text cannot be trimmed to its letters.
swap('    if (n.role === "plate") return add(esc(n.text), "p", "plate in");',
     '    if (n.role === "plate") return add(`<span>${esc(n.text)}</span>`, "p", "plate in");')

# The chapter's end mark keeps the one gap under the text; only a choice splits what is left around itself.
swap("        S.terminal.style.marginTop = `${Math.max(0, left / 2)}px`;",
     "        S.terminal.style.marginTop = `${S.waiting ? Math.max(0, left / 2) : 0}px`;")

swap("  const countNodes = (ch) =>",
     '  const mode = () => D?.mode || "now";\n  const countNodes = (ch) =>')

swap("""    const top = pageTop() - 12, from = scrollY, gen = S.gen;
    if (!smooth || Math.abs(from - top) < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) { scrollTo(0, top); return null; }
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        if (gen !== S.gen) return resolve();
        const k = Math.min(1, (now - start) / 420);
        scrollTo(0, from + (top - from) * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(frame); else resolve();
      };""",
     """    // Chat mode keeps the newest line just above the buttons; pages put the page top at the screen top.
    const chat = mode() === "chat", top = chat ? Math.max(0, bottom(items().pop()) - floor() + 12) : pageTop() - 12, from = scrollY, gen = S.gen;
    if (!smooth || Math.abs(from - top) < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) { scrollTo(0, top); return null; }
    S.sliding = true;
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        if (gen !== S.gen) { S.sliding = false; return resolve(); }
        // Pages mode slides 10% slower than today's 420 ms (owner 23.10.2026: «чуть медленнее, мягче»).
        const k = Math.min(1, (now - start) / (chat ? 260 : mode() === "pages" ? 467 : 420));
        scrollTo(0, from + (top - from) * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(frame); else { S.sliding = false; resolve(); }
      };""")

swap("    return S.terminal && fits(S.terminal) && S.terminal.offsetTop >= pageTop();",
     '    if (mode() === "chat") return !!S.terminal;\n    return S.terminal && fits(S.terminal) && S.terminal.offsetTop >= pageTop();')

swap("    if (!S.waiting || !S.terminal) return null;",
     '    if (mode() === "chat" || !(S.waiting || mode() === "pages" && S.done) || !S.terminal) return null;')

swap("    S.preview = items().find((el) => el.offsetTop >= S.page.offsetTop && !fits(el)) || null;\n  }",
     """    S.preview = mode() === "chat" ? null : items().find((el) => el.offsetTop >= S.page.offsetTop && !fits(el)) || null;
    if (mode() === "pages") pagesOverflow();
  }
  // Pages mode: nothing is cut under the buttons. A paragraph shows the whole lines that fit and goes on from the next line on
  // the next page; a reply waits unseen; a picture shows its top when a quarter of the screen is left for it.
  function pagesOverflow() {
    const el = S.preview, room = el && el !== S.page ? pageTop() + floor() - 12 - el.offsetTop : 0;
    items().forEach((item) => { item.style.clipPath = ""; });
    S.split = 0;
    if (room > 0 && el.matches(".narr")) {
      // Lines are measured from the block's own drawn top, so its rise animation (a few px of shift) cancels out.
      const lh = parseFloat(getComputedStyle(el).lineHeight), drawn = el.getBoundingClientRect().top + scrollY;
      const cut = textLines(el).map((y) => y - drawn).find((y) => y + lh > room);
      if (cut > 0) { S.split = cut; el.style.clipPath = `inset(0 0 ${el.offsetHeight - cut}px 0)`; }
    }
    const hide = room > 0 && !S.split && !(el.matches(".pic") && room >= floor() / 4);
    items().forEach((item) => item.classList.toggle("later", room > 0 && (item.offsetTop > el.offsetTop || item === el && hide)));
  }""")

swap("      else { S.page = S.preview; S.offset = 0; }",
     '      else { S.page = S.preview; S.offset = mode() === "pages" ? S.split : 0; S.page.style.clipPath = ""; }')

swap("""      await sleep(S.auto ? 650 : 420); t.remove();""",
     """      if (mode() === "chat") alignPage(true);
      // Pages mode: typing dots that would sit under the buttons are skipped; the line waits unseen anyway.
      if (mode() !== "pages" || fits(t)) await sleep(S.auto ? 650 : 420);
      t.remove();""")

swap("""    if (S.preview) {
      if (S.waiting) S.terminal.style.marginTop = "0px";""",
     """    const ends = S.waiting || mode() === "pages" && S.done;
    if (S.preview) {
      S.preview.classList.remove("later");
      if (ends) S.terminal.style.marginTop = "0px";""")

swap("    const slide = S.waiting && S.page === S.terminal ? null : alignPage(true);",
     "    const slide = ends && S.page === S.terminal ? null : alignPage(true);")

swap("""    overflow();
    while (!S.preview && !S.waiting && !S.done) {
      if (!(await showOne(gen))) break;
      overflow();""",
     """    overflow();
    // Chat mode: one «Далі» brings about one screen of new lines, each gliding the older text up.
    const first = S.shown ? bottom(items().pop()) : 0;
    while (!S.preview && !S.waiting && !S.done) {
      if (!(await showOne(gen))) break;
      overflow();
      if (mode() === "chat") {
        await alignPage(!S.flush); if (gen !== S.gen) return;
        if (bottom(items().pop()) - first > floor() - 60) break;
      }""")

swap("""    if (S.waiting) S.terminal.style.marginTop = "0px";
    alignPage(); overflow(); placeChoice(); sync();
    if (!S.running && !S.preview && !terminalVisible()) advance();""",
     """    if (S.waiting || mode() === "pages" && S.done) S.terminal.style.marginTop = "0px";
    alignPage(); overflow(); placeChoice(); sync();
    if (mode() !== "chat" && !S.running && !S.preview && !terminalVisible()) advance();""")

swap('  const showChrome = () => { top.classList.add("open"); };',
     """  const showChrome = () => { top.classList.add("open"); };

  // Pages mode: a finger pull past the current screen turns the page like «Далі»; it never scrolls into the empty space below.
  let pullY = null, pulled = false, wheelAt = 0;
  const atRest = () => mode() === "pages" && !$("reader").hidden && !S.auto && S.page;
  const below = () => scrollY >= pageTop() - 13;
  document.addEventListener("touchstart", (e) => { pullY = e.touches[0].clientY; pulled = false; }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!atRest() || pullY === null || e.target.closest(".panel")) return;
    const dy = e.touches[0].clientY - pullY;
    if (dy < 0 && below()) { e.preventDefault(); pulled = dy < -40; }
  }, { passive: false });
  document.addEventListener("touchend", () => { if (pulled && !go.disabled) advance(); pullY = null; pulled = false; });
  window.addEventListener("wheel", (e) => {
    if (!atRest() || e.deltaY <= 0 || !below()) return;
    e.preventDefault(); if (e.timeStamp - wheelAt > 700 && !go.disabled) advance(); wheelAt = e.timeStamp;
  }, { passive: false });
  window.addEventListener("scroll", () => { if (atRest() && !S.sliding && scrollY > pageTop() - 11) scrollTo(0, pageTop() - 12); });""")


if __name__ == "__main__":
    source, output = sys.argv[1], sys.argv[2]
    open(output, "w", encoding="utf-8", newline="").write(engine(mockup_data(open(source, encoding="utf-8", newline="").read())))
    print("mockup source:", output)
