#!/usr/bin/env bash
# ============================================================================
# release.sh — 本地构建 + 发布 JAcoworks Desktop
#
# 在 M4 Mac 上构建 macOS arm64 + x86_64，直接上传 COS，注册数据库。
# Windows 包需在 win-build VM 上单独构建后，运行 upload 阶段上传。
#
# Usage:
#   ./deploy/release.sh <version>               # 完整流程 (构建 + 上传 + 注册)
#   ./deploy/release.sh <version> build          # 仅构建
#   ./deploy/release.sh <version> upload         # 仅上传 + 注册 (含 Windows)
#   ./deploy/release.sh <version> bump           # 仅更新版本号
#
# Prerequisites:
#   1. cp deploy/.env.release.example deploy/.env.release && 填入凭据
#   2. rustup target add x86_64-apple-darwin
#   3. SSH 隧道: ssh -L 5432:127.0.0.1:5432 jingao -N -f
#   4. Apple 签名证书已导入 Keychain
# ============================================================================
set -euo pipefail

VERSION="${1:?Usage: ./deploy/release.sh <version> [build|upload|bump]}"
PHASE="${2:-all}"

# Strip 'v' prefix if provided (v1.5.0 → 1.5.0)
VERSION="${VERSION#v}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$REPO_ROOT/desktop/src-tauri"
DIST_DIR="$REPO_ROOT/dist-release/${VERSION}"

COS_BUCKET="jingao-1350796151"
COS_REGION="ap-beijing"
COS_BASE_URL="https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/releases/v${VERSION}"

TARGETS=(
  "aarch64-apple-darwin:darwin-aarch64:app,dmg"
  "x86_64-apple-darwin:darwin-x86_64:app,dmg"
)

# ─── Load secrets ────────────────────────────────────────────────

ENV_FILE="$REPO_ROOT/deploy/.env.release"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
else
  echo "❌ Missing $ENV_FILE"
  echo "   cp deploy/.env.release.example deploy/.env.release"
  exit 1
fi

# ─── Helpers ─────────────────────────────────────────────────────

log()  { echo ""; echo "═══ $1 ═══"; }
info() { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }
fail() { echo "  ❌ $1"; exit 1; }

ensure_coscli() {
  if command -v coscli &>/dev/null; then return; fi
  echo "📥 Installing coscli..."
  local COSCLI_PATH="$HOME/.local/bin/coscli"
  mkdir -p "$(dirname "$COSCLI_PATH")"
  curl -fsSL "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-arm64" -o "$COSCLI_PATH"
  chmod +x "$COSCLI_PATH"
  export PATH="$HOME/.local/bin:$PATH"
  info "coscli installed → $COSCLI_PATH"
}

ensure_tools() {
  local missing=()
  command -v rustc &>/dev/null || missing+=(rust)
  command -v cargo &>/dev/null || missing+=(cargo)
  command -v bun &>/dev/null   || missing+=(bun)
  command -v npm &>/dev/null   || missing+=(npm)
  if (( ${#missing[@]} > 0 )); then
    fail "Missing tools: ${missing[*]}"
  fi

  # Check x86_64 target
  if ! rustup target list --installed | grep -q x86_64-apple-darwin; then
    echo "📥 Adding x86_64-apple-darwin target..."
    rustup target add x86_64-apple-darwin
  fi
}

# ─── Phase: bump ─────────────────────────────────────────────────

do_bump() {
  log "Bump version → ${VERSION}"

  # tauri.conf.json
  local TAURI_CONF="$TAURI_DIR/tauri.conf.json"
  local CURRENT
  CURRENT=$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')
  if [[ "$CURRENT" != "$VERSION" ]]; then
    sed -i '' "s/\"version\": \"${CURRENT}\"/\"version\": \"${VERSION}\"/" "$TAURI_CONF"
    info "tauri.conf.json: ${CURRENT} → ${VERSION}"
  else
    info "tauri.conf.json: already ${VERSION}"
  fi

  # Cargo.toml
  local CARGO="$TAURI_DIR/Cargo.toml"
  CURRENT=$(grep '^version' "$CARGO" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
  if [[ "$CURRENT" != "$VERSION" ]]; then
    sed -i '' "s/^version = \"${CURRENT}\"/version = \"${VERSION}\"/" "$CARGO"
    info "Cargo.toml: ${CURRENT} → ${VERSION}"
  else
    info "Cargo.toml: already ${VERSION}"
  fi

  # Validate
  bash "$TAURI_DIR/scripts/check-versions.sh" 2>/dev/null || true
}

# ─── Phase: build ────────────────────────────────────────────────

do_build() {
  log "Cross-compile sidecar (all targets)"

  local SIDECAR_DIR="$TAURI_DIR/binaries"
  mkdir -p "$SIDECAR_DIR"

  cd "$REPO_ROOT/vm-agent"
  bun install --frozen-lockfile 2>/dev/null || bun install

  bun build --compile --target=bun-darwin-arm64  src/index.ts --outfile "$SIDECAR_DIR/vm-agent-aarch64-apple-darwin"
  bun build --compile --target=bun-darwin-x64    src/index.ts --outfile "$SIDECAR_DIR/vm-agent-x86_64-apple-darwin"
  bun build --compile --target=bun-windows-x64   src/index.ts --outfile "$SIDECAR_DIR/vm-agent-x86_64-pc-windows-msvc.exe"
  info "Sidecar: 3 targets compiled"

  log "Prepare release resources"

  for entry in "${TARGETS[@]}"; do
    IFS=: read -r TARGET PLATFORM BUNDLES <<< "$entry"
    # Sidecar already compiled to binaries/ above, no --sidecar-from needed
    bash "$TAURI_DIR/scripts/prepare-release.sh" "$TARGET"
    info "Resources prepared: $TARGET"
  done

  log "Install desktop dependencies"
  cd "$REPO_ROOT/desktop"
  npm ci

  log "Build Tauri (macOS arm64 + x86_64)"

  mkdir -p "$DIST_DIR"

  for entry in "${TARGETS[@]}"; do
    IFS=: read -r TARGET PLATFORM BUNDLES <<< "$entry"
    echo ""
    echo "🔨 Building $PLATFORM ($TARGET)..."

    # Export signing env vars for Tauri
    export TAURI_SIGNING_PRIVATE_KEY
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    export APPLE_SIGNING_IDENTITY

    # Notarization (skip with SKIP_NOTARIZE=1)
    if [[ "${SKIP_NOTARIZE:-}" != "1" ]]; then
      export APPLE_ID
      export APPLE_PASSWORD
      export APPLE_TEAM_ID
    else
      unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID 2>/dev/null || true
      echo "  ⚠️  Skipping notarization (SKIP_NOTARIZE=1)"
    fi

    cd "$REPO_ROOT/desktop"
    cargo tauri build --target "$TARGET" --bundles "$BUNDLES"

    # Collect artifacts
    local BUNDLE_DIR="$TAURI_DIR/target/${TARGET}/release/bundle"
    local PLATFORM_DIR="$DIST_DIR/$PLATFORM"
    mkdir -p "$PLATFORM_DIR"

    # DMG
    if [[ -d "${BUNDLE_DIR}/dmg" ]]; then
      cp ${BUNDLE_DIR}/dmg/*.dmg "$PLATFORM_DIR/" 2>/dev/null || true
    fi
    # tar.gz (updater) — only .app.tar.gz, exclude doc-packages
    if [[ -d "${BUNDLE_DIR}/macos" ]]; then
      find "${BUNDLE_DIR}/macos" -name '*.app.tar.gz' -exec cp {} "$PLATFORM_DIR/" \; 2>/dev/null || true
    fi
    # Signatures
    find "${BUNDLE_DIR}" -name '*.sig' -exec cp {} "$PLATFORM_DIR/" \; 2>/dev/null || true

    info "$PLATFORM: $(ls "$PLATFORM_DIR" | wc -l | tr -d ' ') files"
  done

  echo ""
  echo "📦 macOS 构建完成! 产物在: $DIST_DIR/"
  ls -la "$DIST_DIR"/*/
  echo ""
  echo "💡 Windows 包请在 win-build VM 上构建:"
  echo "   1. 复制 sidecar: scp $SIDECAR_DIR/vm-agent-x86_64-pc-windows-msvc.exe builder@192.168.122.98:C:/build/jacoworks/desktop/src-tauri/binaries/"
  echo "   2. 在 VM 上: cd C:\\build\\jacoworks && git pull && cd desktop && npm ci && cargo tauri build --bundles nsis,updater"
  echo "   3. 复制产物: scp builder@192.168.122.98:C:/build/jacoworks/desktop/src-tauri/target/release/bundle/nsis/*.exe $DIST_DIR/windows-x86_64/"
  echo "   4. 复制签名: scp builder@192.168.122.98:C:/build/jacoworks/desktop/src-tauri/target/release/bundle/nsis/*.sig $DIST_DIR/windows-x86_64/"
  echo ""
  echo "   准备好后运行: ./deploy/release.sh ${VERSION} upload"
}

# ─── Phase: upload ───────────────────────────────────────────────

do_upload() {
  log "Upload to COS"

  : "${COS_SECRET_ID:?Set COS_SECRET_ID}"
  : "${COS_SECRET_KEY:?Set COS_SECRET_KEY}"

  ensure_coscli

  # Write coscli config
  local COS_CFG
  COS_CFG=$(mktemp /tmp/cos-release-XXXX.yaml)
  printf 'cos:\n  base:\n    secretid: %s\n    secretkey: %s\n  buckets:\n    - name: %s\n      alias: cos\n      endpoint: cos.%s.myqcloud.com\n' \
    "$COS_SECRET_ID" "$COS_SECRET_KEY" "$COS_BUCKET" "$COS_REGION" > "$COS_CFG"

  if [[ ! -d "$DIST_DIR" ]]; then
    fail "No artifacts at $DIST_DIR — run build first"
  fi

  local UPLOADED=0 FAILED=0

  for PLATFORM_DIR in "$DIST_DIR"/*/; do
    [[ -d "$PLATFORM_DIR" ]] || continue
    local PLATFORM
    PLATFORM=$(basename "$PLATFORM_DIR")
    echo "📦 $PLATFORM:"

    for file in "${PLATFORM_DIR}"*; do
      [[ -f "$file" ]] || continue
      local FILENAME
      FILENAME=$(basename "$file")

      local FILESIZE
      FILESIZE=$(stat -f%z "$file" 2>/dev/null || echo 0)
      local COS_PATH="cos://${COS_BUCKET}/releases/v${VERSION}/${FILENAME}"

      echo "  ⬆️  ${FILENAME} ($(numfmt --to=iec "$FILESIZE" 2>/dev/null || echo "${FILESIZE}B"))"
      if coscli cp -c "$COS_CFG" "$file" "$COS_PATH"; then
        UPLOADED=$((UPLOADED + 1))
      else
        echo "  ❌ Upload failed!"
        FAILED=$((FAILED + 1))
      fi
    done
  done

  rm -f "$COS_CFG"

  echo ""
  echo "📊 Upload: ${UPLOADED} succeeded, ${FAILED} failed"
  if [[ "$FAILED" -gt 0 ]]; then fail "Some uploads failed!"; fi
  if [[ "$UPLOADED" -eq 0 ]]; then fail "No files uploaded!"; fi
  info "All at: ${COS_BASE_URL}/"

  # ── Register in database ──
  log "Register release in DB"

  : "${DB_PASSWORD:?Set DB_PASSWORD}"

  # Check SSH tunnel
  if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    echo "⚠️  数据库不可达，尝试开启 SSH 隧道..."
    ssh -L 5432:127.0.0.1:5432 jingao -N -f 2>/dev/null || true
    sleep 1
    if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
      fail "数据库不可达! 请手动运行: ssh -L 5432:127.0.0.1:5432 jingao -N -f"
    fi
  fi

  local SQL_FILE
  SQL_FILE=$(mktemp)
  cat > "$SQL_FILE" <<SQL
BEGIN;
UPDATE releases SET is_latest = false WHERE is_latest = true;
INSERT INTO releases (id, version, notes, pub_date, is_latest)
  VALUES (gen_random_uuid()::text, 'v${VERSION}', 'See changelog for details.', now(), true)
  ON CONFLICT (version) DO UPDATE SET is_latest = true, notes = EXCLUDED.notes;
SQL

  for PLATFORM_DIR in "$DIST_DIR"/*/; do
    [[ -d "$PLATFORM_DIR" ]] || continue
    local PLATFORM
    PLATFORM=$(basename "$PLATFORM_DIR")

    for file in "${PLATFORM_DIR}"*; do
      [[ -f "$file" ]] || continue
      local FILENAME
      FILENAME=$(basename "$file")
      case "$FILENAME" in *.sig) continue;; esac

      local FILESIZE
      FILESIZE=$(stat -f%z "$file" 2>/dev/null || echo 0)
      local DOWNLOAD_URL="${COS_BASE_URL}/${FILENAME}"

      local SIG=""
      [[ -f "${file}.sig" ]] && SIG=$(cat "${file}.sig")

      cat >> "$SQL_FILE" <<SQL
INSERT INTO release_assets (id, release_id, platform, download_url, signature, file_size)
  SELECT gen_random_uuid()::text, r.id, '${PLATFORM}', '${DOWNLOAD_URL}', '${SIG}', ${FILESIZE}
  FROM releases r WHERE r.version = 'v${VERSION}'
  ON CONFLICT DO NOTHING;
SQL
      echo "  📦 ${PLATFORM} → ${FILENAME}"
    done
  done

  echo "COMMIT;" >> "$SQL_FILE"

  PGPASSWORD="${DB_PASSWORD}" psql -h 127.0.0.1 -U postgres -d jacoworks -v ON_ERROR_STOP=1 < "$SQL_FILE"
  rm -f "$SQL_FILE"
  info "Release v${VERSION} registered (is_latest=true)"
}

# ─── Phase: tag ──────────────────────────────────────────────────

do_tag() {
  log "Git tag"

  cd "$REPO_ROOT"

  if git tag -l "v${VERSION}" | grep -q .; then
    warn "Tag v${VERSION} already exists"
  else
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    info "Tagged v${VERSION}"
    echo "   Push with: git push origin v${VERSION}"
  fi
}

# ─── Main ────────────────────────────────────────────────────────

main() {
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  JAcoworks Desktop — Local Release v${VERSION}        "
  echo "╚══════════════════════════════════════════════════╝"
  echo ""

  ensure_tools

  case "$PHASE" in
    bump)
      do_bump
      ;;
    build)
      do_bump
      do_build
      ;;
    upload)
      do_upload
      do_tag
      ;;
    all)
      do_bump
      do_build
      do_upload
      do_tag
      ;;
    *)
      echo "Usage: ./deploy/release.sh <version> [build|upload|bump|all]"
      exit 1
      ;;
  esac

  echo ""
  echo "🎉 Done!"
}

main
