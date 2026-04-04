#!/usr/bin/env bash
# Compatibility wrapper for the renamed Pi-based golden image builder.
# Usage: ./build-openclaw-vm.sh [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "ℹ️  OpenClaw VM image builder moved to build-pi-vm.sh; delegating."
exec "${SCRIPT_DIR}/build-pi-vm.sh" "$@"
