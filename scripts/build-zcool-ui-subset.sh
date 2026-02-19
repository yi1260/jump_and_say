#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL_FONT="$ROOT_DIR/public/assets/fonts/Zcool/zcool-kuaile-chinese-simplified-400-normal.woff2"
SUBSET_FONT="$ROOT_DIR/public/assets/fonts/Zcool/zcool-kuaile-ui-subset.woff2"
CHAR_LIST="$ROOT_DIR/public/assets/fonts/Zcool/ui_zh_chars.txt"

ROOT_DIR="$ROOT_DIR" python3 - <<'PY'
import os
from pathlib import Path

root = Path(os.environ['ROOT_DIR'])
files = [root / 'App.tsx', root / 'index.html']
files.extend((root / 'components').glob('*.tsx'))

chars = set()
for file_path in files:
    if not file_path.exists():
        continue
    content = file_path.read_text(encoding='utf-8', errors='ignore')
    for char in content:
        if '\u4e00' <= char <= '\u9fff':
            chars.add(char)
    for punct in '，。！？：；、“”‘’（）《》【】—…·':
        if punct in content:
            chars.add(punct)

char_list_path = root / 'public/assets/fonts/Zcool/ui_zh_chars.txt'
char_list_path.write_text(''.join(sorted(chars)), encoding='utf-8')
print(f'[subset] wrote chars: {char_list_path} ({len(chars)} glyphs)')
PY

python3 -m fontTools.subset "$FULL_FONT" \
  --text-file="$CHAR_LIST" \
  --output-file="$SUBSET_FONT" \
  --flavor=woff2 \
  --layout-features='*' \
  --glyph-names \
  --symbol-cmap \
  --legacy-cmap \
  --notdef-glyph \
  --notdef-outline \
  --recommended-glyphs \
  --name-IDs='*' \
  --name-languages='*'

echo "[subset] generated: $SUBSET_FONT"
ls -lh "$FULL_FONT" "$SUBSET_FONT"
