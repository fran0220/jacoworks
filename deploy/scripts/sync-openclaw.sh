#!/usr/bin/env bash
# JAcoworks — 同步 OpenClaw 配置到容器
# 用法: ./deploy/scripts/sync-openclaw.sh [container_name]
#
# 同步文件:
#   deploy/openclaw/.env          → ~/.openclaw/.env
#   deploy/openclaw/openclaw.json → ~/.openclaw/openclaw.json
#   deploy/openclaw/search.json   → ~/.openclaw/credentials/search.json (如存在)

set -euo pipefail

CONTAINER="${1:-tpl-openclaw}"
DEPLOY_DIR="$(cd "$(dirname "$0")/../openclaw" && pwd)"
REMOTE_HOME="/home/agent/.openclaw"

# 获取容器内 agent 用户的 uid/gid
AGENT_UID=$(ssh local "lxc exec ${CONTAINER} -- id -u agent 2>/dev/null" || echo 1001)
AGENT_GID=$(ssh local "lxc exec ${CONTAINER} -- id -g agent 2>/dev/null" || echo 1001)

echo "📦 同步配置到容器: $CONTAINER"
echo "   来源: $DEPLOY_DIR"

# 同步 .env
if [[ -f "$DEPLOY_DIR/.env" ]]; then
    scp -q "$DEPLOY_DIR/.env" local:/tmp/_openclaw_env
    ssh local "lxc file push /tmp/_openclaw_env ${CONTAINER}${REMOTE_HOME}/.env --uid ${AGENT_UID} --gid ${AGENT_GID} --mode 0600 && rm -f /tmp/_openclaw_env"
    echo "   ✅ .env"
fi

# 同步 openclaw.json
if [[ -f "$DEPLOY_DIR/openclaw.json" ]]; then
    scp -q "$DEPLOY_DIR/openclaw.json" local:/tmp/_openclaw_json
    ssh local "lxc file push /tmp/_openclaw_json ${CONTAINER}${REMOTE_HOME}/openclaw.json --uid ${AGENT_UID} --gid ${AGENT_GID} --mode 0600 && rm -f /tmp/_openclaw_json"
    echo "   ✅ openclaw.json"
fi

# 同步 search.json (可选)
if [[ -f "$DEPLOY_DIR/search.json" ]]; then
    ssh local "lxc exec ${CONTAINER} -- mkdir -p ${REMOTE_HOME}/credentials"
    scp -q "$DEPLOY_DIR/search.json" local:/tmp/_openclaw_search
    ssh local "lxc file push /tmp/_openclaw_search ${CONTAINER}${REMOTE_HOME}/credentials/search.json --uid ${AGENT_UID} --gid ${AGENT_GID} --mode 0600 && rm -f /tmp/_openclaw_search"
    echo "   ✅ credentials/search.json"
fi

# 重启 Gateway
echo "🔄 重启 OpenClaw Gateway..."
ssh local "lxc exec ${CONTAINER} -- systemctl restart openclaw.service"
sleep 5

# 验证
STATUS=$(ssh local "lxc exec ${CONTAINER} -- systemctl is-active openclaw.service 2>&1")
if [[ "$STATUS" == "active" ]]; then
    echo "✅ Gateway 运行正常"
else
    echo "❌ Gateway 启动失败，检查日志:"
    echo "   ssh local \"lxc exec ${CONTAINER} -- journalctl -u openclaw.service -n 20 --no-pager\""
    exit 1
fi
