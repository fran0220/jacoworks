> ⚠️ **SUPERSEDED** — This plan has been replaced by the local-first sidecar restoration (v1.7.0).
> The desktop app now runs vm-agent as a local sidecar process with cross-platform bash support
> (Git for Windows prerequisite). Cloud Docker containers are no longer used for desktop.
> See desktop/AGENTS.md and vm-agent/AGENTS.md for current architecture.

# 统一执行架构：本地对话 + 云端 Bash

## 目标

取消用户可感知的"本地模式/云端模式"区分。本地 sidecar 始终运行，负责对话、文件操作、记忆；
bash 命令透明代理到用户的云端 Docker 容器执行，用户无感知。

## 架构总览

```
桌面端 Tauri
  └─ vm-agent sidecar (本地进程, stdin/stdout RPC)
       ├─ Pi SDK Agent Loop → LLM 中转站
       ├─ read / edit / glob → 本地 node:fs (不变)
       ├─ memory / web_search → 本地执行 (不变)
       └─ bash 命令 → RemoteBashTool (新)
              │
              ├─ 有网络 → Gateway WS /ws/exec → 用户容器内执行
              │           ← stdout/stderr/exitCode 回传
              └─ 离线 → 本地 fallback (带 30s 硬超时 + 环境预检)
```

## 四个工作模块

### 模块 1: vm-agent RemoteBashTool (TypeScript)

**文件**: `vm-agent/src/tools/remote-bash.ts` (新建)
**修改**: `vm-agent/src/agent.ts` (注册逻辑)

核心思路：

1. 新建 `RemoteBashTool`，实现与 Pi SDK `ToolDefinition` 接口
2. 复用现有 `remote-fs.ts` 的 WS 请求/响应模式 (req_id + pending map)
3. 协议消息:
   ```typescript
   interface ExecRequest {
     type: "exec.run";
     req_id: string;
     command: string;
     timeout_ms: number;  // 默认 30000
     cwd?: string;        // 容器内工作目录
   }
   interface ExecResponse {
     type: "exec.result";
     req_id: string;
     stdout: string;
     stderr: string;
     exit_code: number | null;
     killed: boolean;      // 超时被杀
     error?: string;       // 容器不可用等
   }
   ```
4. 发送通过 `TransportSender` (同 remote-fs)
5. 超时: 30s 默认, 最大 120s
6. **Fallback 逻辑**: 如果 sender 不可用 (无网络/未连接), 降级到本地 bash 执行 + 硬超时 + 环境预检

**agent.ts 修改**:
- `createCodingTools(workspace)` 返回的默认 bash 工具仍注册
- 新增条件: 如果有 `currentSender` (WS 已连接), 用 `RemoteBashTool` **替换** Pi SDK 内置 bash
- 如果 sender 断开, 自动回退到本地 bash

### 模块 2: Gateway /ws/exec 端点 (Go)

**文件**: `gateway/internal/exec/handler.go` (新建)
**修改**: `gateway/cmd/gateway/main.go` (路由注册)

核心思路：

1. 新 WebSocket 端点 `GET /ws/exec` (需认证)
2. 认证后查找用户的 vm-agent 容器 (container_type='vm-agent')
3. 收到 `exec.run` 消息 → 通过 Docker SDK 执行:
   ```go
   exec, _ := dockerClient.ContainerExecCreate(ctx, containerID, types.ExecConfig{
       Cmd:          []string{"sh", "-c", command},
       AttachStdout: true,
       AttachStderr: true,
       WorkingDir:   cwd,
   })
   ```
4. 流式回传 stdout/stderr, 执行完毕发送 `exec.result`
5. 超时控制: context.WithTimeout, 超时后 ExecKill
6. **容器状态处理**:
   - running → 直接执行
   - paused → 先 unpause, 再执行
   - 不存在 → 返回 error, 提示客户端 provision

**注意**: 复用现有 `gateway/internal/docker/client.go` 的 Docker SDK 封装。

### 模块 3: 桌面端集成 (React/Tauri)

**修改**: `desktop/src/react/hooks/use-agent-bootstrap.ts`
**修改**: `desktop/src/react/lib/cloud-agent-ws.ts`

核心思路：

1. sidecar 启动时, **同时** 尝试建立 `/ws/exec` 连接 (静默, 不阻塞)
2. 连接成功 → 通过 RPC 告知 vm-agent "exec channel ready"
3. vm-agent 收到后启用 RemoteBashTool, 替换本地 bash
4. 连接失败/断开 → vm-agent 自动回退到本地 bash (无用户感知)
5. **UI 变化**: 移除"云端模式"入口概念; 容器状态改为后台指示器:
   - 🟢 云端就绪 (bash 走云端)
   - 🟡 连接中...
   - ⚪ 本地模式 (bash 走本地)

### 模块 4: 容器标准化镜像 (Dockerfile)

**文件**: `deploy/docker/vm-agent-sandbox.Dockerfile` (新建或修改现有)

核心思路：

在现有 vm-agent 镜像基础上预装常用工具:
```dockerfile
# 基础工具
RUN apt-get update && apt-get install -y \
    git curl wget jq unzip zip \
    python3 python3-pip \
    nodejs npm \
    # PDF 生成
    wkhtmltopdf \
    # 文档处理
    pandoc \
    && rm -rf /var/lib/apt/lists/*

# Node 全局工具
RUN npm install -g typescript tsx prettier

# Python 常用包
RUN pip3 install --no-cache-dir requests beautifulsoup4 markdown
```

容器生命周期:
- 用户首次对话 → 自动 provision (现有逻辑)
- 空闲 10min → pause (现有 freezer)
- 需要执行 → unpause (模块 2 自动处理)

## 实施顺序

```
Phase 1 (可并行):
  ├─ 模块 1: RemoteBashTool (vm-agent TS)
  └─ 模块 2: /ws/exec 端点 (gateway Go)

Phase 2 (依赖 Phase 1):
  └─ 模块 3: 桌面端集成

Phase 3 (独立):
  └─ 模块 4: 镜像标准化
```

## 不变的部分

- webchat (OpenClaw) 流程完全不变, 它已经是全云端
- read / edit / glob 等文件工具继续走本地 node:fs
- memory 继续本地执行
- web_search 继续本地执行
- 认证、会话 CRUD 等网关功能不变

## 风险和 Fallback

| 风险 | 缓解 |
|------|------|
| 网络延迟影响 bash 响应速度 | 本地 fallback, 用户可在设置中选择"始终本地" |
| 容器冷启动慢 | unpause 通常 <1s; provision 走后台 |
| oracle 服务器资源有限 | pause/unpause 节省内存; 长期考虑按需扩容 |
| 老用户没有容器 | 首次 bash 时自动 provision, 期间用本地执行 |
