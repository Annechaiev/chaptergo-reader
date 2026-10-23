# ChapterGo phone reader

`index.html` is the published page (GitHub Pages, https://annechaiev.github.io/chaptergo-reader/). It is the owner's
reader `source/reader-library-9.html`, made to open on phones, with the reader's behaviour unchanged:

- a plain readable copy of every book for viewers that run no JavaScript (Telegram file preview, Android HTML viewers);
  when JavaScript runs, the reader takes its pictures from that copy and removes it, so pictures are embedded once;
- Google Fonts load without blocking the first paint;
- pictures re-encoded to 720 px JPEG (phones show them at most ~430 CSS px wide);
- an empty icon link, so browsers do not request `/favicon.ico`.

## Build

```bash
pip install pillow
npm run build      # python build/phone.py source/reader-library-9.html index.html
```

To publish a new version of the reader, replace `source/reader-library-9.html`, build, commit `index.html`.

## Test

```bash
npm install
npm test           # bash tests/run.sh [candidate url]
```

`tests/drive.cjs` drives every reader function with touch taps (library, open book, «Далі» reveal timing, typing dots,
menu edge taps, text size, themes, speed, Auto, contents, whole chapter, choices, resume after reload, reread, next
chapter, back to library, landscape, pictures, console errors, overflow) in `source/` and in the candidate, on
iPhone 13 and iPhone SE (WebKit) and Pixel 7 and Galaxy S9+ (Chromium). `tests/compare.py` diffs the two runs per device
(timings with tolerance, everything else exact) and prints PASS/FAIL per function. Set `CHROMIUM_PATH` when the
installed Chromium build differs from the one Playwright expects.

Not covered: real devices (collapsing address bars, notch/home-bar insets, Telegram's in-app browser) and slow networks.
