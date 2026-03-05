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

# ── Stage 2: Runtime ──
FROM oven/bun:1-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini curl git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Use the existing 'bun' user (uid/gid 1000) from base image
# Create agent home directory
RUN mkdir -p /home/agent && chown bun:bun /home/agent

WORKDIR /home/agent/app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY skills/ /app/skills/

# Default environment for server mode
ENV MODE=server \
    PORT=18789 \
    HEARTBEAT_ENABLED=true \
    CRON_ENABLED=true \
    WORKSPACE_DIR=/home/agent/workspace \
    MEMORY_ROOT_DIR=/home/agent/memory \
    SKILLS_PATHS=/app/skills

# Create workspace and memory dirs
RUN mkdir -p /home/agent/workspace /home/agent/memory && \
    chown -R bun:bun /home/agent

USER bun
EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:18789/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/server.ts"]
