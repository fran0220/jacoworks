# JAcoworks — 本地开发 & 部署命令
# 用法: make <target>
# 列出所有: make help

.PHONY: help dev dev-gateway dev-website dev-agent dev-desktop \
        build build-gateway build-website build-agent build-desktop \
        deploy deploy-gateway deploy-website \
        check check-gateway check-website check-agent check-desktop \
        db-reset db-migrate clean

# ─── 配置 ───
JINGAO_HOST   ?= jingao
GATEWAY_PORT  ?= 8847
WEBSITE_PORT  ?= 9527

# ─── 帮助 ───
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ═══════════════════════════════════════════
#  本地开发 (各模块独立启动)
# ═══════════════════════════════════════════

dev: ## 并行启动所有开发服务 (gateway + website + desktop)
	@echo "🚀 启动所有开发服务..."
	@echo "  Gateway  → http://localhost:$(GATEWAY_PORT)"
	@echo "  Website  → http://localhost:$(WEBSITE_PORT)"
	@echo "  Desktop  → Tauri dev window"
	@echo ""
	@echo "请在各自终端分别运行:"
	@echo "  make dev-gateway"
	@echo "  make dev-website"
	@echo "  make dev-agent    (仅调试 agent 时)"
	@echo "  make dev-desktop  (启动桌面端, 会自动启 sidecar)"

dev-gateway: ## 启动 Gateway 开发服务
	cd gateway && go run ./cmd/gateway -config gateway.yaml

dev-website: ## 启动 Website 开发服务
	cd website && cargo run

dev-agent: ## 启动 vm-agent 开发模式 (热重载)
	cd vm-agent && npm run dev

dev-desktop: ## 启动 Desktop 开发模式 (Tauri + Vite HMR)
	cd desktop && cargo tauri dev

# ═══════════════════════════════════════════
#  构建
# ═══════════════════════════════════════════

build: build-gateway build-website build-agent ## 构建所有服务端组件

build-gateway: ## 构建 Gateway (linux/amd64)
	cd gateway && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/gateway-linux ./cmd/gateway
	@echo "✅ gateway/bin/gateway-linux"

build-website: ## 构建 Website (release)
	cd website && cargo build --release
	@echo "✅ website/target/release/jacoworks-website"

build-agent: ## 构建 vm-agent
	cd vm-agent && npm run build
	@echo "✅ vm-agent/dist/"

build-desktop: build-agent ## 构建 Desktop 安装包 (当前平台)
	cd desktop && cargo tauri build
	@echo "✅ Desktop 安装包在 desktop/src-tauri/target/release/bundle/"

# ═══════════════════════════════════════════
#  手动部署 (SSH 到 jingao)
# ═══════════════════════════════════════════

deploy: deploy-gateway deploy-website ## 部署所有服务到 jingao

deploy-gateway: build-gateway ## 部署 Gateway 到 jingao
	@echo "📦 部署 Gateway → $(JINGAO_HOST)..."
	scp gateway/bin/gateway-linux $(JINGAO_HOST):/opt/jacoworks/gateway.new
	ssh $(JINGAO_HOST) " \
		systemctl stop jacoworks-gateway && \
		mv /opt/jacoworks/gateway.new /opt/jacoworks/gateway && \
		chmod +x /opt/jacoworks/gateway && \
		systemctl start jacoworks-gateway"
	@echo "✅ Gateway 已部署"

deploy-website: build-website ## 部署 Website 到 jingao
	@echo "📦 部署 Website → $(JINGAO_HOST)..."
	ssh $(JINGAO_HOST) "systemctl stop jacoworks-website 2>/dev/null || true"
	scp website/target/release/jacoworks-website $(JINGAO_HOST):/opt/jacoworks/www/jacoworks-website.new
	rsync -avz --delete website/content/ $(JINGAO_HOST):/opt/jacoworks/www/content/
	rsync -avz --delete website/static/ $(JINGAO_HOST):/opt/jacoworks/www/static/
	rsync -avz --delete website/templates/ $(JINGAO_HOST):/opt/jacoworks/www/templates/
	ssh $(JINGAO_HOST) " \
		mv /opt/jacoworks/www/jacoworks-website.new /opt/jacoworks/www/jacoworks-website && \
		chmod +x /opt/jacoworks/www/jacoworks-website && \
		systemctl start jacoworks-website"
	@echo "✅ Website 已部署"

# ═══════════════════════════════════════════
#  检查 (Lint / Typecheck / Test)
# ═══════════════════════════════════════════

check: check-gateway check-website check-agent check-desktop ## 全量检查

check-gateway: ## Go vet + test
	cd gateway && go vet ./... && go test ./...

check-website: ## Cargo check + test
	cd website && cargo check && cargo test

check-agent: ## TypeScript typecheck
	cd vm-agent && npm run typecheck

check-desktop: ## Desktop typecheck
	cd desktop && npm run check

# ═══════════════════════════════════════════
#  数据库
# ═══════════════════════════════════════════

db-migrate: ## 执行数据库迁移 (需本地 psql 连到 jingao)
	psql "postgresql://jacoworks:$(DB_PASSWORD)@127.0.0.1:5432/jacoworks" \
		-f deploy/sql/001_init_business_tables.sql \
		-f deploy/sql/002_website_tables.sql

# ═══════════════════════════════════════════
#  清理
# ═══════════════════════════════════════════

clean: ## 清理所有构建产物
	rm -rf gateway/bin/
	cd website && cargo clean
	rm -rf vm-agent/dist/
	rm -rf desktop/dist/ desktop/src-tauri/target/
