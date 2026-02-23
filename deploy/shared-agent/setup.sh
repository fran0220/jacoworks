#!/bin/bash
# Deploy shared chat agent on the host machine
# Usage: ssh local "bash -s" < deploy/shared-agent/setup.sh

set -euo pipefail

DEPLOY_DIR="/opt/jacoworks/shared-agent"
SERVICE_NAME="jacoworks-chat-agent"

echo "=== Deploying shared chat agent to $DEPLOY_DIR ==="

# Create directory
mkdir -p "$DEPLOY_DIR"

# Copy vm-agent source (will be synced separately)
echo "Directory: $DEPLOY_DIR"

# Install dependencies & build
cd "$DEPLOY_DIR"
if [ -f package.json ]; then
    npm install --omit=dev 2>&1 | tail -3
    npm run build 2>&1 | tail -3
fi

# Create .env if not exists
if [ ! -f .env ]; then
    echo "⚠️  Create $DEPLOY_DIR/.env with LLM_PROXY_KEY before starting"
fi

# Install systemd service
cp /opt/jacoworks/shared-agent/jacoworks-chat-agent.service /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "=== Done. Start with: systemctl start $SERVICE_NAME ==="
