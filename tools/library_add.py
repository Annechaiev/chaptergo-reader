"""Add rebuilt exports to the published library (owner 25.10): every existing book stays byte for byte, new books are
inserted, the order follows ORDER. Usage: python tools/library_add.py <name>=<export folder> ...  (rewrites library/index.html)."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "C:/Users/ASUS/.claude/docs/chaptergo/asus-harness")
import build  # noqa: E402

LIB = Path(__file__).resolve().parent.parent / "library" / "index.html"
DATA = re.compile(r'(<script type="application/json" id="data">)(.*?)(</script>)', re.S)
# Owner 25.10: «хобит вверху, гамлет под ним, кот, … дальше в той последовательности как сейчас».
ORDER = ["hobbit", "hamlet", "kot-uk", "khameleon3-1", "karl", "nar4", "sys1", "kot-ru", "recruit-en"]
META = {
    "hamlet": {"genres": ["Сатира", "П'єса"], "titles": ["Дія перша", "Дія друга"]},
    "kot-uk": {"genres": ["Фантастика", "Пригоди"]},
    "kot-ru": {"genres": ["Фантастика", "Пригоди"], "lang": "ru"},
    "recruit-en": {"genres": ["Пригоди"], "lang": "en"},
}


def picture_first(chat):
    # The library shows a chapter's picture right under its title (same step as library9.py).
    for ch in sorted({e["chapter"] for e in chat["episodes"]}):
        g = next(e for e in chat["episodes"] if e["chapter"] == ch)["graph"]
        pic = next((n for n in g["nodes"] if n["kind"] == "image" and n["mediaSlotId"] == "picture"), None)
        if pic and g["startNodeId"] != pic["nodeId"]:
            for n in g["nodes"]:
                if n.get("nextNodeId") == pic["nodeId"]:
                    n["nextNodeId"] = pic.get("nextNodeId")
            pic["nextNodeId"], g["startNodeId"] = g["startNodeId"], pic["nodeId"]


def new_book(name, folder):
    path = folder / "chat.json"
    raw = path.read_bytes()
    chat = json.loads(raw)
    picture_first(chat)
    try:
        path.write_text(json.dumps(chat, ensure_ascii=False), encoding="utf-8")
        book = build.export_book(folder)
    finally:
        path.write_bytes(raw)
    meta = META.get(name, {})
    book.update(id=name, mode="pages", genres=meta.get("genres", []))
    if "lang" in meta:
        book["lang"] = meta["lang"]
    for chapter, title in zip(book["chapters"], meta.get("titles", [])):
        chapter["title"] = chapter["title"] or title  # the play's act names; the export leaves them empty
    return book


html = LIB.read_text(encoding="utf-8")
match = DATA.search(html)
old_ids = [b["id"] for b in json.loads(match[2].replace("<\\/", "</"))["books"]]
books = {b["id"]: b for b in json.loads(match[2].replace("<\\/", "</"))["books"]}
for arg in sys.argv[1:]:
    name, folder = arg.split("=", 1)
    books[name] = new_book(name, Path(folder))
assert set(books) <= set(ORDER), sorted(set(books) - set(ORDER))
ordered = [books[k] for k in ORDER if k in books]
payload = json.dumps({"books": ordered}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = html[:match.start(2)] + payload + html[match.end(2):]
# Pictures of the older books sit outside the data as <img data-book="<position>">: follow each book to its new position.
new_index = {book_id: str(i) for i, book_id in enumerate(k for k in ORDER if k in books)}
html = re.sub(r'(<img data-book=")(\d+)(")', lambda m: m[1] + new_index[old_ids[int(m[2])]] + m[3], html)
LIB.write_text(html, encoding="utf-8")
print([(b["id"], b["title"], b.get("lang", "uk"), len(b["chapters"])) for b in ordered])
