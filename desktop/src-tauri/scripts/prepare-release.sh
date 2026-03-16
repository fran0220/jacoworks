#!/usr/bin/env bash
# ============================================================================
# prepare-release.sh — Unified desktop release preparation
#
# Single source of truth for: sidecar placement, doc-packages bundling,
# bundled runtimes (Python all-platform, bash/bun Windows-only),
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
RUNTIMES_DIR="$RESOURCES_DIR/runtimes"

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
elif [[ -f "$SIDECAR_DEST" ]] && [[ $(stat -f%z "$SIDECAR_DEST" 2>/dev/null || stat -c%s "$SIDECAR_DEST" 2>/dev/null || echo 0) -gt 1024 ]]; then
  echo "📦 Sidecar already exists, skipping compilation"
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

# ─── 6. Bundled Python (ALL platforms — guaranteed available) ────

# python-build-standalone: self-contained CPython for all targets.
# https://github.com/indygreg/python-build-standalone
PYTHON_VERSION="3.12.8"
PBS_RELEASE="20241219"
PBS_BASE_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PBS_RELEASE}"

# Map Rust/Tauri target triple → python-build-standalone archive name
case "$TARGET" in
  aarch64-apple-darwin)
    PBS_ARCHIVE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz" ;;
  x86_64-apple-darwin)
    PBS_ARCHIVE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-apple-darwin-install_only_stripped.tar.gz" ;;
  x86_64-pc-windows-msvc)
    PBS_ARCHIVE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz" ;;
  aarch64-unknown-linux-gnu)
    PBS_ARCHIVE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz" ;;
  x86_64-unknown-linux-gnu)
    PBS_ARCHIVE="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz" ;;
  *)
    echo "❌ Unsupported target for python-build-standalone: $TARGET"
    exit 1 ;;
esac

PYTHON_DIR="$RUNTIMES_DIR/python"

# Stamp file to ensure target-specific Python (prevent arm64/x86_64 contamination)
PYTHON_STAMP="$PYTHON_DIR/.pbs-stamp"
EXPECTED_STAMP="${TARGET}|${PBS_ARCHIVE}"

# Check if already populated AND matches current target
if [[ "$TARGET" == *"windows"* ]]; then
  PYTHON_CHECK="$PYTHON_DIR/python.exe"
else
  PYTHON_CHECK="$PYTHON_DIR/bin/python3"
fi

NEED_DOWNLOAD=true
if [[ -f "$PYTHON_CHECK" ]] && [[ -f "$PYTHON_STAMP" ]] && [[ "$(cat "$PYTHON_STAMP" 2>/dev/null)" == "$EXPECTED_STAMP" ]]; then
  echo "  ✅ Python: already populated (matches $TARGET)"
  NEED_DOWNLOAD=false
fi

if $NEED_DOWNLOAD; then
  echo "📦 Downloading python-build-standalone for $TARGET..."
  PBS_DOWNLOAD="$TMPD/$PBS_ARCHIVE"
  curl -L --progress-bar -o "$PBS_DOWNLOAD" "${PBS_BASE_URL}/${PBS_ARCHIVE}"

  # Always clean and re-extract to prevent stale/wrong-arch contamination
  rm -rf "$PYTHON_DIR"
  mkdir -p "$RUNTIMES_DIR"
  tar -xzf "$PBS_DOWNLOAD" -C "$RUNTIMES_DIR"
  # The archive extracts as "python/" which is exactly our target dir name

  if [[ ! -f "$PYTHON_CHECK" ]]; then
    echo "❌ Python extraction failed: $PYTHON_CHECK not found"
    ls -la "$PYTHON_DIR/" 2>/dev/null || echo "   (directory does not exist)"
    exit 1
  fi

  # Strip unnecessary files to reduce bundle size (~100MB → ~50MB)
  find "$PYTHON_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
  find "$PYTHON_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
  find "$PYTHON_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/tkinter" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/idlelib" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/turtle"* 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/ensurepip" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/lib2to3" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/distutils" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/tkinter" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/idlelib" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/turtle"* 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/ensurepip" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/lib2to3" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/distutils" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/test" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/include" 2>/dev/null || true
  find "$PYTHON_DIR" -name "*.pyc" -delete 2>/dev/null || true
  find "$PYTHON_DIR" -name "*.pyo" -delete 2>/dev/null || true

  PYTHON_SIZE=$(du -sh "$PYTHON_DIR" | cut -f1)
  echo "  ✅ Python: $PYTHON_VERSION ($PYTHON_SIZE)"

  # Write stamp so next run with same target can skip download
  echo "$EXPECTED_STAMP" > "$PYTHON_STAMP"
fi

# ─── 6b. Sign Python binaries for macOS notarization ────────────
# NOTE: This pre-signs in the source tree. For maximum reliability,
# also sign inside the final .app bundle before outer app signing.
# See Makefile release target for post-bundle signing step.

if [[ "$TARGET" == *"apple-darwin"* ]]; then
  SIGN_ID="${APPLE_SIGNING_IDENTITY:-Developer ID Application: fan Z (9UUWCMKMDH)}"
  echo "🔏 Signing Python binaries with: $SIGN_ID"

  SIGN_COUNT=0
  # Sign ALL Mach-O files — not just by extension, but by actual file type detection.
  # python-build-standalone may include executables without standard extensions.
  while IFS= read -r -d '' binary; do
    if file "$binary" | grep -q "Mach-O"; then
      codesign --force --options runtime --timestamp \
        --sign "$SIGN_ID" "$binary" 2>/dev/null && \
        SIGN_COUNT=$((SIGN_COUNT + 1)) || \
        echo "  ⚠️  Failed to sign: $binary"
    fi
  done < <(find "$PYTHON_DIR" -type f \( -name "*.dylib" -o -name "*.so" -o -name "*.bundle" -o -name "python*" -o -perm +111 \) -print0 2>/dev/null)

  echo "  ✅ Signed $SIGN_COUNT Python binaries"
fi

# ─── 7. Windows runtimes (bash + bun) ───────────────────────────

if [[ "$TARGET" == *"windows"* ]]; then
  echo ""
  echo "📦 Checking Windows runtimes (bash + bun)..."

  BASH_OK=false
  BUN_OK=false
  [[ -f "$RUNTIMES_DIR/bash/bash.exe" ]] && BASH_OK=true
  [[ -f "$RUNTIMES_DIR/node/bun.exe" ]] && BUN_OK=true

  if $BASH_OK && $BUN_OK; then
    echo "  ✅ runtimes/bash + runtimes/node already populated"
  else
    echo "  ⚠️  Missing runtimes — running prepare-win-deps.sh..."
    bash "$SCRIPT_DIR/prepare-win-deps.sh"
  fi

  # Final check: MUST have bash + bun for Windows — fail hard
  if [[ ! -f "$RUNTIMES_DIR/bash/bash.exe" ]]; then
    echo "❌ runtimes/bash/bash.exe missing — Windows build cannot proceed"
    exit 1
  fi
  if [[ ! -f "$RUNTIMES_DIR/node/bun.exe" ]]; then
    echo "❌ runtimes/node/bun.exe missing — Windows build cannot proceed"
    exit 1
  fi
fi

echo ""
echo "✅ Release preparation complete for $TARGET"
