# Multi-stage build for ARM64 (Oracle Cloud free tier)
#
# NOTE: bun's --target=bun-linux-arm64 cross-compilation from macOS may not work
# for all native dependencies. For reliable ARM64 builds, use:
#   docker buildx build --platform linux/arm64 -t jacoworks/vm-agent:latest .
# This runs the build inside an ARM64 emulated container via QEMU.

# ── Stage 1: Build ──
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
COPY tsconfig.json ./
RUN bun build --compile --target=bun-linux-arm64 src/server.ts --outfile dist/vm-agent-server

# ── Stage 2: Runtime ──
FROM alpine:3.20
RUN apk add --no-cache tini curl git

# Create non-root agent user
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -D -h /home/agent agent

WORKDIR /home/agent
COPY --from=builder /app/dist/vm-agent-server /usr/local/bin/vm-agent-server
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
    chown -R agent:agent /home/agent

USER agent
EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:18789/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["vm-agent-server"]
