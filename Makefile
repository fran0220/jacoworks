# JAcoworks — 本地开发 & 部署命令
# 用法: make <target>
# 列出所有: make help

.PHONY: help dev dev-gateway dev-website dev-agent dev-desktop \
        build build-gateway build-website build-agent build-desktop \
        compile-agent prepare-win-deps \
        deploy deploy-gateway deploy-website deploy-agent push-skills \
        check check-gateway check-website check-agent check-desktop \
        check-gateway-e2e check-journeys check-all \
        db-reset db-migrate clean \
        docker-build-agent docker-run-agent

# ─── 配置 ───
JINGAO_HOST   ?= jingao
ORACLE_HOST   ?= opc@10.0.1.3
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

deploy-sync: ## 同步代码到 jingao (git pull)
	@echo "📥 同步代码到 jingao..."
	ssh $(JINGAO_HOST) "cd $(REPO_DIR) && git fetch origin && git reset --hard origin/main"
	@echo "✅ 代码已同步"

deploy-gateway: deploy-sync ## 部署 Gateway 到 jingao (远程编译)
	@echo "📦 部署 Gateway → $(JINGAO_HOST) (远程编译)..."
	ssh $(JINGAO_HOST) " \
		cd $(REPO_DIR)/gateway && \
		export PATH=\$$PATH:/usr/local/go/bin && \
		export GOTOOLCHAIN=local && \
		export GOPROXY=https://goproxy.cn,direct && \
		CGO_ENABLED=0 go build -ldflags='-s -w' -o /tmp/jacoworks-gateway ./cmd/gateway && \
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

check: check-gateway check-website check-agent check-desktop ## 全量检查

check-gateway: ## Go vet + test
	cd gateway && go vet ./... && go test ./...

check-website: ## Cargo check + test
	cd website && cargo check && cargo test

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
	rm -rf desktop/dist/ desktop/src-tauri/target/

# ═══════════════════════════════════════════
#  Docker (vm-agent server → oracle)
# ═══════════════════════════════════════════

docker-build-agent: ## 构建 vm-agent Docker 镜像 (ARM64)
	cd vm-agent && docker buildx build --platform linux/arm64 -t jacoworks/vm-agent:latest .

docker-run-agent: ## 本地启动 vm-agent Docker 容器
	cd vm-agent && docker compose up -d

deploy-agent: docker-build-agent ## 构建并部署 vm-agent 到 oracle
	@echo "📦 导出 ARM64 镜像..."
	docker save jacoworks/vm-agent:latest | gzip > /tmp/vm-agent.tar.gz
	@echo "📤 传输到 oracle (via jingao)..."
	scp /tmp/vm-agent.tar.gz $(JINGAO_HOST):/tmp/vm-agent.tar.gz
	ssh $(JINGAO_HOST) "scp /tmp/vm-agent.tar.gz $(ORACLE_HOST):/tmp/vm-agent.tar.gz && rm /tmp/vm-agent.tar.gz"
	@echo "🔄 加载镜像并重启容器..."
	ssh $(JINGAO_HOST) "ssh $(ORACLE_HOST) ' \
		docker load < /tmp/vm-agent.tar.gz && \
		rm /tmp/vm-agent.tar.gz && \
		docker ps -q --filter ancestor=jacoworks/vm-agent:latest | xargs -r docker stop && \
		docker ps -aq --filter ancestor=jacoworks/vm-agent:latest | xargs -r docker rm && \
		echo \"✅ 镜像已更新, 新容器将由网关按需创建\"'"
	@rm -f /tmp/vm-agent.tar.gz
	@echo "✅ vm-agent 已部署到 oracle"
