"""Reader behaviour mockup (owner 23.10.2026): one library, the same chapter three times — as now, «как мессенджер», «страницы без пустоты».

Usage: python build/mockup.py source/reader-library-9.html mockup/source.html
Then:  python build/phone.py mockup/source.html mockup/index.html
"""
import json
import re
import sys

source, output = sys.argv[1], sys.argv[2]
page = open(source, encoding="utf-8", newline="").read()


def swap(old, new):
    global page
    assert page.count(old) == 1, f"expected one match: {old[:70]!r} ({page.count(old)})"
    page = page.replace(old, new)


# The same chapter three times; the mode rides on the book.
match = re.search(r'(<script type="application/json" id="data">)(.*?)(</script>)', page, re.S)
books = json.loads(match.group(2).replace("<\\/", "</"))["books"]
base = next(b for b in books if b["id"] == "sys1")
modes = [("now", "Как сейчас", "Как у сотрудницы: потяни экран пальцем — под текстом пусто"),
         ("chat", "Вариант 1: как мессенджер", "Новые реплики встают внизу над кнопками, прочитанное уезжает вверх"),
         ("pages", "Вариант 2: страницы без пустоты", "Экран листается, как сейчас; палец вверх — то же, что «Далі»")]
mock = [{**base, "id": f"mock-{mode}", "mode": mode, "title": title, "author": note} for mode, title, note in modes]
data = json.dumps({"books": mock}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
page = page[:match.start(2)] + data + page[match.end(2):]

swap("@keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }",
     "@keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }\n"
     "/* Mockup modes: pages keep the block that does not fit unseen; chat has no empty screen under the newest line. */\n"
     ".later { visibility: hidden; }\n"
     ".m-chat .stream { padding-bottom: calc(var(--dock-h) + 40px + env(safe-area-inset-bottom, 0px)); }\n"
     "/* Chat mode starts at the chapter title: the guide card above it would otherwise open the first screen. */\n"
     ".m-chat #about { display: none; }")

swap('    $("ttlName").textContent = D.title;',
     '    $("ttlName").textContent = D.title;\n    app.classList.toggle("m-chat", D.mode === "chat");')

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
        const k = Math.min(1, (now - start) / (chat ? 260 : 420));
        scrollTo(0, from + (top - from) * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(frame); else { S.sliding = false; resolve(); }
      };""")

swap("    return S.terminal && fits(S.terminal) && S.terminal.offsetTop >= pageTop();",
     '    if (mode() === "chat") return !!S.terminal;\n    return S.terminal && fits(S.terminal) && S.terminal.offsetTop >= pageTop();')

swap("    if (!S.waiting || !S.terminal) return null;",
     '    if (mode() === "chat" || !(S.waiting || mode() === "pages" && S.done) || !S.terminal) return null;')

swap("    S.preview = items().find((el) => el.offsetTop >= S.page.offsetTop && !fits(el)) || null;\n  }",
     """    S.preview = mode() === "chat" ? null : items().find((el) => el.offsetTop >= S.page.offsetTop && !fits(el)) || null;
    // Pages mode: a block that does not fit waits unseen when only a strip is left for it; a big one (a picture) still shows
    // its top, so the screen never stands half empty. A finger pull turns the page either way.
    const hide = mode() === "pages" && !!S.preview && S.preview !== S.page && pageTop() + floor() - S.preview.offsetTop < floor() / 4;
    if (mode() === "pages") items().forEach((el) => el.classList.toggle("later", hide && el.offsetTop >= S.preview.offsetTop));
  }""")

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

open(output, "w", encoding="utf-8", newline="").write(page)
print("mockup source:", output)
