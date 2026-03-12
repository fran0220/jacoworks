#!/bin/bash
# runtime-smoke.sh — quick sanity check for container runtime dependencies
set -euo pipefail

PASS=0
FAIL=0

check() {
  if "$@" > /dev/null 2>&1; then
    echo "✅ $1"
    ((PASS++))
  else
    echo "❌ $1"
    ((FAIL++))
  fi
}

check bun --version
check node --version
check python3 --version
check git --version
check curl --version
check jq --version
check godot --version

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
