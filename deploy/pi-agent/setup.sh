#!/usr/bin/env bash
# JAcoworks — Setup Pi Agent in LXD container
# Usage: ./deploy/pi-agent/setup.sh [container_name]
set -euo pipefail

CONTAINER="${1:-tpl-pi-agent}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🚀 Setting up Pi Agent in container: $CONTAINER"

# 1. Install Node.js 22 (if not present)
echo "📦 Checking Node.js..."
ssh local "lxc exec ${CONTAINER} -- bash -c '
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  node --version
  npm --version
'"

# 2. Create agent user (if not exists)
ssh local "lxc exec ${CONTAINER} -- bash -c '
  id agent &>/dev/null || useradd -m -s /bin/bash agent
'"

# 3. Copy vm-agent code
echo "📦 Deploying vm-agent..."
cd "$REPO_DIR/vm-agent"
npm run build 2>/dev/null || true

# Create tarball of necessary files
tar czf /tmp/vm-agent.tar.gz \
  package.json tsconfig.json \
  dist/ src/ \
  --exclude=node_modules

scp -q /tmp/vm-agent.tar.gz local:/tmp/
ssh local "
  lxc exec ${CONTAINER} -- mkdir -p /home/agent/vm-agent
  lxc exec ${CONTAINER} -- bash -c 'cd /home/agent/vm-agent && tar xzf /tmp/vm-agent.tar.gz'
  lxc exec ${CONTAINER} -- bash -c 'cd /home/agent/vm-agent && npm install --omit=dev'
  lxc exec ${CONTAINER} -- chown -R agent:agent /home/agent/vm-agent
"
rm -f /tmp/vm-agent.tar.gz

# 4. Copy models.json
echo "📦 Setting up Pi agent config..."
ssh local "
  lxc exec ${CONTAINER} -- mkdir -p /home/agent/.pi/agent
"
scp -q "$SCRIPT_DIR/models.json" local:/tmp/models.json
ssh local "
  lxc file push /tmp/models.json ${CONTAINER}/home/agent/.pi/agent/models.json --uid 1001 --gid 1001 --mode 0600
  rm -f /tmp/models.json
"

# 5. Copy .env (if exists locally)
if [[ -f "$REPO_DIR/vm-agent/.env" ]]; then
  echo "📦 Copying .env..."
  scp -q "$REPO_DIR/vm-agent/.env" local:/tmp/vm-agent-env
  ssh local "
    lxc file push /tmp/vm-agent-env ${CONTAINER}/home/agent/vm-agent/.env --uid 1001 --gid 1001 --mode 0600
    rm -f /tmp/vm-agent-env
  "
fi

# 6. Install systemd service
echo "📦 Installing systemd service..."
scp -q "$SCRIPT_DIR/pi-agent.service" local:/tmp/pi-agent.service
ssh local "
  lxc file push /tmp/pi-agent.service ${CONTAINER}/etc/systemd/system/pi-agent.service
  lxc exec ${CONTAINER} -- systemctl daemon-reload
  lxc exec ${CONTAINER} -- systemctl enable pi-agent
  rm -f /tmp/pi-agent.service
"

# 7. Start service
echo "🔄 Starting Pi Agent..."
ssh local "lxc exec ${CONTAINER} -- systemctl restart pi-agent"
sleep 3

# 8. Verify
STATUS=$(ssh local "lxc exec ${CONTAINER} -- systemctl is-active pi-agent 2>&1")
if [[ "$STATUS" == "active" ]]; then
  echo "✅ Pi Agent running!"
  # Health check
  HEALTH=$(ssh local "lxc exec ${CONTAINER} -- curl -s http://localhost:18789/health 2>&1")
  echo "   Health: $HEALTH"
else
  echo "❌ Pi Agent failed to start:"
  ssh local "lxc exec ${CONTAINER} -- journalctl -u pi-agent -n 20 --no-pager"
  exit 1
fi
