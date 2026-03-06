#!/usr/bin/env bash
# ============================================================================
# check-versions.sh — Validate version consistency across all manifests
#
# Checks tauri.conf.json vs Cargo.toml, and optionally vs git tag.
# Exits non-zero on mismatch.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"

# Extract version from tauri.conf.json (source of truth)
TAURI_VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

# Extract version from Cargo.toml
CARGO_VERSION=$(grep '^version' "$TAURI_DIR/Cargo.toml" | head -1 | sed 's/.*= *"\([^"]*\)".*/\1/')

echo "📋 Version check:"
echo "  tauri.conf.json: $TAURI_VERSION"
echo "  Cargo.toml:      $CARGO_VERSION"

ERRORS=0

if [[ "$TAURI_VERSION" != "$CARGO_VERSION" ]]; then
  echo "❌ tauri.conf.json ($TAURI_VERSION) != Cargo.toml ($CARGO_VERSION)"
  ERRORS=$((ERRORS + 1))
fi

# If git tag is available (CI release), check against it
if [[ -n "${GITHUB_REF_NAME:-}" ]] && [[ "$GITHUB_REF_NAME" == v* ]]; then
  TAG_VERSION="${GITHUB_REF_NAME#v}"
  echo "  Git tag:         $TAG_VERSION"
  if [[ "$TAURI_VERSION" != "$TAG_VERSION" ]]; then
    echo "❌ tauri.conf.json ($TAURI_VERSION) != git tag ($TAG_VERSION)"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "❌ Version mismatch detected! Fix before releasing."
  exit 1
fi

echo "✅ All versions consistent: $TAURI_VERSION"
