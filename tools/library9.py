"""Five-book test library (owner 24.10): Хамелеон byte for byte from the published library + the four rebuilt exports.

Standard path (feedback_chaptergo_test_reader_standard): build.py export_book per export folder, template
source/reader-library-9.html at the reader repo's HEAD, build/phone.py. Writes <scratch>/library-5.html and evidence JSON.
"""
import base64
import copy
import hashlib
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

SCRATCH = Path(__file__).parent
READER = Path("C:/Temp/claude/chaptergo-reader")
OUT = Path("D:/Projects/_wt/cg-oo-run/out")
DEMO = Path("D:/Projects/_wt/cg-oo-run/avatars-demo")
FOLDERS = {name: OUT / f"export-{name}" for name in (sys.argv[1:] or ["hobbit", "karl", "nar4", "sys1"])}
GENRES = {"hobbit": ["Фентезі", "Пригоди"], "karl": ["Казка", "Пригоди"], "nar4": ["Любовний роман"], "sys1": ["ЛітРПГ", "Фентезі"]}
ORDER = [name for name in ("hobbit", "karl", "nar4", "sys1") if name in FOLDERS]
sys.path.insert(0, "C:/Users/ASUS/.claude/docs/chaptergo/asus-harness")
import build  # noqa: E402

DATA = re.compile(r'(<script type="application/json" id="data">)(.*?)(</script>)', re.S)


def data(html):
    return json.loads(DATA.search(html)[2].replace("<\\/", "</"))


class Pictures(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.images = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "img" and "data-asset" in a:
            self.images[(int(a["data-book"]), a["data-asset"])] = a["src"]


report = {"undrawnInsidePictures": {}}
for name, folder in FOLDERS.items():
    chat = json.loads((folder / "chat.json").read_text(encoding="utf-8"))
    chapters = sorted({e["chapter"] for e in chat["episodes"]})
    assert chapters == list(range(1, len(chapters) + 1)), (name, "chapters must run from 1", chapters)
    for ch in chapters:
        eps = [e for e in chat["episodes"] if e["chapter"] == ch]
        slots = {n["mediaSlotId"] for e in eps for n in e["graph"]["nodes"] if n["kind"] == "image"}
        drawn = {slot for e in eps for slot in e["pictures"]}
        assert "picture" in slots and "picture" in drawn, (name, ch, "chapter picture not drawn")
        assert all((folder / "pictures" / f"{asset}.png").exists() for e in eps for asset in e["pictures"].values()), (name, ch)
        if slots - drawn:
            report["undrawnInsidePictures"][f"{name} ch{ch}"] = sorted(slots - drawn)
    counts = {}
    for e in chat["episodes"]:
        for n in e["graph"]["nodes"]:
            if n.get("speaker") not in (None, "narrator", "system") and not str(n.get("speaker")).startswith("role:"):
                counts[n["speaker"]] = counts.get(n["speaker"], 0) + 1
    missing = [k for k, n in counts.items() if n >= 5 and k in chat["speakers"] and not chat["speakers"][k].get("assetId")]
    assert not missing, (name, "main portrait missing", missing)

published = (READER / "library/index.html").read_text(encoding="utf-8")
published_data = data(published)
khameleon = copy.deepcopy(next(b for b in published_data["books"] if b["id"] == "khameleon3-1"))
k_index = published_data["books"].index(next(b for b in published_data["books"] if b["id"] == "khameleon3-1"))
k_images = {asset: uri for (number, asset), uri in Pictures(published).images.items() if number == k_index}
assert k_images, "Хамелеон images not found in the published library"
khameleon["img"] = {**khameleon.get("img", {}), **k_images}  # phone.py moved the data URIs into <img> tags; the builder needs them back
books = [khameleon]
for name in ORDER:
    folder = FOLDERS[name]
    chat = json.loads((folder / "chat.json").read_text(encoding="utf-8"))
    # The standard library builder places the chapter picture right under the chapter title (library8.py).
    for ch in sorted({e["chapter"] for e in chat["episodes"]}):
        g = next(e for e in chat["episodes"] if e["chapter"] == ch)["graph"]
        pic = next((n for n in g["nodes"] if n["kind"] == "image" and n["mediaSlotId"] == "picture"), None)
        if pic and g["startNodeId"] != pic["nodeId"]:
            for n in g["nodes"]:
                if n.get("nextNodeId") == pic["nodeId"]:
                    n["nextNodeId"] = pic.get("nextNodeId")
            pic["nextNodeId"], g["startNodeId"] = g["startNodeId"], pic["nodeId"]
    raw = (folder / "chat.json").read_bytes()
    try:
        (folder / "chat.json").write_text(json.dumps(chat, ensure_ascii=False), encoding="utf-8")
        book = build.export_book(folder)
    finally:
        (folder / "chat.json").write_bytes(raw)
    book["mode"] = "pages"
    book["genres"] = GENRES[name]
    if name == "karl":
        # Owner's one-off demo recolour (24.10): only the built file gets it, never out/export-karl.
        demo = {a: DEMO / f"{a}.png" for a in book["img"] if (DEMO / f"{a}.png").is_file()}
        assert demo, "no recoloured Karlson avatars in " + str(DEMO)
        for asset, png in demo.items():
            book["img"][asset] = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode("ascii")
        report["demoAvatars"] = sorted(demo)
    books.append(book)

template = subprocess.check_output(["git", "-C", str(READER), "show", "HEAD:source/reader-library-9.html"], text=True, encoding="utf-8")
payload = json.dumps({"books": books}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
source, n = DATA.subn(lambda m: m[1] + payload + m[3], template, count=1)
assert n == 1
sourcepath = SCRATCH / "reader-source-5.html"
sourcepath.write_text(source, encoding="utf-8")
dest = SCRATCH / "library-5.html"
subprocess.run([sys.executable, str(READER / "build/phone.py"), str(sourcepath), str(dest)], check=True)
# phone.py recompresses every image: restore Хамелеон's data and image URIs byte for byte from the published library.
rendered = dest.read_text(encoding="utf-8")
final = data(rendered)
final["books"][0] = published_data["books"][k_index]
for asset, uri in k_images.items():
    pattern = r'(<img data-book="0" data-asset="' + re.escape(asset) + r'" src=")[^"]*(")'
    rendered, count = re.subn(pattern, lambda m: m[1] + uri + m[2], rendered)
    assert count >= 1, (asset, count)
newdata = json.dumps(final, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
rendered = DATA.sub(lambda m: m[1] + newdata + m[3], rendered, count=1)
dest.write_text(rendered, encoding="utf-8")
assert data(rendered)["books"][0] == published_data["books"][k_index]
assert {a: u for (b, a), u in Pictures(rendered).images.items() if b == 0} == k_images
assert '<meta name="robots" content="noindex">' in rendered
report.update({"books": [(b["title"], len(b["chapters"]), len(b["img"]), b.get("genres")) for b in final["books"]],
               "path": str(dest), "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
               "readerHead": subprocess.check_output(["git", "-C", str(READER), "rev-parse", "HEAD"], text=True).strip()})
(SCRATCH / "library-5-evidence.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
