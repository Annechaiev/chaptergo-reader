"""Adapt the owner's reader-library-9.html for phones: plain copy without JavaScript, non-blocking fonts, lighter pictures.

Usage: python build/phone.py source/reader-library-9.html index.html
"""
import base64
import io
import json
import re
import sys

from PIL import Image

import static_copy as builder

source, output = sys.argv[1], sys.argv[2]
page = open(source, encoding="utf-8", newline="").read()
match = re.search(r'(<script type="application/json" id="data">)(.*?)(</script>)', page, re.S)
books = json.loads(match.group(2).replace("<\\/", "</"))["books"]

for book in books:
    for asset, uri in book["img"].items():
        with Image.open(io.BytesIO(base64.b64decode(uri.partition(",")[2]))) as opened:
            picture = opened.convert("RGB")
        picture.thumbnail((builder.PICTURE_WIDTH, builder.PICTURE_WIDTH * 4), Image.LANCZOS)
        out = io.BytesIO()
        picture.save(out, "JPEG", quality=builder.PICTURE_QUALITY, optimize=True)
        book["imageSizes"][asset] = list(picture.size)
        book["img"][asset] = "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")

static, pictures = builder.static_library(books)
slim = [{**b, "img": {k: v for k, v in b["img"].items() if k not in pictures[i]}} for i, b in enumerate(books)]
data = json.dumps({"books": slim}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

nl = "\r\n" if "\r\n" in page else "\n"
edits = [
    ('<link rel="preconnect" href="https://fonts.googleapis.com">',
     '<script>document.documentElement.classList.add("js")</script>' + nl
     # An empty icon: without it the browser asks the host for /favicon.ico and logs a 404.
     + '<link rel="icon" href="data:,">' + nl
     # The product is behind a login; its public reader stays out of search results.
     + '<meta name="robots" content="noindex">' + nl + '<link rel="preconnect" href="https://fonts.googleapis.com">'),
    ('<link rel="stylesheet" href="https://fonts.googleapis.com/',
     '<!-- Fonts never hold up the page: an in-app viewer without network or JavaScript reads it in system fonts. -->' + nl
     + '<link rel="stylesheet" media="print" onload="this.media=\'all\'" href="https://fonts.googleapis.com/'),
    ("</style>", nl.join([
        "/* Plain copy for viewers that run no JavaScript (Telegram's file preview, Android HTML viewers): the whole book as one page. */",
        "html:not(.js) #app, .js #static { display: none; }",
        ".static-book, .static-chapter { display: flex; flex-direction: column; gap: 12px; }",
        ".static-book { max-width: 34rem; margin: 0 auto; padding: 8px max(20px, env(safe-area-inset-right, 0px)) 40px max(20px, env(safe-area-inset-left, 0px)); }",
        ".static-chapter { padding-top: 24px; }",
        ".static a.book-card { grid-template-columns: minmax(0, 1fr); color: inherit; text-decoration: none; }",
        ".static-toc { display: grid; }",
        ".static a.small { color: var(--link); align-self: start; display: inline-flex; align-items: center; }",
        ".static .opt { display: grid; place-items: center; padding: 6px 10px; text-align: center; }",
        "</style>"])),
    ('<script type="application/json" id="data">', static + nl + nl + '<script type="application/json" id="data">'),
    ('  const $ = (id) => document.getElementById(id);', nl.join([
        '  const $ = (id) => document.getElementById(id);',
        '  // Every shown picture is embedded once, in the plain copy; the reader takes it from there and drops the copy.',
        '  $("static").querySelectorAll("img[data-asset]").forEach((img) => { books[+img.dataset.book].img[img.dataset.asset] = img.getAttribute("src"); });',
        '  $("static").remove();'])),
]
head, tail = page[:match.start(2)], page[match.end(2):]
for old, new in edits:
    where = "head" if old in head else "tail"
    text = head if where == "head" else tail
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique: {old!r}")
    if where == "head":
        head = head.replace(old, new)
    else:
        tail = tail.replace(old, new)
open(output, "w", encoding="utf-8", newline="").write(head + data + tail)
print(f"{len((head + data + tail).encode('utf-8')):,} bytes: {output}")
