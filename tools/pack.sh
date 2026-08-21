#!/usr/bin/env bash
# Build the Chrome Web Store upload package.
#
# Zips the CONTENTS of shelf/ — the store expects manifest.json at the archive root, not
# inside a folder. Everything outside shelf/ (PRD, TRD, DECISIONS, design/, test/, tools/,
# package.json, node_modules) is excluded by construction rather than by an ignore list,
# which is the whole reason the extension lives in its own directory.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json;print(json.load(open('shelf/manifest.json'))['version'])")
OUT="dist/shelf-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# -x excludes macOS metadata that would otherwise ship and look sloppy in review.
( cd shelf && zip -qr "../$OUT" . -x '.DS_Store' -x '__MACOSX/*' -x '*/.DS_Store' )

echo "built  $OUT"
echo "size   $(du -h "$OUT" | cut -f1)"
echo
echo "contents:"
unzip -Z1 "$OUT" | sort | sed 's/^/  /'
