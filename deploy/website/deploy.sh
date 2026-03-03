#!/usr/bin/env bash
set -euo pipefail

# JAcoworks Website Deployment Script
# Usage: ./deploy.sh [host]
# Default host: local (SSH alias)

HOST="${1:-local}"
REMOTE_DIR="/opt/jacoworks/www"
LOCAL_ROOT="$(cd "$(dirname "$0")/../.." && pwd)/website"

echo "=== Building website (release) ==="
cd "$LOCAL_ROOT"
cargo build --release

echo "=== Preparing deploy package ==="
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/www"
cp target/release/jacoworks-website "$TMPDIR/www/"
cp -r content "$TMPDIR/www/"
cp -r static "$TMPDIR/www/"

echo "=== Uploading to $HOST ==="
ssh "$HOST" "mkdir -p $REMOTE_DIR"
ssh "$HOST" "systemctl stop jacoworks-website 2>/dev/null || true"
rsync -avz --delete "$TMPDIR/www/" "$HOST:$REMOTE_DIR/"

echo "=== Installing systemd service ==="
scp "$(dirname "$0")/jacoworks-website.service" "$HOST:/etc/systemd/system/"
ssh "$HOST" "systemctl daemon-reload"
ssh "$HOST" "systemctl enable --now jacoworks-website"

echo "=== Reloading frpc ==="
scp "$(dirname "$0")/../gateway/frpc.toml" "$HOST:/opt/jacoworks/frpc.toml"
ssh "$HOST" "systemctl restart frpc 2>/dev/null || systemctl restart frps 2>/dev/null || true"

rm -rf "$TMPDIR"

echo "=== Done! Website should be live at http://67.230.182.59:9527 ==="
echo "Check status: ssh $HOST 'systemctl status jacoworks-website'"
