# JAcoworks — 本地开发 & 部署命令
# 用法: make <target>
# 列出所有: make help

.PHONY: help dev dev-gateway dev-website dev-webchat dev-agent dev-desktop \
        build build-gateway build-website build-webchat build-agent build-desktop \
        compile-agent prepare-win-deps \
        deploy deploy-gateway deploy-website deploy-agent push-skills \
        check check-gateway check-website check-webchat check-agent check-desktop \
        check-gateway-e2e check-journeys check-all \
        db-reset db-migrate clean \
        docker-build-agent docker-run-agent \
        release release-build release-upload release-bump

# ─── 配置 ───
JINGAO_HOST   ?= jingao
ORACLE_HOST   ?= oracle
GATEWAY_PORT  ?= 8847
WEBSITE_PORT  ?= 9527
REPO_DIR      ?= /opt/jacoworks/repo

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

dev-webchat: ## 启动 Web 聊天 SPA 开发模式
	cd webchat && npx vite

# ═══════════════════════════════════════════
#  构建 (本地)
# ═══════════════════════════════════════════

build: build-gateway build-website build-agent ## 构建所有服务端组件

build-gateway: ## 构建 Gateway (本地)
	cd gateway && go build -ldflags="-s -w" -o bin/gateway ./cmd/gateway
	@echo "✅ gateway/bin/gateway"

build-website: ## 构建 Website (release)
	cd website && cargo build --release
	@echo "✅ website/target/release/jacoworks-website"

build-agent: ## 构建 vm-agent
	cd vm-agent && npm run build
	@echo "✅ vm-agent/dist/"

build-webchat: ## 构建 Web 聊天 SPA → website/static/chat/
	cd webchat && npm run build
	@echo "✅ website/static/chat/"

compile-agent: ## 编译 vm-agent + 打包所有 release 资源 (sidecar + doc-packages + validation)
	@TARGET=$$(rustc -vV | grep host | cut -d' ' -f2) && \
	echo "🔧 Building for target: $$TARGET" && \
	bash desktop/src-tauri/scripts/prepare-release.sh "$$TARGET"

prepare-win-deps: ## 下载 Windows 构建依赖 (bash + bun, 用于交叉编译)
	bash desktop/src-tauri/scripts/prepare-win-deps.sh

build-desktop: compile-agent ## 构建 Desktop 安装包 (Windows 需先 make prepare-win-deps)
	cd desktop && cargo tauri build
	@echo "✅ Desktop 安装包在 desktop/src-tauri/target/release/bundle/"

# ═══════════════════════════════════════════
#  部署 (SSH 到 jingao, 远程 git pull + 编译)
# ═══════════════════════════════════════════

push-skills: ## 推送 vm-agent/skills/ 到网关 (system skills)
	./deploy/push-skills.sh

deploy: deploy-gateway deploy-website push-skills ## 部署所有服务到 jingao

deploy-sync: ## 同步代码到 jingao (git pull + submodule)
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
		sudo ln -sfn $(REPO_DIR)/openclaw /opt/jacoworks/openclaw && \
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
#  检查 (Lint / Typecheck / Test)
# ═══════════════════════════════════════════

check: check-gateway check-website check-webchat check-agent check-desktop ## 全量检查

check-gateway: ## Go vet + test
	cd gateway && go vet ./... && go test ./...

check-website: ## Cargo check + test
	cd website && cargo check && cargo test

check-webchat: ## WebChat typecheck + build 验证
	cd webchat && npx tsc --noEmit

check-agent: ## TypeScript typecheck + 单元测试
	cd vm-agent && npm run typecheck && npm test

check-desktop: ## Desktop typecheck
	cd desktop && npm run check

check-gateway-e2e: ## Gateway API E2E (需真实网关)
	cd vm-agent && npm run test:gateway-e2e

check-journeys: ## 全链路 E2E (需完整基础设施)
	cd vm-agent && npm run test:journeys

check-all: check check-gateway-e2e ## 全量检查 (hermetic + E2E)

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
	rm -rf webchat/dist/
	rm -rf desktop/dist/ desktop/src-tauri/target/

# ═══════════════════════════════════════════
#  Docker (vm-agent server → oracle)
# ═══════════════════════════════════════════

docker-build-agent: ## 在 Oracle 上原地构建 vm-agent ARM64 镜像 (无需 Mac 跨架构)
	@echo "🔄 Oracle 拉取最新代码..."
	ssh $(ORACLE_HOST) "cd $(REPO_DIR) && git fetch origin && git reset --hard origin/main"
	@echo "🔨 Oracle 本地构建 ARM64 镜像..."
	$(eval GIT_SHA := $(shell git rev-parse --short HEAD))
	ssh $(ORACLE_HOST) '\
		cd $(REPO_DIR)/vm-agent && \
		docker build -t jacoworks/vm-agent:$(GIT_SHA) -t jacoworks/vm-agent:latest . && \
		echo "✅ 构建完成: jacoworks/vm-agent:$(GIT_SHA)" && \
		docker image prune -f && \
		docker buildx prune -f --keep-storage=2g'

docker-run-agent: ## 本地启动 vm-agent Docker 容器
	cd vm-agent && docker compose up -d

# ═══════════════════════════════════════════
#  发布 Desktop (本地构建 + 上传 COS)
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

deploy-agent: docker-build-agent ## 构建并部署 vm-agent 到 oracle (零停机：旧容器继续运行到自然重启)
	@echo "✅ 新镜像已就绪 (jacoworks/vm-agent:latest)"
	@echo "   运行中的容器继续使用旧镜像直到下次 provision/restart"
	@echo "   如需立即重建所有容器: make redeploy-agent"

redeploy-agent: docker-build-agent ## 强制重建所有 vm-agent 容器 (有停机，谨慎使用)
	@echo "⚠️  停止并删除所有 vm-agent 容器..."
	ssh $(ORACLE_HOST) '\
		docker ps -q --filter ancestor=jacoworks/vm-agent:latest | xargs -r docker stop && \
		docker ps -aq --filter ancestor=jacoworks/vm-agent:latest | xargs -r docker rm && \
		echo "✅ 旧容器已清理，新容器将由网关按需创建"'
