# nanobot 端到端验证测试报告

> 日期: 2026-02-21  
> nanobot 版本: v0.1.4  
> 测试环境: LXD 容器 `tpl-nanobot` @ 10.10.10.54  
> 快照: `http-api-verified-v1`（最新）, `e2e-verified-v1`

---

## 1. 环境概览

| 项目 | 值 |
|------|-----|
| 宿主机 | 192.168.31.162 (Ubuntu, SSH alias: `local`) |
| LXD 容器 | `tpl-nanobot` (10.10.10.54) |
| LXD 桥接 | `jaconet` (10.10.10.0/24) |
| 容器资源限制 | 1GB RAM, 2 CPU |
| Python | 3.12.3 |
| 安装方式 | `pipx install nanobot-ai` |
| LLM 代理 | http://67.230.171.248:8317 (key: `sk-123456`) |
| 主模型 | `gpt-5.2`（通过 custom provider） |
| 配置文件 | `/root/.nanobot/config.json` |

---

## 2. 测试结果摘要

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 安装 & 启动 | ✅ 通过 | `pipx install nanobot-ai`，一键安装 |
| LLM 代理连接 | ✅ 通过 | custom provider 对接成功 |
| CLI 对话（GPT-5.2） | ✅ 通过 | 正常回复 |
| CLI 对话（Claude） | ✅ 通过 | proxy_ 前缀已修复，工具调用正常 |
| 工具: write_file | ✅ 通过 | 文件创建成功 |
| 工具: read_file | ✅ 通过 | 文件读取成功 |
| 工具: edit_file | ✅ 通过 | 就地编辑成功 |
| 工具: list_dir | ✅ 通过 | 目录列表正确 |
| 工具: exec | ✅ 通过 | 命令执行 + 输出捕获成功 |
| 工具: web_fetch | ✅ 通过 | HTTP 抓取 + 内容解析成功 |
| 多步骤工具链 | ✅ 通过 | 创建→运行→写入→列出，4步链式调用完美 |
| 多轮会话记忆 | ✅ 通过 | 跨消息记住用户身份信息 |
| Gateway 模式 | ✅ 启动 | channel-based，无内建 HTTP API |
| HTTP API (自建) | ✅ 通过 | `/v1/chat/completions` 非流式 + SSE 流式均通过 |
| HTTP API 认证 | ✅ 通过 | Bearer Token 认证 + 拒绝无效 Token |
| HTTP API 多用户 | ✅ 通过 | `user` 字段隔离会话（employee-002/003 测试通过） |
| HTTP API + 工具 | ✅ 通过 | Claude 通过 HTTP API 调用 write_file + exec 成功 |
| Feishu 集成 | 🔲 待测 | 需要飞书 App 凭据 |

---

## 3. 关键发现

### 3.1 Claude 模型工具名前缀问题

**现象**: 通过 LLM 代理调用 Claude Sonnet 4.6 时，模型在 tool_calls 响应中自行给工具名加 `proxy_` 前缀（如 `write_file` → `proxy_write_file`），导致 nanobot 找不到对应工具。

**验证**: 直接 curl 测试确认是 Claude 模型行为，非代理修改：
```bash
# Claude: 返回 "proxy_write_file" ❌
curl .../v1/chat/completions -d '{"model":"claude-sonnet-4-6","tools":[{"function":{"name":"write_file",...}}]}'

# GPT-5.2: 返回 "write_file" ✅  
curl .../v1/chat/completions -d '{"model":"gpt-5.2","tools":[{"function":{"name":"write_file",...}}]}'
```

**修复**: 在 `CustomProvider._parse()` 中添加前缀剥离逻辑：
```python
for tc in (msg.tool_calls or []):
    name = tc.function.name
    if name.startswith('proxy_'):
        name = name[6:]  # strip proxy_ prefix
    tool_calls.append(ToolCallRequest(id=tc.id, name=name, ...))
```

**状态**: ✅ 已修复并验证。Claude 现在可以正常调用所有工具。

### 3.2 Gateway 无 HTTP API

nanobot 的 `gateway` 命令仅启动 channel 管理器（Telegram/Feishu/Discord等），不暴露 HTTP API。

**已解决**: 创建 `nanobot/http_api.py` 模块，基于 Starlette + uvicorn 实现：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查，返回模型名 |
| `/v1/chat/completions` | POST | OpenAI 兼容对话（非流式 + SSE 流式） |

启动方式: `nanobot http --port 18790 --token <TOKEN>`

**状态**: ✅ 已实现并验证。支持非流式、SSE 流式、Bearer Token 认证、多用户会话隔离。

### 3.3 资源使用对比

| 指标 | nanobot | OpenClaw |
|------|---------|----------|
| 容器磁盘 | 1.15 GB | 224 MB (但需 Docker-in-Docker) |
| 实际内存 (进程) | **~30 MB** | **~380 MB** (gateway 进程) |
| 容器总内存 (含缓存) | ~672 MB | ~712 MB |
| 核心进程数 | 1 (Python) | 2 (openclaw + openclaw-gateway) |
| 依赖 | Python 3.12 + pip packages | Node.js + Docker |
| 沙箱 | 进程级 (restrictToWorkspace) | Docker 容器级 |
| 启动时间 | < 2s | ~5s |

---

## 4. 配置文件

### 4.1 最终工作配置

```json
{
  "agents": {
    "defaults": {
      "model": "gpt-5.2",
      "maxTokens": 8192,
      "temperature": 0.7,
      "maxToolIterations": 20,
      "memoryWindow": 50,
      "workspace": "/root/.nanobot/workspace"
    }
  },
  "providers": {
    "custom": {
      "apiKey": "sk-123456",
      "apiBase": "http://67.230.171.248:8317/v1"
    }
  },
  "tools": {
    "restrictToWorkspace": false,
    "exec": { "timeout": 60 }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

### 4.2 systemd 服务（待创建）

```ini
[Unit]
Description=nanobot Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.nanobot/workspace
Environment=PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/root/.local/bin/nanobot gateway --port 18790
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 5. nanobot vs OpenClaw 对比总结

| 维度 | nanobot | OpenClaw | JAcoworks 选择 |
|------|---------|----------|---------------|
| 代码量 | ~4,000 行 Python | 430,000+ 行 Node.js | nanobot ✅ 易维护 |
| 内存占用 | ~30 MB | ~380 MB | nanobot ✅ 10x 更省 |
| 安装复杂度 | `pip install` | 多步配置 | nanobot ✅ |
| LLM Provider | LiteLLM + Custom (直连) | 内置 Provider + 自定义 | 持平 |
| 工具调用 | ✅ 完整 (GPT-5.2) | ✅ 完整 | 持平 |
| Feishu 集成 | ✅ WebSocket 长连接 | 有限 | nanobot ✅ |
| HTTP API | ❌ 需自建 | ✅ 内建 | OpenClaw ✅ |
| MCP 支持 | ✅ Stdio + HTTP | 内置 | 持平 |
| 沙箱隔离 | 进程级 | Docker 容器级 | OpenClaw ✅ 更强 |
| 多用户 | 需自行实现 | 单实例单用户 | 持平 |
| 成熟度 | Alpha (v0.1.4) | 生产级 | OpenClaw ✅ |

---

## 6. 快照信息

| 快照名 | 日期 | 说明 |
|--------|------|------|
| `e2e-verified-v1` | 2026-02-21 | ✅ nanobot v0.1.4, GPT-5.2 基础验证 |
| `http-api-verified-v1` | 2026-02-21 | ✅ HTTP API + Claude 修复，全功能验证 |

---

## 7. 后续计划

### ~~Phase 1 — HTTP API 包装层~~ ✅ 已完成
- [x] 基于 Starlette + uvicorn 实现 `/v1/chat/completions` 端点
- [x] 支持 SSE 流式输出
- [x] 添加 Bearer Token 认证
- [x] 兼容 OpenAI API 格式

### ~~Phase 4 — Claude 兼容修复~~ ✅ 已完成
- [x] 在 CustomProvider._parse() 中 strip `proxy_` 前缀

### Phase 2 — Feishu Bot 集成（下一步）
- [ ] 创建飞书应用并获取 appId/appSecret
- [ ] 配置 nanobot Feishu channel
- [ ] 测试消息收发 + 文件传输

### Phase 3 — 多用户架构
- [ ] 轻量化方案：单进程多 session（通过 session_key / user 字段隔离）
- [ ] 中量级方案：每用户一个 nanobot 进程（systemd template）
- [ ] 重量级方案：每用户一个 LXD 容器（克隆 tpl-nanobot）

### Phase 5 — 生产化
- [ ] 预制技能包迁移（SKILL.md 格式兼容）
- [ ] 安全加固（restrictToWorkspace=true，allowFrom 白名单）
- [ ] systemd 服务配置（nanobot http）
- [ ] 监控 + 日志收集
