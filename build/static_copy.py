"""Plain readable copy of the books for viewers that run no JavaScript (Telegram file preview, Android HTML viewers)."""
import html

PICTURE_WIDTH, PICTURE_QUALITY = 720, 70  # phones show pictures at most ~430 CSS px wide; in-app viewers choke on heavy files


def esc(text):
    return html.escape(str(text or ""))


def static_row(book, key, name, text, cls=""):
    """A speaker's line as the reader's line() draws it, with the letter avatar instead of the portrait."""
    letter = ((book["speakers"].get(key) or {}).get("name") or name or "?")[0]
    marker = '<span class="thought-marker" role="img" aria-label="Думка">◌ </span>' if cls == "thought" else ""
    return (f'<div class="row {cls}"><span class="who">{marker}{esc(name)}</span><span class="ava">{esc(letter)}</span>'
            f'<div class="bub">{esc(text)}</div></div>')


def static_line(book, n):
    """One shown node as the reader's render() draws it."""
    if n.get("role") == "plate":
        return f'<p class="plate">{esc(n["text"])}</p>'
    if n.get("role") == "break":
        # The reader in source/ predates the divider: its render() draws a break as an empty narration paragraph.
        return '<p class="narr"></p>'
    thought = n.get("presentation") == "thought"
    if n.get("speaker") == "narrator" and not thought:
        return f'<p class="narr">{esc(n["text"])}</p>'
    return static_row(book, n.get("speaker"), n.get("voiceName"), n["text"], "thought" if thought else "")


def static_chapter(book, bi, ci, chapter, pictures):
    """The chapter read straight through, taking each choice's first option, for viewers that run no JavaScript."""
    def picture(n):
        width, height = book["imageSizes"][n["asset"]]
        pictures.add(n["asset"])
        return (f'<figure class="pic"><img data-book="{bi}" data-asset="{esc(n["asset"])}" src="{book["img"][n["asset"]]}" '
                f'width="{width}" height="{height}" alt=""></figure>')
    num, _, rest = chapter["title"].partition(". ")
    out = [f'<section class="static-chapter" id="b{bi}c{ci}"><p class="ch-kicker">{esc(num)}</p><h1 class="ch-title">{esc(rest)}</h1>']
    # As the reader's openingPicture(): a picture that opens the chapter goes under its title.
    first = chapter["episodes"][0]
    opening = first["nodes"].get(first["start"])
    while opening and opening.get("role") in ("break", "plate"):
        opening = first["nodes"].get(opening.get("nextNodeId"))
    opening = opening if opening and opening["kind"] == "image" else None
    if opening:
        out.append(picture(opening))
    for episode in chapter["episodes"]:
        n = episode["nodes"][episode["start"]]
        while n:
            if n["kind"] == "image":
                if n is not opening:
                    out.append(picture(n))
            elif n["kind"] == "choice":
                chooser = n.get("chooser") or book.get("firstPersonTeller")
                name = n.get("chooserName") or (book["speakers"].get(chooser) or {}).get("name", "")
                head = f'<div class="chooser">Вибір: {esc(name)}</div>' if chooser else ""
                options = "".join(f'<span class="opt">{esc(c["label"])}</span>' for c in n["choices"])
                out.append(f'<div class="choice">{head}<p>{esc(n["prompt"])}</p><div class="opts">{options}</div></div>')
                out.append(static_row(book, chooser, name, n["choices"][0]["label"], "picked"))
                n = episode["nodes"].get(n["choices"][0]["targetNodeId"])
                continue
            else:
                out.append(static_line(book, n))
            if n["kind"] == "ending":
                break
            n = episode["nodes"].get(n.get("nextNodeId"))
    out.append(f'<div class="end-mark">· Кінець: {esc(num)} ·</div><a class="small" href="#static">← Бібліотека</a></section>')
    return "".join(out)


def static_library(books):
    """Plain readable copy of every book; when JavaScript runs, the reader takes its pictures from here and removes it."""
    cards, bodies, pictures = [], [], [set() for _ in books]
    for bi, book in enumerate(books):
        meta = (f"{esc(book.get('author'))}<br>" if book.get("author") else "") + ("Розділи готуються" if book.get("pending") else f"Розділів: {len(book['chapters'])}")
        info = f'<span class="book-info"><b>{esc(book["title"])}</b><span class="book-meta">{meta}</span>'
        if book.get("pending"):
            cards.append(f'<div class="book-card">{info}<span class="book-action">Готується</span></span></div>')
            continue
        cards.append(f'<a class="book-card" href="#b{bi}">{info}<span class="book-action">Читати</span></span></a>')
        toc = "".join(f'<a class="small" href="#b{bi}c{ci}">{esc(c["title"])}</a>' for ci, c in enumerate(book["chapters"]))
        chapters = "".join(static_chapter(book, bi, ci, c, pictures[bi]) for ci, c in enumerate(book["chapters"]))
        bodies.append(f'<article class="static-book" id="b{bi}"><h2 class="ch-title">{esc(book["title"])}</h2><nav class="static-toc">{toc}</nav>{chapters}</article>')
    return f'<div class="static" id="static"><main class="library"><h1>Бібліотека</h1>{"".join(cards)}</main>{"".join(bodies)}</div>', pictures


