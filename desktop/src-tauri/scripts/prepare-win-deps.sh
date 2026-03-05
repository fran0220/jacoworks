#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# prepare-win-deps.sh
#
# Downloads and prepares minimal Windows dependencies for Tauri bundling:
#   1. Git for Windows portable — extract minimal bash + coreutils
#   2. Standalone bun.exe — plus a node.exe copy (bun can run as node)
#
# Output layout:
#   resources/win-bash/usr/bin/bash.exe
#   resources/win-bash/usr/bin/msys-2.0.dll
#   resources/win-bash/usr/bin/... (coreutils + DLLs)
#   resources/win-bin/bun.exe
#   resources/win-bin/node.exe   (copy of bun.exe)
#
# Designed to run on macOS (cross-compilation prep). Requires: curl, 7z or tar.
# Idempotent: skips downloads if output directories already exist.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/resources"
WIN_BASH_DIR="$RESOURCES_DIR/win-bash"
WIN_BIN_DIR="$RESOURCES_DIR/win-bin"
TMP_DIR="${TMPDIR:-/tmp}/jacoworks-win-deps"

# Git for Windows portable version & URL
# Using PortableGit 64-bit SFX archive (7z self-extracting)
GIT_VERSION="2.47.1"
GIT_RELEASE="v${GIT_VERSION}.windows.1"
GIT_ARCHIVE="PortableGit-${GIT_VERSION}-64-bit.7z.exe"
GIT_URL="https://github.com/git-for-windows/git/releases/download/${GIT_RELEASE}/${GIT_ARCHIVE}"

# Bun version & URL (standalone Windows x64 zip)
BUN_VERSION="1.2.5"
BUN_ZIP="bun-windows-x64.zip"
BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${BUN_ZIP}"

# Coreutils to extract from Git for Windows (MSYS2 usr/bin)
COREUTILS=(
  sed grep find cat ls mkdir rm cp mv
  tar gzip head tail wc sort uniq tee tr cut
  dirname basename env printf echo test true false
  which xargs
)

# Essential MSYS2 DLLs needed by bash and coreutils
MSYS_DLLS=(
  msys-2.0.dll
  msys-iconv-2.dll
  msys-intl-8.dll
  msys-pcre-1.dll
  msys-pcre2-8-0.dll
  msys-gcc_s-seh-1.dll
  msys-stdc++-6.dll
)

# ─── Helper: check for 7z ────────────────────────────────────────────────────

find_7z() {
  # Try common 7z locations on macOS
  for cmd in 7z 7zz /opt/homebrew/bin/7z /usr/local/bin/7z; do
    if command -v "$cmd" &>/dev/null; then
      echo "$cmd"
      return 0
    fi
  done
  return 1
}

# ─── Step 1: Git for Windows (minimal bash + coreutils) ──────────────────────

prepare_win_bash() {
  if [[ -f "$WIN_BASH_DIR/usr/bin/bash.exe" ]]; then
    echo "✅ win-bash already exists, skipping"
    return 0
  fi

  echo "📦 Preparing Git for Windows minimal bash..."

  local SEVENZ
  if ! SEVENZ=$(find_7z); then
    echo "❌ 7z not found. Install with: brew install p7zip"
    echo "   (needed to extract Git for Windows portable archive)"
    exit 1
  fi
  echo "   Using 7z: $SEVENZ"

  # Download the portable archive
  local archive="$TMP_DIR/$GIT_ARCHIVE"
  mkdir -p "$TMP_DIR"

  if [[ -f "$archive" ]]; then
    echo "   Archive already downloaded: $archive"
  else
    echo "   Downloading Git for Windows ${GIT_VERSION} portable..."
    echo "   URL: $GIT_URL"
    curl -L --progress-bar -o "$archive" "$GIT_URL"
    echo "   Downloaded: $(du -h "$archive" | cut -f1)"
  fi

  # Extract to temporary directory
  local extract_dir="$TMP_DIR/git-portable"
  if [[ -d "$extract_dir" ]]; then
    echo "   Cleaning previous extraction..."
    rm -rf "$extract_dir"
  fi

  echo "   Extracting (this may take a moment)..."
  mkdir -p "$extract_dir"
  "$SEVENZ" x -o"$extract_dir" "$archive" -y >/dev/null 2>&1 || {
    echo "❌ Failed to extract archive. The file may be corrupted."
    rm -f "$archive"
    exit 1
  }

  # Create output directory structure
  mkdir -p "$WIN_BASH_DIR/usr/bin"

  # Copy bash.exe
  local git_bin="$extract_dir/usr/bin"
  if [[ ! -f "$git_bin/bash.exe" ]]; then
    echo "❌ bash.exe not found in extracted archive at $git_bin"
    exit 1
  fi

  echo "   Copying bash.exe..."
  cp "$git_bin/bash.exe" "$WIN_BASH_DIR/usr/bin/"

  # Copy essential MSYS2 DLLs
  echo "   Copying MSYS2 DLLs..."
  for dll in "${MSYS_DLLS[@]}"; do
    if [[ -f "$git_bin/$dll" ]]; then
      cp "$git_bin/$dll" "$WIN_BASH_DIR/usr/bin/"
    else
      echo "   ⚠️  DLL not found (may not be needed): $dll"
    fi
  done

  # Copy coreutils
  echo "   Copying coreutils..."
  local copied=0
  local missing=0
  for util in "${COREUTILS[@]}"; do
    if [[ -f "$git_bin/$util.exe" ]]; then
      cp "$git_bin/$util.exe" "$WIN_BASH_DIR/usr/bin/"
      ((copied++))
    else
      echo "   ⚠️  Not found: $util.exe"
      ((missing++))
    fi
  done
  echo "   Copied $copied utilities ($missing not found)"

  # Also copy sh.exe (often a copy of bash.exe, needed by some scripts)
  if [[ -f "$git_bin/sh.exe" ]]; then
    cp "$git_bin/sh.exe" "$WIN_BASH_DIR/usr/bin/"
  fi

  # Copy /etc/profile if it exists (bash startup)
  if [[ -d "$extract_dir/etc" ]]; then
    mkdir -p "$WIN_BASH_DIR/etc"
    for f in profile bash.bashrc; do
      [[ -f "$extract_dir/etc/$f" ]] && cp "$extract_dir/etc/$f" "$WIN_BASH_DIR/etc/"
    done
  fi

  # Show final size
  local size
  size=$(du -sh "$WIN_BASH_DIR" | cut -f1)
  echo "✅ win-bash ready ($size) → $WIN_BASH_DIR"
}

# ─── Step 2: Bun for Windows (+ node.exe alias) ─────────────────────────────

prepare_win_bun() {
  if [[ -f "$WIN_BIN_DIR/bun.exe" && -f "$WIN_BIN_DIR/node.exe" ]]; then
    echo "✅ win-bin already exists, skipping"
    return 0
  fi

  echo "📦 Preparing Bun for Windows..."

  local zip_file="$TMP_DIR/$BUN_ZIP"
  mkdir -p "$TMP_DIR"

  if [[ -f "$zip_file" ]]; then
    echo "   Archive already downloaded: $zip_file"
  else
    echo "   Downloading Bun v${BUN_VERSION} for Windows x64..."
    echo "   URL: $BUN_URL"
    curl -L --progress-bar -o "$zip_file" "$BUN_URL"
    echo "   Downloaded: $(du -h "$zip_file" | cut -f1)"
  fi

  # Extract bun.exe from the zip
  local extract_dir="$TMP_DIR/bun-extract"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"

  echo "   Extracting..."
  unzip -q -o "$zip_file" -d "$extract_dir"

  # Find bun.exe (it's typically inside bun-windows-x64/ subfolder)
  local bun_exe
  bun_exe=$(find "$extract_dir" -name "bun.exe" -type f | head -1)
  if [[ -z "$bun_exe" ]]; then
    echo "❌ bun.exe not found in archive"
    exit 1
  fi

  mkdir -p "$WIN_BIN_DIR"

  # Copy bun.exe
  cp "$bun_exe" "$WIN_BIN_DIR/bun.exe"
  echo "   Copied bun.exe"

  # Create node.exe as a copy of bun.exe (bun supports running as node)
  cp "$bun_exe" "$WIN_BIN_DIR/node.exe"
  echo "   Created node.exe (copy of bun.exe)"

  local size
  size=$(du -sh "$WIN_BIN_DIR" | cut -f1)
  echo "✅ win-bin ready ($size) → $WIN_BIN_DIR"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  JAcoworks — Prepare Windows Dependencies       ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "Output: $RESOURCES_DIR"
  echo ""

  prepare_win_bash
  echo ""
  prepare_win_bun

  echo ""
  echo "════════════════════════════════════════════════════"
  echo "✅ All Windows dependencies ready!"
  echo ""
  echo "  win-bash → $WIN_BASH_DIR"
  echo "  win-bin  → $WIN_BIN_DIR"
  echo ""

  # Cleanup temp files (keep archives for re-runs)
  rm -rf "$TMP_DIR/git-portable" "$TMP_DIR/bun-extract"
  echo "🧹 Cleaned up temporary extraction dirs"
}

main "$@"
