#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
find . -type f -name '*.php' -print0 | xargs -0 -n 1 php -l > /dev/null
for f in tests/test_*.php; do
  php -d zend.assertions=1 -d assert.exception=1 "$f"
done
for f in assets/*.js tests/test_*.js; do
  node --check "$f"
done
for f in tests/test_*.js; do
  node "$f"
done
python3 tests/test_http_flows.py
python3 tests/test_http_inventory.py
python3 tests/test_http_locales.py
if [ "${QRR_BROWSER_TEST:-0}" = "1" ]; then
  python3 tests/test_navigation_browser.py
  python3 tests/test_navigation_overlay_browser.py
  python3 tests/test_workflow_ui_browser.py
fi
printf '%s\n' 'All offline QR Router tests PASSED.'
