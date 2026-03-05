#!/bin/bash
# Cleanup all legacy agent containers on oracle
# Run from jingao: ssh opc@10.0.1.3 < deploy/scripts/cleanup-containers.sh

set -euo pipefail

echo "=== Listing agent containers ==="
docker ps -a --filter "name=agent-" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "=== Stopping all agent containers ==="
docker ps -q --filter "name=agent-" | xargs -r docker stop

echo ""
echo "=== Removing all agent containers ==="
docker ps -aq --filter "name=agent-" | xargs -r docker rm

echo ""
echo "=== Done. Remaining containers: ==="
docker ps -a --filter "name=agent-" --format "table {{.Names}}\t{{.Status}}"
