# Phase 2 — ZeroClaw 部署验证行动计划

> 日期: 2026-02-21
> 状态: 待执行

---

## 0. 调研发现：AGENTS.md 需修正

通过实际调研 [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw)（4.9k ⭐, MIT），发现 AGENTS.md 中部分描述与实际项目存在偏差：

| 项目 | AGENTS.md 描述 | 实际情况 | 影响 |
|------|---------------|----------|------|
| 版本 | v0.1.0 | **v0.1.1** | 小版本差异 |
| 二进制大小 | ~8.8MB | **~3.4MB** (release profile `opt-level=z` + LTO) | 更小更好 |
| Gateway 默认端口 | 18800 | **8080** (CLI `--port` 可配置) | 可自定义为 18800 |
| 内置工具 | file_read/write/edit, shell, http_request, git, delegate, getSkill | **file_read, file_write, shell, memory_store, memory_recall, memory_forget, browser_open** | 无 file_edit / http_request / git / delegate 独立工具 |
| 子 Agent | `delegate` 工具 + `[agents.*]` 配置 | **未在 README 中出现** | 需源码验证 |
| 配置格式 | `default_provider = "custom:http://..."` | `default_provider = "custom:http://..."` ✅ + 需 `api_key` 字段 | 基本一致 |
| 预编译发布 | 未提及 | **无 Release 页，需从源码编译** | 需在容器内安装 Rust |
| Rust 版本要求 | 未提及 | **rust-version = "1.87"** | 需安装最新 Rust |
| License | 未提及 | Cargo.toml: Apache-2.0, README: MIT | 双许可 |

### 关键风险

1. **无 `file_edit` 工具**：AGENTS.md 列出的 `file_edit`（就地编辑）可能不存在。ZeroClaw 仅有 `file_read` 和 `file_write`。需在源码中确认
2. **无独立 `git` / `http_request` 工具**：可能通过 `shell` 工具执行 `git` 和 `curl` 命令替代
3. **子 Agent (delegate)**：README 未提及，需查看源码 `src/tools/` 目录确认
4. **Pairing 机制**：默认需要配对码才能访问 `/webhook`。需配置 `require_pairing = false` 或在 Go 网关中实现配对流程

---

## 1. 当前宿主机状态

| 项目 | 值 |
|------|-----|
| 架构 | x86_64 |
| OS | Ubuntu (LXD host) |
| 内存 | 62 GB (56 GB 可用) |
| 磁盘 | 1.9 TB (1.7 TB 空闲) |
| Rust | **未安装** |
| 现有容器 | `tpl-nanobot` (RUNNING, 10.10.10.54), `tpl-openclaw` (RUNNING, 10.10.10.126) |
| `tpl-zeroclaw` | **不存在，需创建** |

---

## 2. 执行步骤

### Step 1: 创建 `tpl-zeroclaw` LXD 容器 (5 min)

```bash
# 在宿主机执行
lxc launch ubuntu:24.04 tpl-zeroclaw \
  --network jaconet \
  --config limits.cpu=2 \
  --config limits.memory=2GB \
  --storage default

# 编译期间需要更多内存，完成后再缩到 1GB
# 验证
lxc list tpl-zeroclaw
```

### Step 2: 安装构建依赖 (10 min)

```bash
lxc exec tpl-zeroclaw -- bash -c '
  apt-get update && apt-get install -y \
    build-essential pkg-config git curl \
    && curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && source ~/.cargo/env \
    && rustc --version
'
```

> Rust 1.87+ 要求。`rustup` 默认安装最新 stable。

### Step 3: 编译 ZeroClaw (15-30 min)

```bash
lxc exec tpl-zeroclaw -- bash -c '
  source ~/.cargo/env
  cd /root
  git clone https://github.com/zeroclaw-labs/zeroclaw.git
  cd zeroclaw
  cargo build --release --locked
  ls -lh target/release/zeroclaw
  # 预期: ~3.4MB
  cp target/release/zeroclaw /usr/local/bin/
  zeroclaw --help
'
```

> **注意**: `codegen-units=1` 编译较慢但二进制更小。如果内存不足，使用 `--profile release-fast`（需 16GB+ RAM）。容器分配了 2GB，`codegen-units=1` 应该够用。

### Step 4: 清理构建产物 (节省磁盘)

```bash
lxc exec tpl-zeroclaw -- bash -c '
  rm -rf /root/zeroclaw/target
  # 保留源码以备后续重新编译
  # 或者彻底删除: rm -rf /root/zeroclaw
'
```

### Step 5: 配置 ZeroClaw (5 min)

```bash
lxc exec tpl-zeroclaw -- bash -c '
  mkdir -p ~/.zeroclaw/workspace/skills

  cat > ~/.zeroclaw/config.toml << "EOF"
# JAcoworks ZeroClaw 配置
api_key = "sk-123456"
default_provider = "custom:http://67.230.171.248:8317/v1"
default_model = "claude-sonnet-4-6"
default_temperature = 0.7

[memory]
backend = "sqlite"
auto_save = true
embedding_provider = "noop"   # 暂不使用向量嵌入，避免额外依赖
vector_weight = 0.7
keyword_weight = 0.3

[gateway]
require_pairing = false       # 内网无需配对
allow_public_bind = true      # 允许绑定 0.0.0.0

[autonomy]
level = "full"
workspace_only = true
allowed_commands = [
  "ls", "cat", "head", "tail", "grep", "find", "wc",
  "python3", "pip", "pip3",
  "curl", "wget",
  "git",
  "pandoc",
  "sort", "uniq", "awk", "sed", "jq",
  "date", "echo", "mkdir", "cp", "mv", "rm",
  "tar", "gzip", "unzip"
]
forbidden_paths = ["/etc", "/proc", "/sys", "~/.ssh", "~/.gnupg"]

[runtime]
kind = "native"

[heartbeat]
enabled = false

[tunnel]
provider = "none"

[secrets]
encrypt = false               # 内网模式，简化配置

[browser]
enabled = false

[identity]
format = "openclaw"
EOF

  echo "Config created:"
  cat ~/.zeroclaw/config.toml
'
```

### Step 6: 验证 — 系统状态 (2 min)

```bash
lxc exec tpl-zeroclaw -- zeroclaw status
lxc exec tpl-zeroclaw -- zeroclaw doctor
```

### Step 7: 验证 — LLM 连接 (5 min)

```bash
# 先测试 LLM 代理可达性
lxc exec tpl-zeroclaw -- curl -s http://67.230.171.248:8317/v1/models | head -20

# 测试 Agent 单消息模式
lxc exec tpl-zeroclaw -- zeroclaw agent -m "你好，请回复'连接成功'"
```

**预期**: Agent 通过 custom provider 连接 LLM 代理，返回回复。

**可能问题**:
- 模型名 `claude-sonnet-4-6` 可能需要调整格式（LLM 代理期望的格式）
- 需要验证 custom provider 的 API 格式兼容性

### Step 8: 验证 — 内置工具 (10 min)

```bash
# 测试文件读写 + shell
lxc exec tpl-zeroclaw -- zeroclaw agent -m "请执行以下操作：1) 用 shell 工具运行 'echo hello > /root/.zeroclaw/workspace/test.txt'，2) 用 file_read 读取该文件，3) 告诉我文件内容"

# 测试 memory
lxc exec tpl-zeroclaw -- zeroclaw agent -m "请记住：我的名字是张三，我是产品经理"
lxc exec tpl-zeroclaw -- zeroclaw agent -m "你还记得我叫什么名字吗？"
```

**验证清单**:
- [ ] `shell` 工具 — 执行命令
- [ ] `file_read` — 读取文件
- [ ] `file_write` — 写入文件
- [ ] `memory_store` — 存储记忆
- [ ] `memory_recall` — 召回记忆
- [ ] `memory_forget` — 遗忘记忆

### Step 9: 验证 — Gateway HTTP 端点 (10 min)

```bash
# 启动 Gateway (后台)
lxc exec tpl-zeroclaw -- bash -c '
  zeroclaw gateway --port 18800 &
  sleep 3
'

# 获取容器 IP
ZCIP=$(lxc list tpl-zeroclaw -c 4 -f csv | cut -d' ' -f1)

# 健康检查
curl -s http://$ZCIP:18800/health

# 发送消息 (非流式)
curl -sS http://$ZCIP:18800/webhook \
  -H 'Content-Type: application/json' \
  -d '{"message": "你好，请简短回复"}'

# 如果需要 Bearer token (pairing 模式):
# 1. 查看 zeroclaw gateway 启动日志中的配对码
# 2. curl -X POST http://$ZCIP:18800/pair -H 'X-Pairing-Code: <CODE>'
# 3. 用返回的 token: curl http://$ZCIP:18800/webhook -H 'Authorization: Bearer <TOKEN>' -d '...'
```

**关键验证**:
- [ ] `/health` 返回 200
- [ ] `/webhook` 接受消息并返回 Agent 回复
- [ ] `require_pairing = false` 时是否可以无 token 访问
- [ ] 确认响应格式（是否是 OpenAI 兼容格式，还是自定义格式）

### Step 10: 验证 — 技能系统 (10 min)

```bash
# 创建测试技能
lxc exec tpl-zeroclaw -- bash -c '
  mkdir -p ~/.zeroclaw/workspace/skills/test-skill
  cat > ~/.zeroclaw/workspace/skills/test-skill/SKILL.md << "EOF"
# Test Skill

你是一个测试技能。当被要求测试技能系统时，请回复"技能加载成功！"。

## 使用方法
当用户说"测试技能"时，执行此技能。
EOF
'

# 重启 agent 测试技能发现
lxc exec tpl-zeroclaw -- zeroclaw agent -m "请列出你可用的技能"
lxc exec tpl-zeroclaw -- zeroclaw agent -m "测试技能"
```

### Step 11: 验证 — 源码确认关键工具 (10 min)

需要在源码中确认以下工具是否存在：

```bash
lxc exec tpl-zeroclaw -- bash -c '
  cd /root/zeroclaw
  # 列出所有工具实现
  ls -la src/tools/
  # 搜索 delegate / file_edit / http_request / git 工具
  grep -r "delegate\|file_edit\|http_request\|git" src/tools/ --include="*.rs" -l
'
```

### Step 12: 创建 systemd 服务

```bash
lxc exec tpl-zeroclaw -- bash -c '
  cat > /etc/systemd/system/zeroclaw-gateway.service << "EOF"
[Unit]
Description=ZeroClaw Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.zeroclaw/workspace
ExecStart=/usr/local/bin/zeroclaw gateway --port 18800
Restart=on-failure
RestartSec=5
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable zeroclaw-gateway
  systemctl start zeroclaw-gateway
  sleep 2
  systemctl status zeroclaw-gateway
'
```

### Step 13: 创建快照

```bash
# 停止 gateway 服务以获取干净快照
lxc exec tpl-zeroclaw -- systemctl stop zeroclaw-gateway

# 创建快照
lxc snapshot tpl-zeroclaw base-verified

# 验证快照
lxc info tpl-zeroclaw | grep -A5 Snapshots

# 重新启动服务
lxc exec tpl-zeroclaw -- systemctl start zeroclaw-gateway
```

### Step 14: 缩减容器资源

```bash
# 编译完成后，缩减到生产配置
lxc config set tpl-zeroclaw limits.memory 1GB
```

---

## 3. 验证结果模板

完成后填写：

| 功能 | 状态 | 详情 |
|------|------|------|
| ZeroClaw 编译安装 | 🔲 | binary size, build time |
| LLM 连接 (Claude) | 🔲 | custom provider → LLM 代理 |
| LLM 连接 (GPT) | 🔲 | 切换模型测试 |
| 工具: shell | 🔲 | 命令执行 + 白名单 |
| 工具: file_read | 🔲 | 文件读取 |
| 工具: file_write | 🔲 | 文件写入 |
| 工具: file_edit | 🔲 | 是否存在？ |
| 工具: memory_store | 🔲 | 记忆存储 |
| 工具: memory_recall | 🔲 | 记忆召回 |
| Gateway /health | 🔲 | HTTP 健康检查 |
| Gateway /webhook | 🔲 | 消息收发 |
| Gateway 认证 | 🔲 | require_pairing=false 行为 |
| 技能发现 | 🔲 | SKILL.md 自动加载 |
| 技能执行 | 🔲 | getSkill / 技能调用 |
| delegate (子 Agent) | 🔲 | 是否存在？ |
| systemd 服务 | 🔲 | 开机自启 |
| 快照 | 🔲 | base-verified |

---

## 4. 后续 AGENTS.md 更新清单

验证完成后，需根据实际结果更新 AGENTS.md：

1. [ ] 修正 ZeroClaw 版本号 (v0.1.0 → v0.1.1)
2. [ ] 修正二进制大小 (~8.8MB → ~3.4MB)
3. [ ] 修正内置工具列表（根据源码实际情况）
4. [ ] 修正 Gateway 端口说明（默认 8080，我们配置为 18800）
5. [ ] 补充 `api_key` 配置字段
6. [ ] 补充 `embedding_provider` 配置
7. [ ] 确认并更新子 Agent / delegate 相关描述
8. [ ] 补充 Rust 版本要求 (1.87+)
9. [ ] 补充无预编译发布，需从源码构建

---

## 5. 时间估算

| 步骤 | 时间 |
|------|------|
| 容器创建 + 依赖安装 | 15 min |
| Rust 安装 + ZeroClaw 编译 | 20-40 min |
| 配置 + 基础验证 | 15 min |
| 工具 + Gateway 验证 | 20 min |
| 技能 + 源码确认 | 15 min |
| systemd + 快照 | 10 min |
| **总计** | **~1.5-2 小时** |

---

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Rust 编译失败 (依赖/内存) | 低 | 容器 2GB 应足够；`--locked` 锁定依赖 |
| LLM 代理模型名不兼容 | 中 | 先 curl 测试 `/v1/models`，确认模型名格式 |
| `require_pairing = false` 仍需 token | 中 | 查看源码确认行为，必要时实现配对流程 |
| 缺少 file_edit / delegate 等工具 | 高 | shell 工具可替代 file_edit (`sed`/`awk`)；delegate 非必需功能 |
| custom provider 格式不兼容 | 中 | 检查 ZeroClaw 对 custom provider 的 API 请求格式 |
