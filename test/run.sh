#!/usr/bin/env sh
# Run every suite and report a single pass/fail.
#
# Each file boots the real index.html in a headless browser and drives the
# app's own functions — there is no mock of the app anywhere, so a test can
# only pass if the shipped code actually behaves.
#
# Off this machine, point these at your own install:
#   PLAYWRIGHT_MODULE=playwright CHROME_PATH=/path/to/chrome sh test/run.sh
set -u
cd "$(dirname "$0")"

SUITES="syntax-check verify aisle-test sheet-test home-test catalog-test backup-test ai-test cat-test import-test sw-test theme-test update-test history-test insights-test map-test shop-test storemap-test recipe-test recipe-pro-test calendar-test urlaction-test latest-test"
fail=0

for t in $SUITES; do
  printf '%-14s ' "$t"
  out=$(node "$t.js" 2>&1)
  if [ $? -eq 0 ]; then
    printf 'PASS\n'
  else
    printf 'FAIL\n'
    echo "$out" | grep -E '^FAIL' | sed 's/^/    /'
    fail=1
  fi
done

echo
if [ "$fail" -eq 0 ]; then echo "All suites pass."; else echo "Failures above."; fi
exit $fail
