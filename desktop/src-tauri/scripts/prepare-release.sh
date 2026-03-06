#!/usr/bin/env bash
# ============================================================================
# prepare-release.sh — Unified desktop release preparation
#
# Single source of truth for: sidecar placement, doc-packages bundling,
# skills validation, and resource integrity checks.
#
# Usage:
#   prepare-release.sh <target-triple> [--sidecar-from <path>]
#
# In CI:    --sidecar-from points to pre-built cross-compiled binary
# Locally:  omit --sidecar-from to compile via `bun build --compile`
# ============================================================================
set -euo pipefail

TARGET="${1:?Usage: prepare-release.sh <target-triple> [--sidecar-from <path>]}"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$TAURI_DIR/../.." && pwd)"
BINARIES_DIR="$TAURI_DIR/binaries"
RESOURCES_DIR="$TAURI_DIR/resources"

SIDECAR_FROM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sidecar-from) SIDECAR_FROM="$2"; shift 2 ;;
    *) echo "❌ Unknown option: $1"; exit 1 ;;
  esac
done

echo "🔧 Preparing release for target: $TARGET"
echo ""

# ─── 1. Sidecar binary ──────────────────────────────────────────

mkdir -p "$BINARIES_DIR"
EXT=""
[[ "$TARGET" == *"windows"* ]] && EXT=".exe"
SIDECAR_NAME="vm-agent-${TARGET}${EXT}"
SIDECAR_DEST="$BINARIES_DIR/$SIDECAR_NAME"

if [[ -n "$SIDECAR_FROM" ]]; then
  echo "📦 Copying sidecar from: $SIDECAR_FROM"
  cp "$SIDECAR_FROM" "$SIDECAR_DEST"
else
  echo "📦 Compiling sidecar for current platform..."
  (cd "$REPO_ROOT/vm-agent" && bun build --compile src/index.ts --outfile "$SIDECAR_DEST")
fi
chmod +x "$SIDECAR_DEST" 2>/dev/null || true

# Validate sidecar (real bun-compiled binaries are >> 1KB)
SIDECAR_SIZE=$(stat -f%z "$SIDECAR_DEST" 2>/dev/null || stat -c%s "$SIDECAR_DEST" 2>/dev/null || echo 0)
if [[ "$SIDECAR_SIZE" -lt 1024 ]]; then
  echo "❌ Sidecar binary too small ($SIDECAR_SIZE bytes), likely a placeholder"
  exit 1
fi
echo "  ✅ Sidecar: $SIDECAR_NAME ($(numfmt --to=iec "$SIDECAR_SIZE" 2>/dev/null || echo "${SIDECAR_SIZE}B"))"

# ─── 2. Document processing packages ────────────────────────────

mkdir -p "$RESOURCES_DIR"
DOC_PKG_ARCHIVE="$RESOURCES_DIR/doc-packages.tar.gz"
TMPD=$(mktemp -d)
cleanup() { rm -rf "$TMPD"; }
trap cleanup EXIT

cat > "$TMPD/package.json" <<'EOF'
{
  "private": true,
  "dependencies": {
    "mammoth": "^1.11.0",
    "docx": "^9.6.0",
    "exceljs": "^4.4.0",
    "pdf-lib": "^1.17.1",
    "@pdf-lib/fontkit": "^1.1.1",
    "pdf-parse": "^2.4.5",
    "csv-parse": "^6.1.0"
  }
}
EOF

echo "📦 Installing doc-packages..."
(cd "$TMPD" && npm install --production --no-optional --ignore-scripts --no-audit --no-fund --silent 2>/dev/null)

# Remove native binaries that break Apple notarization
find "$TMPD/node_modules" -name "*.node" -delete 2>/dev/null || true

tar -czf "$DOC_PKG_ARCHIVE" -C "$TMPD" node_modules

DOC_SIZE=$(stat -f%z "$DOC_PKG_ARCHIVE" 2>/dev/null || stat -c%s "$DOC_PKG_ARCHIVE" 2>/dev/null || echo 0)
if [[ "$DOC_SIZE" -lt 102400 ]]; then
  echo "❌ doc-packages.tar.gz too small ($DOC_SIZE bytes), expected > 100KB"
  exit 1
fi
echo "  ✅ doc-packages.tar.gz ($(numfmt --to=iec "$DOC_SIZE" 2>/dev/null || echo "${DOC_SIZE}B"))"

# ─── 3. Validate skills ─────────────────────────────────────────

SKILLS_SRC="$REPO_ROOT/vm-agent/skills"
SKILL_COUNT=$(find "$SKILLS_SRC" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$SKILL_COUNT" -lt 1 ]]; then
  echo "❌ No skill files found in $SKILLS_SRC"
  exit 1
fi
echo "  ✅ Skills: $SKILL_COUNT .md files in vm-agent/skills/"

# ─── 4. Validate fonts (optional, warn only) ────────────────────

if [[ -f "$RESOURCES_DIR/fonts/NotoSansSC-Regular.otf" ]]; then
  echo "  ✅ Fonts: NotoSansSC-Regular.otf"
else
  echo "  ⚠️  Fonts: NotoSansSC-Regular.otf not found (optional)"
fi

# ─── 5. Validate pi-meta ────────────────────────────────────────

if [[ -f "$RESOURCES_DIR/pi-meta/package.json" ]]; then
  echo "  ✅ pi-meta: package.json"
else
  echo "  ⚠️  pi-meta: package.json not found (optional)"
fi

echo ""
echo "✅ Release preparation complete for $TARGET"
