# JAcoworks CI/CD & 本地开发指南

## 概览

项目由 4 个模块组成，部署位置不同：

| 模块 | 语言 | 部署位置 | 触发方式 |
|------|------|---------|---------|
| **gateway** | Go | jingao 82.156.239.212 (systemd) | push main + 文件变更 |
| **website** | Rust/Axum | jingao 同机 (systemd) | push main + 文件变更 |
| **vm-agent** | TypeScript | 打包进 desktop sidecar | 随 desktop 发布 |
| **desktop** | Tauri v2 + React | GitHub Release (用户下载) | git tag `v*` |

## CI/CD 流水线

### 1. CI — 每次 PR / push main

`.github/workflows/ci.yml`

```
PR / push main
  ├─ 变更检测 (paths-filter)
  ├─ gateway/**  → go vet + go test + build
  ├─ website/**  → cargo check + cargo test + build
  ├─ vm-agent/** → npm typecheck + build
  └─ desktop/**  → npm typecheck
```

**特点**: 只构建有改动的模块，节省 CI 时间。

### 2. 自动部署 — push main 到服务器

`.github/workflows/deploy.yml`

```
push main (gateway/** or website/**)
  ├─ 交叉编译 linux/amd64
  ├─ SSH 连接 jingao
  ├─ 停止旧服务 → 替换二进制 → 启动新服务
  └─ 健康检查 (curl /health 或 /)
```

**部署策略**: 原地替换 (stop → swap → start)，非蓝绿。够用就行。

### 3. 桌面端发布 — git tag

`.github/workflows/release-desktop.yml`

```
git tag v0.2.0 && git push --tags
  ├─ 构建 vm-agent sidecar
  └─ 跨平台构建 Tauri
       ├─ macOS arm64 (.dmg)
       ├─ macOS x64 (.dmg)
       ├─ Windows x64 (.msi/.exe)
       └─ Linux x64 (.deb/.AppImage)
  → GitHub Release (draft)
```

## GitHub Secrets 配置

在 repo Settings → Secrets and variables → Actions 添加：

| Secret | 说明 |
|--------|------|
| `JINGAO_HOST` | jingao 服务器 IP (82.156.239.212) |
| `JINGAO_SSH_KEY` | SSH 私钥 (ed25519)，对应 jingao authorized_keys |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 签名密钥 (可选) |
| `TAURI_SIGNING_KEY_PASSWORD` | 签名密钥密码 (可选) |

### 生成部署用 SSH 密钥

```bash
# 本地生成专用密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/jingao_deploy -N ""

# 公钥添加到 jingao
ssh jingao "cat >> ~/.ssh/authorized_keys" < ~/.ssh/jingao_deploy.pub

# 私钥内容复制到 GitHub Secret JINGAO_SSH_KEY
cat ~/.ssh/jingao_deploy
```

## 本地开发

### 快速开始

```bash
# 查看所有可用命令
make help

# 各模块独立开发 (分别在不同终端)
make dev-gateway    # Go 网关 → localhost:8847
make dev-website    # Rust 官网 → localhost:9527
make dev-agent      # vm-agent 热重载 (调试用)
make dev-desktop    # Tauri 桌面端 (自带 Vite HMR)
```

### 前置条件

```bash
# Go (gateway)
go version    # >= 1.24

# Rust (website + desktop)
rustup update stable
cargo install cargo-watch    # 可选: 自动重编译

# Node (vm-agent + desktop frontend)
node -v       # >= 22
cd vm-agent && npm install
cd desktop && npm install

# Tauri CLI
cargo install tauri-cli --version "^2"

# 数据库 — 需要能连到 jingao PostgreSQL
# 方案 A: SSH 隧道
ssh -L 5432:127.0.0.1:5432 jingao
# 方案 B: 本地 PostgreSQL
createdb jacoworks
psql jacoworks < deploy/sql/001_init_business_tables.sql
psql jacoworks < deploy/sql/002_website_tables.sql
```

### 开发配置

**Gateway** — 复制并修改:
```bash
cp gateway/gateway.yaml.example gateway/gateway.yaml
# 编辑 database.url 指向本地或隧道的 PG
```

**Website** — 复制并修改:
```bash
cp website/website.toml.example website/website.toml
# 编辑 database.url
```

**vm-agent** — 环境变量:
```bash
cp vm-agent/.env.template vm-agent/.env
# 填入 LLM_PROXY_URL / LLM_PROXY_KEY
```

**Desktop** — 环境变量:
```bash
cp desktop/.env.example desktop/.env
# VITE_GATEWAY_URL=http://localhost:8847  (连本地 gateway)
# 或 VITE_GATEWAY_URL=https://jacoapi.jingao.club (连线上)
```

### 推荐工作流

```
日常开发:
  1. 改代码 → make check (快速验证)
  2. PR → CI 自动跑 lint + test
  3. merge main → 自动部署 gateway/website

发版:
  1. 更新 desktop/src-tauri/tauri.conf.json 版本号
  2. 更新 website/content/changelog.md
  3. git tag v0.2.0 && git push --tags
  4. GitHub Actions 构建 → Draft Release
  5. 检查安装包 → Publish Release
  6. 在官网 admin 后台创建对应版本记录
```

### 手动部署 (不依赖 CI)

```bash
# 部署全部
make deploy

# 只部署某个
make deploy-gateway
make deploy-website

# 自定义目标主机
make deploy JINGAO_HOST=root@82.156.239.212
```

## 架构决策

### 为什么不用 Docker？

- jingao 是单台小机器，跑 systemd 二进制更轻量
- Gateway 和 Website 都是静态编译的单二进制，部署就是 scp + restart
- 容器化的收益（环境隔离、编排）在当前规模下不值

### 为什么不用蓝绿部署？

- 单机服务，stop → swap → start 通常 < 2s 停机
- 如果未来需要零停机，加一层 systemd socket activation 或 OpenResty upstream health check

### vm-agent 为什么不单独部署？

- vm-agent 是 desktop 的 sidecar，通过 stdin/stdout RPC 通信
- 它随 desktop 打包分发，不需要独立部署
- 协作模式下的 agent 运行在 Docker 容器里（独立管理）
