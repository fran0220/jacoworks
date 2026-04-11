---
name: releasing-desktop
description: "Releases JAcoworks Desktop (Tauri) — version bump, macOS/Windows build, COS upload, DB registration, git tag. Use when the user says 'release', 'publish', '发版', '发布版本', or mentions a version number like 'v1.6.1'."
---

# Releasing JAcoworks Desktop

End-to-end release workflow for the Tauri desktop app. Covers macOS (arm64 + x86_64) and Windows (x64) builds.

## Prerequisites

Verify before starting — **do NOT skip**:

1. `deploy/.env.release` exists (secrets: COS, DB, Tauri signing, Apple certs)
2. `rustup target list --installed` includes `x86_64-apple-darwin`
3. Apple signing identity in Keychain: `Developer ID Application: fan Z (9UUWCMKMDH)`
4. SSH tunnel for DB: `ssh -L 5432:127.0.0.1:5432 jingao -N -f`
5. win-build VM running: `ssh local 'virsh domifaddr win-build'`

## Release Workflow

Execute these steps **in order**. Each step must succeed before proceeding.

### Step 1: Commit & Push

Stage only files related to the release. Never `git add -A`.

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push origin main
```

### Step 2: Bump Version

```bash
make release-bump V=<version>
# Verify:
grep '"version"' desktop/src-tauri/tauri.conf.json
```

Then commit and push the bump:

```bash
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml
git commit -m "chore(desktop): bump version to <version>"
git push origin main
```

### Step 3: Build macOS (arm64 + x86_64)

```bash
make release-build V=<version>
```

This compiles sidecars (3 targets), prepares resources, signs, notarizes, and produces DMGs.
Output: `dist-release/<version>/darwin-{aarch64,x86_64}/`

Expected artifacts per platform:
- `JAcoworks.app.tar.gz` (updater bundle)
- `JAcoworks.app.tar.gz.sig` (updater signature)
- `JAcoworks_<version>_{aarch64,x64}.dmg` (installer)

### Step 4: Build Windows (win-build VM)

The VM is at 192.168.122.177 (NAT), accessed via `local` (100.97.254.31) SSH jump host.
User: `builder`, password: `build2026`.

**One-step build** (recommended): The VM has a `C:\build\build-release.ps1` script that handles
git pull, sidecar compilation, resource preparation, and Tauri build in one shot:

```bash
# 4a. Run the one-step build on VM
ssh local 'sshpass -p "build2026" ssh -o StrictHostKeyChecking=no builder@192.168.122.177 \
  "powershell -ExecutionPolicy Bypass -File C:\\build\\build-release.ps1"'

# 4b. Pull artifacts back
VERSION=<version>
mkdir -p dist-release/${VERSION}/windows-x86_64
ssh local 'sshpass -p "build2026" scp -o StrictHostKeyChecking=no \
  builder@192.168.122.177:"C:/build/jacoworks/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/JAcoworks_*_x64-setup.exe" /tmp/'
ssh local 'sshpass -p "build2026" scp -o StrictHostKeyChecking=no \
  builder@192.168.122.177:"C:/build/jacoworks/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/JAcoworks_*_x64-setup.exe.sig" /tmp/'
scp local:/tmp/JAcoworks_*_x64-setup.exe dist-release/${VERSION}/windows-x86_64/
scp local:/tmp/JAcoworks_*_x64-setup.exe.sig dist-release/${VERSION}/windows-x86_64/
```

**Signing**: Keys are stored at `C:\build\tauri-signing.b64` and `C:\build\tauri-signing-pass.txt`.
The build script reads them automatically via `Get-Content`.

**VM tools**: Git 2.47.1, Rust 1.94.1, Node.js 22.16.0, Bun 1.2.13, VS Build Tools 2022, NSIS 3.10, tauri-cli 2.10.1.

### Step 5: Upload COS + Register DB + Git Tag

```bash
make release-upload V=<version>
git push origin v<version>
```

This uploads all 3 platforms to COS, registers the release in PostgreSQL (`releases` + `release_assets` tables, `is_latest=true`), and creates a git tag.

If you get `mktemp: mkstemp failed on /tmp/cos-release-XXXX.yaml: File exists`, run:
```bash
rm -f /tmp/cos-release-*.yaml
```

### Step 6: Update Release Notes (optional)

Via admin panel or SQL:
```bash
source deploy/.env.release
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U postgres -d jacoworks \
  -c "UPDATE releases SET notes = '...' WHERE version = 'v<version>';"
```

### Step 7: Deploy Gateway + Website

```bash
make deploy
```

Makes the new release visible on the download page and enables updater API.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `mkstemp failed` during upload | `rm -f /tmp/cos-release-*.yaml` |
| Windows build: `Wrong password for that key` | Use PowerShell `$env:` injection, not cmd `set` |
| Windows build: `no private key` | Must set both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Notarization timeout | Retry or set `SKIP_NOTARIZE=1` for testing |
| DB unreachable | `ssh -L 5432:127.0.0.1:5432 jingao -N -f` |
| VM not running | `ssh local 'virsh start win-build'` then wait 60s |

## Makefile Quick Reference

```bash
make release-bump V=X.Y.Z      # Bump version only
make release-build V=X.Y.Z     # macOS build (arm64 + x86_64, sign + notarize)
make release-upload V=X.Y.Z    # Upload COS + register DB + git tag
make release V=X.Y.Z           # All-in-one (bump + macOS build + upload, NO Windows)
```

## File Locations

| Item | Path |
|------|------|
| Release script | `deploy/release.sh` |
| Release secrets | `deploy/.env.release` |
| Tauri config | `desktop/src-tauri/tauri.conf.json` |
| Build artifacts | `dist-release/<version>/` |
| COS bucket | `jingao-1350796151` (ap-beijing) |
| Win-build VM | `192.168.122.177` via `local` (100.97.254.31) |
