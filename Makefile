# JAcoworks — 桌面端 + Gateway + Website
# 用法: make <target>
# 列出所有: make help

.PHONY: help dev dev-gateway dev-website dev-desktop \
        build build-gateway build-website build-desktop \
        compile-agent compile-tools prepare-win-deps \
        deploy deploy-jingao deploy-gateway deploy-website push-skills deploy-sync \
        check check-gateway check-website check-desktop \
        db-migrate clean \
        release release-build release-upload release-bump

# ─── 配置 ───
JINGAO_HOST   ?= jingao
GATEWAY_PORT  ?= 8847
WEBSITE_PORT  ?= 9527
REPO_DIR      ?= /opt/jacoworks/repo

# ─── 帮助 ───
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ═══════════════════════════════════════════
#  本地开发
# ═══════════════════════════════════════════

dev: ## 显示开发服务启动指引
	@echo "🚀 启动开发服务..."
	@echo "  Gateway  → http://localhost:$(GATEWAY_PORT)"
	@echo "  Website  → http://localhost:$(WEBSITE_PORT)"
	@echo "  Desktop  → Tauri dev window"
	@echo ""
	@echo "请在各自终端分别运行:"
	@echo "  make dev-gateway"
	@echo "  make dev-website"
	@echo "  make dev-desktop"

dev-gateway: ## 启动 Gateway 开发服务
	cd gateway && go run ./cmd/gateway -config gateway.yaml

dev-website: ## 启动 Website 开发服务
	cd website && cargo run

dev-desktop: ## 启动 Desktop 开发模式 (Tauri + Vite HMR)
	cd desktop && cargo tauri dev

# ═══════════════════════════════════════════
#  构建
# ═══════════════════════════════════════════

build: build-gateway build-website ## 构建所有服务端组件

build-gateway: ## 构建 Gateway (本地)
	cd gateway && go build -ldflags="-s -w" -o bin/gateway ./cmd/gateway
	@echo "✅ gateway/bin/gateway"

build-website: ## 构建 Website (release)
	cd website && cargo build --release
	@echo "✅ website/target/release/jacoworks-website"

compile-agent: ## 编译 sidecar + CLI tools + 打包 release 资源
	@TARGET=$$(rustc -vV | grep host | cut -d' ' -f2) && \
	echo "🔧 Building for target: $$TARGET" && \
	bash desktop/src-tauri/scripts/prepare-release.sh "$$TARGET"

compile-tools: ## 编译 bundled CLI tools
	@TARGET=$$(rustc -vV | grep host | cut -d' ' -f2) && \
	echo "🔧 Compiling CLI tools for target: $$TARGET" && \
	bash deploy/scripts/compile-tools.sh "$$TARGET"

prepare-win-deps: ## 下载 Windows 构建依赖
	bash desktop/src-tauri/scripts/prepare-win-deps.sh

build-desktop: compile-agent ## 构建 Desktop 安装包
	cd desktop && cargo tauri build
	@echo "✅ Desktop 安装包在 desktop/src-tauri/target/release/bundle/"

# ═══════════════════════════════════════════
#  部署 — jingao (桌面端管控面)
# ═══════════════════════════════════════════

deploy: deploy-jingao push-skills ## 部署所有服务

deploy-jingao: deploy-gateway deploy-website ## 部署桌面端管控面到 jingao

push-skills: ## 推送 skills 到网关 (system skills)
	./deploy/push-skills.sh

deploy-sync: ## 同步代码到 jingao
	@echo "📥 同步代码到 jingao..."
	ssh $(JINGAO_HOST) "cd $(REPO_DIR) && git fetch origin && git reset --hard origin/main && git submodule update --init --recursive 2>/dev/null || true"
	@echo "✅ 代码已同步"

deploy-gateway: deploy-sync ## 部署 Gateway 到 jingao (远程编译)
	@echo "📦 部署 Gateway → $(JINGAO_HOST) (远程编译)..."
	ssh $(JINGAO_HOST) " \
		cd $(REPO_DIR)/gateway && \
		export PATH=\$$PATH:/usr/local/go/bin && \
		export GOTOOLCHAIN=local && \
		export GOPROXY=https://goproxy.cn,direct && \
		CGO_ENABLED=0 go build -buildvcs=false -ldflags='-s -w' -o /tmp/jacoworks-gateway ./cmd/gateway && \
		sudo systemctl stop jacoworks-gateway && \
		sudo mv /tmp/jacoworks-gateway /opt/jacoworks/gateway && \
		sudo chmod +x /opt/jacoworks/gateway && \
		sudo systemctl start jacoworks-gateway && \
		sleep 2 && \
		curl -sf http://localhost:8847/health"
	@echo "✅ Gateway 已部署"

deploy-website: deploy-sync ## 部署 Website 到 jingao (远程编译)
	@echo "📦 部署 Website → $(JINGAO_HOST) (远程编译)..."
	ssh $(JINGAO_HOST) " \
		source ~/.cargo/env && \
		cd $(REPO_DIR)/website && \
		cargo build --release && \
		sudo systemctl stop jacoworks-website && \
		sudo cp target/release/jacoworks-website /opt/jacoworks/www/jacoworks-website && \
		sudo rsync -a content/ /opt/jacoworks/www/content/ && \
		sudo rsync -a static/ /opt/jacoworks/www/static/ && \
		sudo rsync -a templates/ /opt/jacoworks/www/templates/ && \
		sudo chmod +x /opt/jacoworks/www/jacoworks-website && \
		sudo systemctl start jacoworks-website && \
		sleep 2 && \
		curl -sf http://localhost:9527/"
	@echo "✅ Website 已部署"

# ═══════════════════════════════════════════
#  检查
# ═══════════════════════════════════════════

check: check-gateway check-website check-desktop ## 全量检查

check-gateway: ## Go vet + test
	cd gateway && go vet ./... && go test ./...

check-website: ## Cargo check + test
	cd website && cargo check && cargo test

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
	rm -rf desktop/dist/ desktop/src-tauri/target/

# ═══════════════════════════════════════════
#  发布 Desktop
# ═══════════════════════════════════════════

release: ## 完整发布 (构建 macOS + 上传 COS + 注册 DB) — make release V=1.5.0
	@test -n "$(V)" || (echo "❌ 用法: make release V=1.5.0" && exit 1)
	bash deploy/release.sh "$(V)"

release-build: ## 仅构建 — make release-build V=1.5.0
	@test -n "$(V)" || (echo "❌ 用法: make release-build V=1.5.0" && exit 1)
	bash deploy/release.sh "$(V)" build

release-upload: ## 仅上传 + 注册 — make release-upload V=1.5.0
	@test -n "$(V)" || (echo "❌ 用法: make release-upload V=1.5.0" && exit 1)
	bash deploy/release.sh "$(V)" upload

release-bump: ## 仅更新版本号 — make release-bump V=1.5.0
	@test -n "$(V)" || (echo "❌ 用法: make release-bump V=1.5.0" && exit 1)
	bash deploy/release.sh "$(V)" bump
