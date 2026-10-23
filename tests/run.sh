#!/usr/bin/env bash
# Parity: drives every reader function in source/ (the reference) and in a candidate page on two iPhones (WebKit)
# and two Androids (Chromium), then diffs them. Usage: tests/run.sh [candidate url, default: the built index.html]
set -euo pipefail
cd "$(dirname "$0")"
url() { node -e "console.log(require('url').pathToFileURL(require('path').resolve(process.argv[1])).href)" "$1"; }
REF="$(url ../source/reader-library-9.html)"
PUB="${1:-$(url ../index.html)}"
mkdir -p out
for d in "webkit|iPhone 13|i13" "webkit|iPhone SE|se" "chromium|Pixel 7|px7" "chromium|Galaxy S9+|s9"; do
  IFS='|' read -r eng dev tag <<<"$d"
  node drive.cjs "$eng" "$dev" "$REF" "out/ref-$tag.json" &
  ref_pid=$!
  node drive.cjs "$eng" "$dev" "$PUB" "out/pub-$tag.json" &
  pub_pid=$!
  status=0
  wait "$ref_pid" || status=1
  wait "$pub_pid" || status=1
  (( status == 0 )) || exit 1
done
(cd out && python ../compare.py i13 se px7 s9)
node pages.cjs "$PUB"
