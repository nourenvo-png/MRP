#!/bin/sh
cd "$(dirname "$0")"
echo "http://localhost:5173"
if command -v python3 >/dev/null; then
  if [ ! -f sync-config.json ]; then
    python3 -m pip install --quiet msoffcrypto-tool pyxlsb openpyxl
    python3 excel_sync.py
    echo "Fill in sync-config.json (Excel path + password), then run this again."; exit 1
  fi
  python3 excel_sync.py & SYNC=$!
  trap 'kill $SYNC 2>/dev/null' EXIT
  python3 -m http.server 5173
else
  npx --yes serve -l 5173 .
fi
