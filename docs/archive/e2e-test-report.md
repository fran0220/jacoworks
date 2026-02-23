# OpenClaw 端到端测试报告

> 日期: 2026-02-20  
> 测试环境: LXD 容器 `tpl-openclaw` @ 10.10.10.126  
> OpenClaw 版本: 2026.2.17  
> 快照: `gateway-v4-e2e-verified`

---

## 1. 环境概览

| 项目 | 值 |
|------|-----|
| 宿主机 | 192.168.31.162 (Ubuntu, SSH alias: `local`) |
| LXD 容器 | `tpl-openclaw` (10.10.10.126) |
| LXD 桥接 | `jaconet` (10.10.10.0/24) |
| Gateway 端口 | 18789 |
| Gateway Token | `test-123` |
| LLM 代理 | http://67.230.171.248:8317 (key: `sk-123456`) |
| 主模型 | `proxy-claude/claude-opus-4-6` |
| 回退链 | → `proxy-gpt/gpt-5.2` → `proxy-gemini/gemini-3-pro-preview` |
| 图片模型 | `proxy-gemini/gemini-3-pro-image-preview` |
| 沙箱模式 | `all` (Docker-in-LXD, nesting=true) |

---

## 2. 测试结果

### ✅ HTTP API — 非流式对话

```bash
curl -sS http://10.10.10.126:18789/v1/chat/completions \
  -H 'Authorization: Bearer test-123' \
  -H 'Content-Type: application/json' \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"你好"}]}'
```

**结果**: 成功，Agent 回复 "你好！我是一个高效直接的AI助手，随时准备帮你解决问题 🤖"

### ✅ HTTP API — SSE 流式对话

```bash
curl -N http://10.10.10.126:18789/v1/chat/completions \
  -H 'Authorization: Bearer test-123' \
  -H 'Content-Type: application/json' \
  -d '{"model":"openclaw","stream":true,"messages":[{"role":"user","content":"写一首五言绝句"}]}'
```

**结果**: 成功，逐 token 流式输出，以 `data: [DONE]` 结束。

### ✅ 多轮会话记忆

使用 `"user": "employee-001"` 绑定会话：
- Turn 1: "我叫张三，是产品经理" → Agent 记住
- Turn 2: "你还记得我叫什么？" → Agent 正确回答 "张三，产品经理"

### ✅ CLI Agent 嵌入式模式

```bash
openclaw agent --session-id acp-test --message "测试" --json
```

**结果**: Gateway 连接因 pairing 失败，自动回退到嵌入式模式并成功。  
耗时 3811ms，使用 proxy-claude/claude-opus-4-6。

### ⚠️ WebSocket 直连 (LAN)

**状态**: 需要设备配对 (pairing required)。LAN 连接不自动配对，需要 `device.publicKey` + 签名。

**影响**: Flutter 客户端应使用 HTTP API (`/v1/chat/completions`) 或实现完整的设备配对流程。

---

## 3. 关键配置变更

### 自定义 Provider (核心修复)

内置 provider 不支持 `baseUrl` 覆盖，改用自定义 provider：

```json5
{
  models: {
    mode: "replace",
    providers: {
      "proxy-claude": { api: "anthropic-messages", baseUrl: "${LLM_PROXY_URL}", ... },
      "proxy-gpt":    { api: "openai-completions", baseUrl: "${LLM_PROXY_URL}/v1", ... },
      "proxy-gemini": { api: "openai-completions", baseUrl: "${LLM_PROXY_URL}/v1", ... },
      "proxy-grok":   { api: "openai-completions", baseUrl: "${LLM_PROXY_URL}/v1", ... },
    }
  }
}
```

### 启用 HTTP API

```json5
{ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } }
```

### 移除沙箱 setupCommand

沙箱 Docker 容器 rootfs 只读，`apt-get` 不可用，已移除 `setupCommand`。

---

## 4. 快照历史

| 快照名 | 日期 | 说明 |
|--------|------|------|
| `gateway-v3` | 2026-02-19 | 最小 persona + 预注入 key + 无额外 skills |
| `gateway-v4-e2e-verified` | 2026-02-20 | ✅ 端到端验证通过，自定义 provider，HTTP API 启用 |

---

## 5. 后续待办

- [ ] 实现 Flutter 客户端对接 HTTP API (`/v1/chat/completions`)
- [ ] 配置 WebSocket 设备配对流程（或启用 `dangerouslyDisableDeviceAuth` 用于开发）
- [ ] 预构建沙箱镜像（内置 git/curl/jq）替代 setupCommand
- [ ] 测试实例克隆流程：`lxc copy tpl-openclaw employee-xxx`
- [ ] 压力测试多实例并发
