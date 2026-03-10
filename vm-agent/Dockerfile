# Multi-stage build for ARM64 (Oracle Cloud free tier)
#
# Uses Bun runtime directly (no --compile) to avoid glibc/musl mismatch.
# For reliable ARM64 builds on ARM64 host:
#   docker build -t jacoworks/vm-agent:latest .

# ── Stage 1: Install dependencies ──
FROM oven/bun:1-slim AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
COPY tsconfig.json ./

# ── Stage 2: Download Godot (ARM64) from GitHub Releases ──
FROM debian:bookworm-slim AS godot-downloader
ARG GODOT_VERSION=4.6
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Download Godot ARM64 binary (~70MB)
RUN curl -sL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.arm64.zip" -o /tmp/godot.zip && \
    cd /tmp && unzip godot.zip && \
    mv "Godot_v${GODOT_VERSION}-stable_linux.arm64" /opt/godot && \
    chmod +x /opt/godot && \
    rm godot.zip

# Download Export Templates and extract ONLY Web templates (~80MB vs ~1.2GB full)
# Full .tpz contains all platforms (Windows/Linux/macOS/Android/iOS/Web).
# We only need: web_release.zip, web_debug.zip, web_nothreads_release.zip, web_nothreads_debug.zip
RUN curl -sL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_export_templates.tpz" -o /tmp/templates.tpz && \
    mkdir -p /opt/godot-templates && \
    cd /tmp && unzip -j templates.tpz "templates/web_*.zip" "templates/version.txt" -d /opt/godot-templates/ && \
    rm -f templates.tpz

# ── Stage 3: Runtime ──
FROM oven/bun:1-slim
ARG GODOT_VERSION=4.6

# System packages: dev tools + Godot runtime deps (X11/GL for headless rendering)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash tini curl wget git ca-certificates nodejs npm \
    python3 python3-pip jq zip unzip wkhtmltopdf pandoc \
    xvfb imagemagick libfontconfig1 libgl1 libxcursor1 libxinerama1 libxrandr2 libxi6 libasound2 && \
    rm -rf /var/lib/apt/lists/*

# Preinstall common CLI tooling for sandboxed bash commands
RUN npm install -g typescript tsx prettier && \
    pip3 install --no-cache-dir requests beautifulsoup4 markdown

# Install Godot binary + Web export templates
COPY --from=godot-downloader /opt/godot /usr/local/bin/godot
RUN mkdir -p /home/bun/.local/share/godot/export_templates/${GODOT_VERSION}.stable
COPY --from=godot-downloader /opt/godot-templates/ /home/bun/.local/share/godot/export_templates/${GODOT_VERSION}.stable/

# Godot tools: operations script + export preset template
COPY scripts/godot_operations.gd /opt/godot-tools/
COPY scripts/godot-export-presets.cfg /opt/godot-tools/templates/export_presets.cfg
COPY --chown=bun:bun scripts/runtime-smoke.sh /opt/health/runtime-smoke.sh

# Create all directories with correct ownership BEFORE copying app files.
# This avoids a costly chown -R layer that duplicates node_modules (~448MB).
RUN mkdir -p /home/agent/app /home/agent/workspace /home/agent/memory /opt/godot-tools/templates /opt/health && \
    chmod +x /opt/health/runtime-smoke.sh && \
    chown -R bun:bun /home/agent /opt/godot-tools /home/bun/.local

WORKDIR /home/agent/app

# Copy app files with --chown to avoid separate chown layer
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/src ./src
COPY --from=builder --chown=bun:bun /app/package.json /app/tsconfig.json ./
COPY --chown=bun:bun skills/ /app/skills/

# Default environment for server mode
ENV MODE=server \
    PORT=18789 \
    HEARTBEAT_ENABLED=true \
    CRON_ENABLED=true \
    WORKSPACE_DIR=/home/agent/workspace \
    MEMORY_ROOT_DIR=/home/agent/memory \
    AGENT_HOME_DIR=/home/agent \
    SKILLS_PATHS=/app/skills

USER bun
EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:18789/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/server.ts"]
