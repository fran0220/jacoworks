---
name: openclaw-integration
description: "OpenClaw container integration with JAcoworks gateway. Use when deploying, configuring, debugging, or extending OpenClaw containers, the WS protocol bridge, or container_type dispatch logic."
---

# OpenClaw Integration

JAcoworks 网关通过 `OpenClawBridge` 支持 OpenClaw 容器作为云端 Agent 后端，与自研 vm-agent 并存。

## 架构

```
webchat → /ws/oc?ticket= → WSHandler
  ├─ container_type == "vm-agent"  → ChannelPool → vm-agent 容器 (现有路径)
  └─ container_type == "openclaw"  → OpenClawBridge → OpenClaw 容器 (新路径)
```

**关键文件**:
- `gateway/internal/agent/openclaw_bridge.go` — 透明 WS 代理 (双向帧转发 + HTTP 健康检查)
- `gateway/internal/agent/ws_handler.go` — `/ws/oc` 入口, 按 `container_type` 分派
- `gateway/internal/store/containers.go` — `ContainerInfo.ContainerType` 字段
- `deploy/sql/010_container_type.sql` — DB 迁移
- `gateway/cmd/gateway/main.go` — 接线 (`NewOpenClawBridge` + `SetOpenClawBridge`)
- `webchat/src/lib/openclaw-client.ts` — 前端原生 OpenClaw WS 客户端 (challenge-response + chat)
- `webchat/src/lib/event-parser.ts` — OpenClaw 事件解析 (agent/chat 事件 → UI 块)
- `webchat/src/lib/ws-client.ts` — WSClient 适配层 (统一 prompt/abort 接口)
- `website/src/routes/chat.rs` — 注入 `__OPENCLAW_TOKEN__` (从 DB 查询)

## OpenClaw WS 协议 (逆向验证)

### 帧类型

| 类型 | 方向 | 格式 |
|------|------|------|
| `req` | client → server | `{type:"req", id, method, params}` |
| `res` | server → client | `{type:"res", id, ok, payload/error}` |
| `event` | server → client | `{type:"event", event, payload, seq}` |

### 握手流程

1. Server 发送: `{type:"event", event:"connect.challenge", payload:{nonce:"..."}}`
2. Client 发送:
   ```json
   {
     "type": "req", "id": "gw-connect-1", "method": "connect",
     "params": {
       "minProtocol": 3, "maxProtocol": 3,
       "client": {"id": "gateway-client", "version": "1.0.0", "platform": "linux", "mode": "backend"},
       "auth": {"token": "<container_token>"},
       "role": "operator",
       "scopes": ["operator.admin"],
       "caps": ["tool-events"]
     }
   }
   ```
3. Server 响应: `{type:"res", id:"gw-connect-1", ok:true, payload:{type:"hello-ok",...}}`

### 客户端身份

**client.id** 必须是预定义值之一:
`webchat-ui`, `openclaw-control-ui`, `webchat`, `cli`, `gateway-client`, `openclaw-macos`, `openclaw-ios`, `openclaw-android`, `node-host`, `test`, `fingerprint`, `openclaw-probe`

**client.mode** 必须是:
`webchat`, `cli`, `ui`, `backend`, `node`, `probe`, `test`

网关集成使用 `gateway-client` + `backend`。`webchat` client id 需要 CORS allowedOrigins 检查，`gateway-client` 不需要。

### 对话协议

| 操作 | 方法 | 参数 |
|------|------|------|
| 发送消息 | `chat.send` | `{sessionKey, message, idempotencyKey}` |
| 中止生成 | `chat.abort` | `{sessionKey, runId?}` |

**注意**: `send` 方法 (非 `chat.send`) 用于 Channel 投递 (WhatsApp/Telegram), 需要 `to` 和 `idempotencyKey`。

### 事件流

| 事件 | 含义 | payload 关键字段 |
|------|------|-----------------|
| `agent` stream=`text`/`assistant` | 流式文本 (逐 token) | `data.delta` (增量) / `data.text` (累计) |
| `agent` stream=`thinking`/`reasoning` | 思考过程 | `data.phase` (start/end), `data.text` |
| `agent` stream=`tool` | 工具调用 | `data.phase` (start/update/result/error), `data.name`, `data.args` |
| `agent` stream=`lifecycle` | 生命周期 | `data.phase` (start/end/error) |
| `chat` state=`final` | 完成 | `message.content[{type:"text",text}]` |
| `chat` state=`error` | 错误 | `errorMessage` |
| `chat` state=`delta` | 累计快照 | `message.content[...]` — **前端应忽略, 用 agent stream 代替** |
| `tick`, `health` | 内部 | 静默丢弃 |

**重要**: OpenClaw 同时发送 `agent` stream (逐 token delta) 和 `chat` delta (累计文本快照)。前端只能使用其中一路，否则文本会重复渲染。webchat 选择只用 `agent` stream 事件, `chat` delta 被忽略 (`event-parser.ts`)。

### 协议翻译映射

| webchat (下游) | OpenClaw (上游) |
|----------------|-----------------|
| `prompt` → | `chat.send` |
| `abort` → | `chat.abort` |
| ← `response` | ← agent stream=text |
| ← `done` | ← chat state=final |
| ← `error` | ← chat state=error |
| ← `session_event` | ← agent stream=lifecycle(error) / 其他事件 |

## OpenClaw 容器部署

### 测试环境 (local, 192.168.31.162)

```bash
# SSH: ssh local (root)
# 镜像: ghcr.io/openclaw/openclaw:latest
# 端口: 18789 (OpenClaw 默认)
# 容器用户: node (uid 1000), 非 root

# 数据目录 (必须 chown 1000:1000)
/opt/openclaw/data:/home/node/.openclaw
/opt/openclaw/workspace:/data/workspace

# 启动命令
docker run -d --name openclaw-test \
  -p 18789:18789 \
  -v /opt/openclaw/data:/home/node/.openclaw \
  -v /opt/openclaw/workspace:/data/workspace \
  ghcr.io/openclaw/openclaw:latest
```

### openclaw.json 关键配置

```json
{
  "gateway": {
    "bind": "lan",
    "auth": { "mode": "token", "token": "<your-token>" },
    "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"],
    "controlUi": {
      "allowedOrigins": ["http://localhost:18789", "http://127.0.0.1:18789"]
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "proxy": {
        "baseUrl": "http://67.230.182.59:8317/v1",
        "apiKey": "<llm-proxy-key>",
        "api": "openai-completions",
        "models": [{"id": "gpt-5.4", "name": "GPT 5.4", "contextWindow": 128000, "maxTokens": 16384}]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "proxy/gpt-5.4" },
      "sandbox": { "mode": "off" }
    }
  },
  "session": {
    "dmScope": "per-channel-peer",
    "reset": { "mode": "idle" }
  }
}
```

**必须配置**:
- `trustedProxies` — 白名单网关所在子网，否则 X-Forwarded-For 等头被忽略
- **设备配对**: 不再需要 `dangerouslyDisableDeviceAuth: true`。网关通过 `AutoPairer` (openclaw 包) 自动轮询审批配对请求

### 配置陷阱

| 项目 | 正确值 | 错误值 | 说明 |
|------|--------|--------|------|
| `gateway.bind.mode` | `"lan"` / `"loopback"` | `"0.0.0.0"` | 只接受模式名，不接受原始 IP |
| `trustedProxies` | `["10.0.0.0/8",...]` | 缺失 | 网关代理场景必须白名单 |
| `session.reset.mode` | `"daily"` / `"idle"` | `"manual"` | 只有两个合法值 |
| `agents.defaults.sandbox` | `"off"` | `"non-main"` | Docker 内必须关闭 (无 Docker-in-Docker) |
| `apiType` (Anthropic 模型) | `"anthropic-messages"` | `"anthropic"` | 类型名包含 `-messages` 后缀 |
| `apiType` (OpenAI/兼容) | `"openai-completions"` | — | GPT/Grok/GLM 等用此类型 |
| 容器用户 | `node` (uid 1000) | `root` | 卷必须 `chown 1000:1000` |
| Origin header | `http://<container_ip>:<port>` | 浏览器 origin | 网关 WS bridge 必须重写 Origin 为容器地址 |

### OpenClaw doctor

`openclaw doctor` 会自动 seed `gateway.controlUi.allowedOrigins` 并可能重写配置文件。首次启动后检查配置是否被修改。

## DB 操作

### 运行迁移

```sql
-- 添加 container_type 列 (幂等)
ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS container_type text NOT NULL DEFAULT 'vm-agent';
```

### 插入 OpenClaw 测试容器记录

```sql
INSERT INTO containers (user_id, container_name, container_ip, container_token, host_port, container_type, status)
VALUES (
  '<user_id>',
  'openclaw-test',
  '10.0.0.2'::inet,
  '<openclaw-gateway-token>',
  18789,
  'openclaw',
  'running'
)
ON CONFLICT (user_id, container_type) DO UPDATE SET
  container_name = EXCLUDED.container_name,
  container_ip = EXCLUDED.container_ip,
  container_token = EXCLUDED.container_token,
  host_port = EXCLUDED.host_port,
  status = EXCLUDED.status;
```

**注意**: unique 约束为 `(user_id, container_type)`，同一用户可同时拥有 vm-agent 和 openclaw 两个容器。`container_ip` 对 OpenClaw 容器必须填写实际可达地址 (如 WireGuard `10.0.0.2`)，因为 `UpstreamAddr` 优先使用 DB 中的 `container_ip`。

## 测试清单

1. 运行 SQL 迁移 (`010` ~ `014`)
2. 插入 OpenClaw 容器记录 (container_type='openclaw', container_ip 填 WireGuard IP)
3. 确认 openclaw.json 包含 `trustedProxies` (不再需要 `dangerouslyDisableDeviceAuth`)
4. 验证 Docker SSH 传输 (`ssh opc@10.0.1.3 docker system dial-stdio`)
5. 部署更新后的网关 (`make deploy-gateway` 或 rsync + 远程编译)
6. **构建并部署 webchat** (`cd webchat && npm run build` → rsync `website/static/chat/` 到 jingao)
7. webchat → `/ws/oc?ticket=` → 验证握手 + AutoPairer 自动配对 + 对话 + 流式输出
8. 管理后台 → Bot 管理 → 验证配置同步 + 重启功能
9. 管理后台 → 模型配置 → 验证 Provider/Model CRUD
10. `go test ./...` 通过

## 部署注意

- webchat 变更后**必须重新构建** (`npm run build`) 并 rsync `website/static/chat/` 到 jingao，否则浏览器加载旧 JS 导致握手失败
- `make deploy-gateway` 使用 `git reset --hard origin/main`，未 push 的本地改动需用 rsync 手动同步源码再远程编译
- OpenClaw 容器配置变更后自动 reload (检测 openclaw.json 变更)，无需重启容器

## 参考项目

[FastClaw](https://github.com/fastclaw-ai/fastclaw) — K8s 原生 OpenClaw 多租户管理平台 (Go)。其 WS 代理 (`handler/proxy/proxy.go`) 和握手客户端 (`service/k8s/gateway.go`) 是本集成的主要参考来源。关键借鉴:
- Origin header 重写为容器地址
- AutoPairer 替代 `dangerouslyDisableDeviceAuth` (安全设备配对)
- `trustedProxies` 子网白名单
- 代理层不设 ReadDeadline (与 vm-agent ChannelPool 不同)
