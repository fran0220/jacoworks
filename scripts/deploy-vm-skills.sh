#!/bin/bash
# Deploy search + asset-gateway + word-docx + excel-xlsx skills to OpenClaw VMs
set -euo pipefail

HOST="root@100.97.254.31"
VMS=("oc-9dfd313ad9fae26b" "oc-d6ca2bcd08911f1a")

# Credentials
TAVILY_KEY="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"
EXA_KEY="a8682ce2-58c7-4ef9-896e-ee49260839c8"
GROK_API_URL="http://67.230.171.248:8317/v1"
GROK_API_KEY="sk-123456"
GROK_MODEL="grok-4.1-fast"
ASSET_TOKEN="agk_admin_2484d6cec8ccc8b8d1eb076eac171e17"
ASSET_URL="https://assets.xiaomao.chat"

SEARCH_SCRIPTS="$HOME/.agents/skills/search/_repos/openclaw-search-skills/search-layer/scripts"
ASSET_SKILL="$HOME/.config/amp/skills/asset-gateway/SKILL.md"

# ClawHub skills (instruction-only, downloaded from clawhub.ai)
WORD_DOCX_SKILL="/tmp/clawhub-skills/word-docx/SKILL.md"
EXCEL_XLSX_SKILL="/tmp/clawhub-skills/excel-xlsx/SKILL.md"

for VM in "${VMS[@]}"; do
  echo "━━━ Deploying to $VM ━━━"

  # 1. Check Python deps (requests should be pre-installed)
  echo "  [1/6] Checking Python deps..."
  ssh "$HOST" "incus exec $VM -- python3 -c 'import requests; print(\"requests\", requests.__version__)'" 2>&1

  # 2. Install asset-gateway globally
  echo "  [2/6] Installing asset-gateway..."
  ssh "$HOST" "incus exec $VM -- npm install -g @doufunao123/asset-gateway" 2>&1 | tail -2

  # 3. Configure asset-gateway auth
  echo "  [3/6] Configuring asset-gateway auth..."
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.config/asset-gateway'"
  echo "{\"token\":\"$ASSET_TOKEN\",\"gateway_url\":\"$ASSET_URL\"}" | \
    ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.config/asset-gateway/auth.json'"

  # 4. Copy search scripts
  echo "  [4/6] Copying search scripts..."
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.openclaw/skills/search/scripts'"
  for f in search.py fetch_thread.py relevance_gate.py chain_tracker.py; do
    if [ -f "$SEARCH_SCRIPTS/$f" ]; then
      cat "$SEARCH_SCRIPTS/$f" | ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/skills/search/scripts/$f'"
    fi
  done

  # 5. Write search credentials
  echo "  [5/6] Writing credentials & SKILL.md files..."
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.openclaw/credentials'"
  echo "{\"exa\":\"$EXA_KEY\",\"tavily\":\"$TAVILY_KEY\",\"grok\":{\"apiUrl\":\"$GROK_API_URL\",\"apiKey\":\"$GROK_API_KEY\",\"model\":\"$GROK_MODEL\"}}" | \
    ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/credentials/search.json'"

  # Write search SKILL.md
  cat > /tmp/search-skill.md << 'SKILLEOF'
---
name: search
description: "Multi-source web search (Exa + Tavily + Grok). Use when the user asks to search the web, find information, or research a topic."
---

# Web Search

Multi-source parallel search with intent-aware scoring.

## Usage

Credentials auto-discovered from `~/.openclaw/credentials/search.json`.

```bash
S=/home/node/.openclaw/skills/search/scripts

# Fast search (Exa only)
python3 $S/search.py "query" --mode fast

# Deep search (Exa + Tavily + Grok parallel)
python3 $S/search.py "query" --mode deep --num 5

# With intent + freshness filter
python3 $S/search.py "query" --mode deep --intent status --freshness pw

# Multiple queries
python3 $S/search.py --queries "q1" "q2" --mode deep

# Fetch full thread/page content
python3 $S/fetch_thread.py "https://github.com/owner/repo/issues/123"
```

## Modes
- `fast` — Exa only (low latency)
- `deep` — Exa + Tavily + Grok parallel (max coverage)
- `answer` — Tavily with AI-generated answer

## Intent types
factual, status, comparison, tutorial, exploratory, news, resource
SKILLEOF
  cat /tmp/search-skill.md | ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/skills/search/SKILL.md'"

  # Write asset-gateway SKILL.md
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.openclaw/skills/asset-gateway'"
  cat "$ASSET_SKILL" | ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/skills/asset-gateway/SKILL.md'"

  # 5b. Install word-docx + excel-xlsx skills (instruction-only from ClawHub)
  echo "  [5b/8] Installing word-docx + excel-xlsx skills..."
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.openclaw/skills/word-docx'"
  cat "$WORD_DOCX_SKILL" | ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/skills/word-docx/SKILL.md'"
  ssh "$HOST" "incus exec $VM -- su - node -c 'mkdir -p ~/.openclaw/skills/excel-xlsx'"
  cat "$EXCEL_XLSX_SKILL" | ssh "$HOST" "incus exec $VM -- su - node -c 'cat > ~/.openclaw/skills/excel-xlsx/SKILL.md'"

  # 5c. Install Python deps for Excel skill (openpyxl + pandas)
  echo "  [5c/8] Installing openpyxl + pandas..."
  ssh "$HOST" "incus exec $VM -- python3 -m pip install --break-system-packages -q openpyxl pandas" 2>&1 | tail -2

  # 6. Add env vars to openclaw.service and restart
  echo "  [6/8] Injecting env vars & restarting OpenClaw..."
  ssh "$HOST" "incus exec $VM -- mkdir -p /etc/systemd/system/openclaw.service.d"
  echo "[Service]
Environment=TAVILY_API_KEY=$TAVILY_KEY
Environment=EXA_API_KEY=$EXA_KEY
Environment=GROK_API_KEY=$GROK_API_KEY
Environment=GROK_API_URL=$GROK_API_URL
Environment=ASSET_GATEWAY_TOKEN=$ASSET_TOKEN
Environment=ASSET_GATEWAY_URL=$ASSET_URL" | \
    ssh "$HOST" "incus exec $VM -- tee /etc/systemd/system/openclaw.service.d/skills.conf > /dev/null"
  ssh "$HOST" "incus exec $VM -- systemctl daemon-reload"
  ssh "$HOST" "incus exec $VM -- systemctl restart openclaw"

  echo "  ✅ $VM done"
  echo ""
done

echo "🎉 All VMs updated!"
