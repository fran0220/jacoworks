#!/usr/bin/env bash
set -euo pipefail

# Continuous smoke test for chat.jingao.club using agent-browser.
# Usage:
#   WEBCHAT_USER=admin@jacoworks.local WEBCHAT_PASS=admin123 ./scripts/webchat-smoke-loop.sh
# Optional:
#   BASE_URL=https://chat.jingao.club INTERVAL_SEC=30 MAX_ROUNDS=0 ./scripts/webchat-smoke-loop.sh

BASE_URL="${BASE_URL:-https://chat.jingao.club}"
INTERVAL_SEC="${INTERVAL_SEC:-30}"
MAX_ROUNDS="${MAX_ROUNDS:-0}" # 0 means infinite loop
WEBCHAT_USER="${WEBCHAT_USER:-}"
WEBCHAT_PASS="${WEBCHAT_PASS:-}"

if [[ -z "${WEBCHAT_USER}" || -z "${WEBCHAT_PASS}" ]]; then
  echo "WEBCHAT_USER / WEBCHAT_PASS is required"
  exit 1
fi

round=0
while :; do
  round=$((round + 1))
  session="smoke-${round}-$(date +%s)"
  echo "== Round ${round} (${session}) =="

  agent-browser --session "${session}" open "${BASE_URL}/login" >/dev/null
  snap_login="$(agent-browser --session "${session}" snapshot -i --json)"
  ref_user="$(echo "${snap_login}" | jq -r '.data.refs | to_entries[] | select(.value.role=="textbox" and .value.name=="用户名") | .key' | head -n1)"
  ref_pass="$(echo "${snap_login}" | jq -r '.data.refs | to_entries[] | select(.value.role=="textbox" and .value.name=="密码") | .key' | head -n1)"
  ref_submit="$(echo "${snap_login}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="登录") | .key' | tail -n1)"
  [[ -n "${ref_user}" ]] && agent-browser --session "${session}" fill "@${ref_user}" "${WEBCHAT_USER}" >/dev/null
  [[ -n "${ref_pass}" ]] && agent-browser --session "${session}" fill "@${ref_pass}" "${WEBCHAT_PASS}" >/dev/null
  [[ -n "${ref_submit}" ]] && agent-browser --session "${session}" click "@${ref_submit}" >/dev/null
  agent-browser --session "${session}" wait 5000 >/dev/null

  # Navigation loop: workbench -> tasks -> team -> observe
  snap_nav="$(agent-browser --session "${session}" snapshot -i --json || true)"
  ref_workbench="$(echo "${snap_nav}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="指挥台") | .key' | head -n1)"
  ref_tasks="$(echo "${snap_nav}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="任务") | .key' | head -n1)"
  ref_team="$(echo "${snap_nav}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="团队") | .key' | head -n1)"
  ref_observe="$(echo "${snap_nav}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="观测") | .key' | head -n1)"
  [[ -n "${ref_workbench}" ]] && agent-browser --session "${session}" click "@${ref_workbench}" >/dev/null || true
  agent-browser --session "${session}" wait 600 >/dev/null
  [[ -n "${ref_tasks}" ]] && agent-browser --session "${session}" click "@${ref_tasks}" >/dev/null || true
  agent-browser --session "${session}" wait 600 >/dev/null
  [[ -n "${ref_team}" ]] && agent-browser --session "${session}" click "@${ref_team}" >/dev/null || true
  agent-browser --session "${session}" wait 600 >/dev/null
  [[ -n "${ref_observe}" ]] && agent-browser --session "${session}" click "@${ref_observe}" >/dev/null || true
  agent-browser --session "${session}" wait 1000 >/dev/null

  # Open avatar menu to cover VNC and logout controls rendering path.
  snap_user="$(agent-browser --session "${session}" snapshot -i --json || true)"
  ref_user_menu="$(echo "${snap_user}" | jq -r '.data.refs | to_entries[] | select(.value.role=="button" and .value.name=="A") | .key' | head -n1)"
  [[ -n "${ref_user_menu}" ]] && agent-browser --session "${session}" click "@${ref_user_menu}" >/dev/null || true
  agent-browser --session "${session}" wait 600 >/dev/null

  echo "-- HTTP >= 400 --"
  agent-browser --session "${session}" network requests --json \
    | jq -r '.data.requests[] | select(.status >= 400) | "\(.status)\t\(.method)\t\(.url)"' \
    | sed '/favicon.ico/d' \
    || true

  if [[ "${MAX_ROUNDS}" != "0" && "${round}" -ge "${MAX_ROUNDS}" ]]; then
    echo "Reached MAX_ROUNDS=${MAX_ROUNDS}, exiting."
    exit 0
  fi

  sleep "${INTERVAL_SEC}"
done
