# Phase 2 — OpenClaw 重新部署验证行动计划

> 日期: 2026-02-22
> 状态: 待执行
> 引擎: OpenClaw (v2026.2.21)
> 基础: 复用已有 `tpl-openclaw` 容器 (快照 `gateway-v4-e2e-verified`)

---

## 0. 背景

经过 6 方案源码级选型 (OpenClaw, PicoClaw, IronClaw, pi_agent_rust, pi-mono, ZeroClaw)，最终决定切回 OpenClaw：
- 资源约束解除（宿主机将随规模扩容），内存不再是硬约束
- OpenClaw 功能碾压全场：40+ HTTP API、向量记忆、浏览器自动化、3000+ 技能
- 已有验证基础：`tpl-openclaw` 容器快照 `gateway-v4-e2e-verified` 已通过端到端验证
- 管理网关开发量减少 ~60%（OpenClaw 已内置 OpenAI 兼容 API + IM 通道插件）

**本次 Phase 2 目标**: 在已有验证基础上，升级到最新版本，完成全功能验证。

---

## 1. 当前宿主机状态

| 项目 | 值 |
|------|-----|
| 架构 | x86_64 |
| OS | Ubuntu (LXD host) |
| 内存 | 62 GB (56 GB 可用) |
| 磁盘 | 1.9 TB (1.7 TB 空闲) |
| Node.js | 需确认容器内版本 (需 ≥22.12.0) |
| 现有容器 | `tpl-openclaw` (10.10.10.126, RUNNING), `tpl-nanobot` (10.10.10.54, RUNNING) |
| OpenClaw 快照 | `gateway-v4-e2e-verified` ✅ |

---

## 2. 执行步骤

### Step 1: 恢复容器到已验证快照 (2 min)

```bash
# 检查当前容器状态
ssh local "lxc info tpl-openclaw | head -20"
ssh local "lxc info tpl-openclaw | grep -A10 Snapshots"

# 如果容器状态不干净，恢复到已验证快照
ssh local "lxc restore tpl-openclaw gateway-v4-e2e-verified"
ssh local "lxc start tpl-openclaw"

# 验证容器运行
ssh local "lxc list tpl-openclaw"
```

### Step 2: 检查当前 OpenClaw 版本 (2 min)

```bash
ssh local "lxc exec tpl-openclaw -- bash -c '
  node --version
  npx openclaw --version 2>/dev/null || openclaw --version 2>/dev/null || echo \"OpenClaw not found in PATH\"
  which openclaw 2>/dev/null || echo \"searching...\"
  find / -name openclaw -type f 2>/dev/null | head -5
'"
```

### Step 3: 升级 Node.js (如需) + 升级 OpenClaw (10 min)

```bash
ssh local "lxc exec tpl-openclaw -- bash -c '
  # 确保 Node.js >= 22.12.0
  NODE_VER=\$(node --version | sed \"s/v//\")
  echo \"Current Node.js: \$NODE_VER\"

  # 如果版本不够，升级 Node.js
  # curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  # apt-get install -y nodejs

  # 升级 OpenClaw 到最新版
  npm install -g openclaw@latest

  # 验证版本
  openclaw --version
'"
```

### Step 4: 配置 config.yml (5 min)

```bash
ssh local "lxc exec tpl-openclaw -- bash -c '
  mkdir -p ~/.openclaw/workspace/skills

  cat > ~/.openclaw/config.yml << \"EOFYML\"
# JAcoworks OpenClaw 配置

gateway:
  bind: all
  port: 18789
  password: \"\"

models:
  default: claude-sonnet-4-6
  providers:
    llm-proxy:
      baseUrl: \"http://67.230.171.248:8317/v1\"
      api: \"openai-completions\"
      apiKey: \"sk-123456\"
      models:
        - id: \"claude-sonnet-4-6\"
          name: \"Claude Sonnet\"
          contextWindow: 200000
          maxTokens: 8192
        - id: \"gpt-5.2\"
          name: \"GPT-5.2\"
          contextWindow: 128000
          maxTokens: 8192
        - id: \"gemini-3-pro-preview\"
          name: \"Gemini Pro\"
          contextWindow: 1000000
          maxTokens: 8192

agents:
  defaults:
    model: claude-sonnet-4-6
    maxTokens: 8192
    temperature: 0.7

tools:
  exec:
    approval: auto
    sandbox: none
  web:
    search:
      provider: duckduckgo
    fetch:
      enabled: true
  browser:
    enabled: false

memory:
  embeddings:
    provider: \"none\"

security:
  workspace: \"~/.openclaw/workspace\"
  restrictToWorkspace: true

heartbeat:
  enabled: false
EOFYML

  echo \"Config created:\"
  cat ~/.openclaw/config.yml
'"
```

### Step 5: 验证 — LLM 连接 (5 min)

```bash
# 先测试 LLM 代理可达性
ssh local "lxc exec tpl-openclaw -- curl -s http://67.230.171.248:8317/v1/models | head -20"

# 启动 OpenClaw Gateway (后台)
ssh local "lxc exec tpl-openclaw -- bash -c '
  nohup openclaw gateway run --bind all --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
  sleep 5
  echo \"Gateway PID: \$(pgrep -f \"openclaw gateway\")\"
  tail -20 /tmp/openclaw-gateway.log
'"

# 获取容器 IP
OCIP=$(ssh local "lxc list tpl-openclaw -c 4 -f csv | cut -d' ' -f1")
echo "OpenClaw IP: $OCIP"

# 测试 OpenAI 兼容端点
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"你好，请简短回复\"}],
    \"stream\": false
  }'"
```

**预期**: 通过自定义 `baseUrl` 连接 LLM 代理，返回 OpenAI 格式响应。

### Step 6: 验证 — SSE 流式响应 (5 min)

```bash
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"写一首关于春天的短诗\"}],
    \"stream\": true
  }'"
```

**预期**: SSE 流式返回 `data: {...}` 事件。

### Step 7: 验证 — 内置工具 (10 min)

```bash
# 测试 exec 工具 (通过对话触发)
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"请执行 echo hello world 命令，并告诉我输出\"}],
    \"stream\": false
  }'"

# 测试 apply_patch 工具 (文件写入)
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"请创建一个文件 test.txt，内容为 JAcoworks 测试成功，然后读取并告诉我内容\"}],
    \"stream\": false
  }'"
```

**验证清单**:
- [ ] `exec` 工具 — 执行 shell 命令
- [ ] `apply_patch` — 创建/修改文件
- [ ] `web_search` — 搜索 (DuckDuckGo)
- [ ] `web_fetch` — 网页内容提取
- [ ] `memory_search` — 记忆搜索
- [ ] `cron` — 定时任务
- [ ] `sessions_spawn` — 子 Agent
- [ ] `message` — 消息发送

### Step 8: 验证 — 技能系统 (10 min)

```bash
# 创建测试技能
ssh local "lxc exec tpl-openclaw -- bash -c '
  mkdir -p ~/.openclaw/workspace/skills/test-skill
  cat > ~/.openclaw/workspace/skills/test-skill/SKILL.md << \"EOF\"
# Test Skill

你是一个测试技能。当被要求测试技能系统时，请回复"技能加载成功！JAcoworks 万岁！"。

## 使用方法
当用户说"测试技能"时，执行此技能。
EOF
'"

# 测试技能发现
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"测试技能\"}],
    \"stream\": false
  }'"
```

### Step 9: 验证 — 飞书插件 (15 min)

```bash
# 安装飞书插件
ssh local "lxc exec tpl-openclaw -- openclaw plugin install feishu"

# 配置飞书凭证 (需要实际的飞书应用凭证)
# 在 config.yml 中添加:
# plugins:
#   feishu:
#     enabled: true
#     appId: "cli_xxx"
#     appSecret: "xxx"

# 重启 gateway 加载插件
ssh local "lxc exec tpl-openclaw -- bash -c '
  pkill -f \"openclaw gateway\" || true
  sleep 2
  nohup openclaw gateway run --bind all --port 18789 > /tmp/openclaw-gateway.log 2>&1 &
  sleep 5
  tail -30 /tmp/openclaw-gateway.log | grep -i feishu
'"
```

**预期**: 日志显示飞书 WebSocket 连接成功。

### Step 10: 验证 — 向量记忆搜索 (10 min)

```bash
# 存储记忆
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"请记住：我的名字是张三，我是产品经理，我负责 JAcoworks 项目\"}],
    \"stream\": false
  }'"

# 测试记忆召回
ssh local "curl -sS http://$OCIP:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    \"model\": \"claude-sonnet-4-6\",
    \"messages\": [{\"role\": \"user\", \"content\": \"你还记得我叫什么名字吗？我负责什么项目？\"}],
    \"stream\": false
  }'"
```

### Step 11: 配置 systemd 服务 (5 min)

```bash
ssh local "lxc exec tpl-openclaw -- bash -c '
  cat > /etc/systemd/system/openclaw-gateway.service << \"EOF\"
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw/workspace
ExecStart=/usr/bin/env openclaw gateway run --bind all --port 18789
Restart=on-failure
RestartSec=5
Environment=HOME=/root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  # 先停止手动启动的进程
  pkill -f \"openclaw gateway\" || true
  sleep 2

  systemctl daemon-reload
  systemctl enable openclaw-gateway
  systemctl start openclaw-gateway
  sleep 5
  systemctl status openclaw-gateway
'"
```

### Step 12: 创建快照 (5 min)

```bash
# 停止 gateway 获取干净快照
ssh local "lxc exec tpl-openclaw -- systemctl stop openclaw-gateway"

# 创建快照
ssh local "lxc snapshot tpl-openclaw v2-full-verified"

# 验证快照
ssh local "lxc info tpl-openclaw | grep -A10 Snapshots"

# 重新启动
ssh local "lxc exec tpl-openclaw -- systemctl start openclaw-gateway"
```

---

## 3. 验证结果模板

完成后填写：

| 功能 | 状态 | 详情 |
|------|------|------|
| OpenClaw 升级 | 🔲 | 版本号, npm install 成功 |
| Node.js 版本 | 🔲 | ≥22.12.0 |
| LLM 连接 (Claude) | 🔲 | baseUrl → LLM 代理 |
| LLM 连接 (GPT) | 🔲 | 切换模型测试 |
| /v1/chat/completions | 🔲 | OpenAI 兼容端点 |
| SSE 流式响应 | 🔲 | stream: true |
| 工具: exec | 🔲 | Shell 命令执行 |
| 工具: apply_patch | 🔲 | 文件创建/修改 |
| 工具: web_search | 🔲 | DuckDuckGo 搜索 |
| 工具: web_fetch | 🔲 | 网页内容提取 |
| 工具: memory_search | 🔲 | 记忆搜索 |
| 工具: sessions_spawn | 🔲 | 子 Agent |
| 技能发现 | 🔲 | SKILL.md 自动加载 |
| 飞书插件 | 🔲 | WebSocket 连接 |
| 钉钉插件 | 🔲 | Extension 安装 |
| 企微插件 | 🔲 | Extension 安装 |
| 向量记忆 | 🔲 | SQLite-vec 搜索 |
| systemd 服务 | 🔲 | 开机自启 |
| 快照 | 🔲 | v2-full-verified |

---

## 4. 时间估算

| 步骤 | 时间 |
|------|------|
| 容器恢复 + 版本检查 | 5 min |
| Node.js 升级 + OpenClaw 升级 | 15 min |
| 配置 + LLM 验证 | 10 min |
| 工具验证 | 15 min |
| 技能 + 飞书插件 | 20 min |
| 记忆 + systemd + 快照 | 15 min |
| **总计** | **~1.5 小时** |

> 比 ZeroClaw 方案 (需编译 30 min) 和 PicoClaw 方案 (需写 HTTP Channel) 都更快。
> 因为有已验证快照 `gateway-v4-e2e-verified` 作为基础。

---

## 5. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| OpenClaw 新版本 breaking changes | 中 | 快照回退 + 锁定版本 |
| config.yml `baseUrl` 格式变化 | 中 | 查看新版文档 + 源码确认 |
| 飞书插件安装失败 | 中 | 使用社区 Docker 镜像 (OpenClaw-Docker-CN-IM) |
| 容器内存超 2 GB | 低 | 热调整 `lxc config set limits.memory` |
| Node.js 22 与 LXD 容器兼容性 | 低 | Ubuntu 24.04 原生支持 |

---

## 6. 与旧 Phase 2 计划的对比

| 维度 | ZeroClaw 旧计划 | OpenClaw 新计划 |
|------|----------------|----------------|
| 预计时间 | 1.5-2 小时 | **~1.5 小时** |
| 编译/安装 | Rust 编译 20-40 min | `npm install` ~5 min |
| 已有基础 | 无 (tpl-zeroclaw 不存在) | ✅ 已有 tpl-openclaw + 快照 |
| HTTP API | 需验证 /webhook | ✅ 已验证 /v1/chat/completions |
| 飞书通道 | 不支持 | ✅ Extension 插件 |
| 工具数量 | 7 个 | **25+ 个** |
| 记忆系统 | SQLite (需验证) | SQLite-vec 向量 (更强) |
