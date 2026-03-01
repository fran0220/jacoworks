#!/usr/bin/env bash
# Push vm-agent/skills/ to gateway as system skills.
# Usage: ./deploy/push-skills.sh [GATEWAY_URL]
#
# Auth (tried in order):
#   1. ADMIN_TOKEN env
#   2. gateway.yaml auth.admin_token
#   3. Login with ADMIN_USER/ADMIN_PASS env (default: admin@jacoworks.local/admin123)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SKILLS_DIR="${REPO_DIR}/vm-agent/skills"

GATEWAY_URL="${1:-${GATEWAY_URL:-https://jacoapi.jingao.club}}"
TOKEN="${ADMIN_TOKEN:-}"

# Try gateway.yaml
if [[ -z "$TOKEN" ]]; then
  YAML="${REPO_DIR}/gateway/gateway.yaml"
  if [[ -f "$YAML" ]]; then
    TOKEN=$(grep -E '^\s*admin_token:' "$YAML" | head -1 | sed 's/.*admin_token:\s*["]*\([^"]*\).*/\1/' | tr -d "'\"" | xargs)
  fi
fi

# Try login
if [[ -z "$TOKEN" ]]; then
  ADMIN_USER="${ADMIN_USER:-admin@jacoworks.local}"
  ADMIN_PASS="${ADMIN_PASS:-admin123}"
  echo "🔑 Logging in as $ADMIN_USER ..."
  LOGIN_RESP=$(curl -sf "${GATEWAY_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" 2>/dev/null || echo "")
  if [[ -n "$LOGIN_RESP" ]]; then
    TOKEN=$(echo "$LOGIN_RESP" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).token||'')" 2>/dev/null || echo "")
  fi
fi

if [[ -z "$TOKEN" ]]; then
  echo "❌ Cannot authenticate. Set ADMIN_TOKEN env or check gateway.yaml"
  exit 1
fi

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "❌ Skills directory not found: $SKILLS_DIR"
  exit 1
fi

echo "📦 Collecting skills from $SKILLS_DIR ..."

PAYLOAD=$(node -e "
const fs = require('fs');
const path = require('path');
function walk(dir, base) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, rel));
    else if (entry.isFile()) files.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
  }
  return files;
}
const files = walk('$SKILLS_DIR', '');
console.log(JSON.stringify({ source: 'builtin', files }));
")

FILE_COUNT=$(echo "$PAYLOAD" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8');console.log(JSON.parse(d).files.length)")
echo "   Found $FILE_COUNT skill files"
echo "🚀 Uploading to ${GATEWAY_URL}/api/skills/upload ..."

HTTP_CODE=$(curl -s -o /tmp/push-skills-response.json -w "%{http_code}" \
  -X POST "${GATEWAY_URL}/api/skills/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "$PAYLOAD")

RESPONSE=$(cat /tmp/push-skills-response.json 2>/dev/null || echo "{}")
rm -f /tmp/push-skills-response.json

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✅ Pushed $FILE_COUNT system skills to gateway"
else
  echo "❌ Upload failed (HTTP $HTTP_CODE): $RESPONSE"
  exit 1
fi
