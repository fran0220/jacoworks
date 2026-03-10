# Lessons Learned

## 2026-03-10: Session 状态漂移 — 双源真相导致切换错乱

**触发**: 用户反馈在一个线程保持运行时切换到另外一个线程，会出现消息漂移错乱。

**根因**: 双源真相（dual source of truth）
- 本地内存维护 `localSession.messages` 状态
- 网关 PostgreSQL 异步 persist
- 切换 session 时，如果前一个 session 的消息还没 persist 完成，从 DB 加载的是旧数据
- `use-session-state.ts` 有跳过逻辑：`if (currentSession?.id === currentSessionId) return;`，导致切回已加载的 session 时不刷新

**修复**:
1. **移除跳过逻辑**: `use-session-state.ts` 每次切换 session 都强制从 DB 重新加载
2. **persist 后立即刷新**: `persistSession()` 在写入 DB 后调用 `onSessionUpdate()` 触发父组件刷新
3. **定期刷新机制**: 当前 session 每 5 秒从 DB 刷新一次（非匿名会话）
4. **重试逻辑**: `persistMessages()` 添加指数退避重试（3 次，1s/2s/4s）

**架构原则**: Database as Single Source of Truth (SSOT)
- PostgreSQL 是唯一真相源，本地状态只做渲染缓存
- 所有持久化操作立即写入 DB 并刷新
- 切换 session 时始终从 DB 加载最新状态
- 定期刷新确保多设备/后台更新可见

**规则**: 
- 涉及多 session 切换的状态管理，必须明确单一真相源（DB 或内存）
- 如果选择 DB 为真相源，所有读写都必须经过 DB，不能依赖本地缓存
- 切换上下文时，必须强制刷新，不能假设本地状态是最新的

---

## 2026-03-05: Docker 容器链路可靠性审计 — 10 处问题

**触发**: 全链路审计，发现 3 Critical + 4 High + 3 Medium 问题。

**Critical**:
1. `channel.go publish()` 先释放 RLock 再 send → send on closed channel panic（已修：在 RLock 内 non-blocking send）
2. `store/containers.go GetUserByContainerToken` 检查过时状态值（已修：对齐 Docker 状态）
3. WS 代理只用 container IP 连上游，Docker bridge IP 从网关不可达（已修：优先用 hostIP:hostPort）

**High**:
4. `agent.Proxy.ensureRunning` unpause 后无 WaitForHealth，WS dial 可能连未就绪的容器（已修）
5. `BackendAdapter.WaitForHealth` IP 为空时直接 curl 空地址失败（已修：空 IP 时 GetIP 兜底）
6. `WaitForHealth` 接受任何 HTTP 1xx-5xx 为 healthy，含 404/500（已修：只接受 200，添加 --max-time）
7. WS heartbeat ping 写失败只 return 不 close → 泄漏 goroutine + 半开连接（已修：defer closeAll）

**Medium**:
8. `proxy.go` forward 无 pong deadline（待后续优化）
9. `proxy.go` 用 DefaultDialer 无 HandshakeTimeout（已修：10s）
10. feishubot `waitForReady` 不检查 replay 中的 ready 事件 → 可能 30s 超时（已修：先扫 replay）

**规则**:
- WS 代理三要素：健康检查地址 = 实际 dial 地址、ping 失败必须 closeAll、用带 timeout 的 dialer
- fanout pattern 中 send on closed channel 是经典 panic 源，send 必须在 lock 保护下或不 close channel

## 2026-03-02: 4-5 轮对话后响应超时 — Pi SDK 事件流架构缺陷

**触发**: 用户反馈 4-5 轮对话后出现"响应超时，AI 长时间未返回内容"，部分情况下生成图片无法预览。

**根因**: `handlePrompt` 在收到第一个 `agent_end` 事件时就调用 `finish()` (发送 "done" + 取消订阅)。但 Pi SDK 的 `session.prompt()` 在 `agent_end` 之后还有内部工作：
1. **自动重试**: LLM 返回 429/502/overloaded 错误时，SDK 内部 `_handleRetryableError` 启动重试 (`agent.continue()`)，新的 agent run 事件因 listener 已取消订阅而丢失
2. **自动压缩**: 上下文超过 `contextWindow - reserveTokens` (200K - 16K = 184K) 时，SDK 发起额外 LLM 调用做摘要压缩
3. **前置压缩**: `session.prompt()` 在发送用户消息之前先检查是否需要压缩（line 559-563），压缩期间无流式事件

**修复**:
1. **vm-agent**: 移除 `agent_end` 作为 finish 触发，改用 `session.prompt().then()` 作为唯一 finish 信号，确保订阅覆盖整个重试/压缩周期
2. **vm-agent**: 添加 15s keepalive 心跳，防止长静默期（压缩/慢 LLM）触发前端超时
3. **vm-agent**: 添加 per-session in-flight 锁，防止重叠 prompt 导致状态混乱
4. **desktop**: 超时阈值 120s → 180s；超时时保存部分响应内容
5. **desktop**: Markdown 添加 `renderer.image` + `convertFileSrc` 解析本地图片路径

**规则**:
- Pi SDK 的 `agent_end` 只表示"一次 agent run 结束"，不代表整个 prompt 生命周期完成
- 订阅 Pi SDK 事件时，必须保持到 `session.prompt()` Promise settle 才取消
- 长时间静默操作（压缩、重试）需要 keepalive 机制保持前端连接活跃

---

## 2026-03-01: 系统技能从未上传到网关 — 架构完整但缺少入口

**触发**: 用户发现 agent 不加载技能（fontkit 不可用、处理过程不显示），排查发现网关 `skill_files` 表 `owner='system'` 为空。

**根因**: 2/28 重构了技能为"网关 source of truth"架构，但只实现了 pull 和 push user skills，没有创建 **上传系统技能到网关** 的入口。`vm-agent/skills/` 里 146 个文件从未进入 DB。

**修复**:
1. 创建 `deploy/push-skills.sh` 脚本：读取 `vm-agent/skills/` → POST 到 `/api/skills/upload`（source=builtin）
2. 支持三种认证方式：ADMIN_TOKEN env → gateway.yaml → 自动 login
3. `make push-skills` 独立目标 + 纳入 `make deploy` 流程

**规则**: 新建"source of truth 在远端"的架构时，必须同时创建数据初始化/同步入口并验证全链路（seed → store → pull → load）。

---

## 2026-03-01: 流式光标跳动 + process-strip 与持久化视图不一致

**触发**: 用户反馈光标(▋)一会在上面一会在下面，处理过程不显示。

**根因**: 流式渲染时，每个 text block 单独包在 `bubble-row` 里，tool/thinking 的 process-strip 作为兄弟元素散在 `.messages` 容器中。光标放在最后一个 text block 里，text→tool→text 交替导致跳动。而持久化消息中 process-strip 在 `.assistant-bubble` 内部，两种视图结构不一致。

**修复**: 将所有流式块包在单个 `bubble-row > assistant-bubble` 内，光标始终在末尾。流式和持久化视图现在共用相同的 DOM 结构。

---

## 2026-02-28: 技能架构重构 — 网关为唯一 source of truth

**触发**: 更新了 `nano-banana-pro` 技能但只打包本地没更新网关，暴露了双源同步的根本缺陷。

**重构**: 去掉本地打包 `skills.tar.gz`，系统技能完全由网关 DB (`skill_files` 表) 管理。
- 启动顺序：push 用户技能 → pull 系统技能(网关) → 启动 Agent
- 运行中：每 30 分钟轮询网关 checksum，有变化自动 pull
- 新会话惰性加载最新技能（无需重启 Agent）
- 管理员可随时 hotfix，所有桌面端自动生效
- **初始化**: `make push-skills` 或 `deploy/push-skills.sh` 上传系统技能到网关 DB

**规则**: 系统技能只在网关管理，桌面端只做 pull + 缓存。用户自建技能仍为本地管理 + push 同步。

---

## 2026-02-27: 用户纠偏 — 先定位核心根因，禁止先堆叠防御逻辑

**触发**: 用户反馈 文本重复渲染时，我先在前端多层增加连接锁与状态判断，而不是先把问题收敛到唯一根因，造成“补丁叠补丁”的观感。

**教训**:
1. 对“简单异常现象”（如重复渲染）要先做路径级归因：数据是否重复进入、进入几次、在哪一层重复。
2. 在根因未证实前新增多层防护，容易引入非必要复杂度，并掩盖真正故障点。
3. 正确顺序应是：确认唯一根因 → 选单点最小修复 → 再评估是否需要额外兜底。

**规则**: 处理 bug 时默认执行“根因优先、最小改动”策略；未经证据支持，不得跨层堆叠功能性判断或防御代码。

## 2026-03-06: 新增 system_settings 配置项必须走完四层链路

**触发**: 给网关加 PostHog 集成，只改了 Go 网关代码（config + allowedKeys + 热重载），部署后管理后台看不到配置项。

**根因**: `system_settings` 配置项跨四个层，缺任何一层都不完整：
1. **DB 行**: `system_settings` 表需要 INSERT 对应的 key + description（管理后台靠这个渲染表单）
2. **网关 Go**: `config.go` 结构体 + 启动加载 + `updateSettingsHandler` allowedKeys + 热重载逻辑
3. **网站 Rust**: `settings.rs` 的 `UpdateSettingsForm` 字段 + `is_secret_key()` + update handler 提交处理
4. **SQL 迁移**: `deploy/sql/` 新增迁移文件 + 更新全量 seed SQL

**修复**: 补了 DB INSERT + 网站 Rust 表单处理 + SQL 迁移文件，重新部署网站。

**规则**: 新增 `system_settings` 配置项时，必须同时修改四个位置（DB 行 / 网关 Go / 网站 Rust / SQL 迁移），缺一不可。用 checklist 确认：
- [ ] `deploy/sql/0XX_*.sql` 迁移 + 更新 `003_system_settings.sql` 全量 seed
- [ ] `gateway/cmd/gateway/main.go` 启动加载 + allowedKeys + 热重载
- [ ] `gateway/internal/config/config.go` 结构体字段
- [ ] `website/src/routes/admin/settings.rs` 表单字段 + secret 判断 + 提交处理
- [ ] 线上 DB 执行迁移 SQL

---

## 2026-02-25: 用户纠偏 — 要求"完整切换"时禁止擅自加降级路径

**触发**: 用户明确要求切换到 Exa，我自行保留了 Tavily fallback，导致实现偏离需求并引入冗余代码。

**教训**:
1. 当用户说“完整切换/只保留 X”时，目标是收敛而不是“稳妥兜底”。
2. 未被请求的 fallback 会增加复杂度与维护成本，且违背用户决策。

**规则**: 用户明确要求单一路径切换时，只实现目标路径；任何兼容/降级逻辑都必须先征得用户同意。

---

## 2026-03-09: 云端容器解耦设计 — 核心设计理念确认

**触发**: 评估 vm-agent 本地/云端解耦方案时，错误建议"多用户共享容器"和"多渠道接入"。

**核心设计理念**:
1. **每用户一容器**: 用户隔离在容器级别，这是 JAcoworks 的核心安全和隔离模型，不可妥协
2. **云端入口 = webchat**: cloud-agent 的唯一入口是 webchat SPA，不需要多渠道适配
3. **功能优先**: 拆包的目的是让云端能独立发展实际功能，不是过度架构设计

**规则**:
- 涉及容器架构时，始终以"每用户一容器"为前提，不要建议共享容器或多租户方案
- 不要在没有需求的情况下建议多渠道/多入口扩展
- 解耦方案应聚焦实际功能差异，不是架构美感
- **不动现有代码**: 新建独立包，按需复用，不要重构现有工作的模块
- **新增不替换**: cloud-agent 是新增的镜像/方案，网关同时支持 vm-agent 和 cloud-agent，不替换现有容器

---

## 2026-03-09: OpenClaw 透明代理的身份与 CORS 陷阱

**触发**: E2E 测试 OpenClaw 桥接时，webchat client 用 `webchat` + `webchat` 身份连接被 OpenClaw 拒绝：`origin not allowed`。

**根因**: OpenClaw 对 `webchat` client.id 强制检查 `gateway.controlUi.allowedOrigins`。网关 bridge 是服务端到服务端的 WS 连接，不带 Origin header，因此被拒。而 `gateway-client` + `backend` 身份绕过此检查。

**关键发现**:
1. **OpenClaw client.id 是枚举**: 必须是预定义值之一 (`webchat`, `gateway-client`, `cli`, `test` 等)，不接受任意字符串
2. **client.mode 也是枚举**: `webchat`, `backend`, `cli`, `ui`, `node`, `probe`, `test`
3. **网关 bridge 必须用 `gateway-client` / `backend`**: 服务端代理身份，绕过 CORS 检查
4. **connect 协议版本**: `minProtocol: 3, maxProtocol: 3`（不是 1）
5. **auth 结构**: 只有 `{token: "..."}`, 不接受 `mode`/`nonce` 等额外字段
6. **webchat 前端直连 vs 网关代理**: 前端直连需 allowedOrigins 匹配；走网关代理则由网关以 gateway-client 身份中转

**规则**:
- OpenClaw 透明代理场景，网关始终以 `gateway-client` + `backend` 身份连接上游
- webchat 前端发帧给网关 → 网关原样转发给 OpenClaw，身份验证在网关层完成（ticket auth）
- 新增 OpenClaw 容器时，`allowedOrigins` 只需包含容器自身地址（localhost），网关连接不受此限制
- 更新 openclaw-integration skill 的协议文档保持同步

---

## 2026-03-09: OpenClaw WS 代理重连循环 — 旧 JS + 缺少容器安全配置

**触发**: webchat 浏览器端显示 "已连接" 但每 11 秒断开重连。Gateway 日志 "downstream read error: use of closed network connection"。

**根因** (双重):
1. **旧 webchat JS**: 部署了新的 `openclaw-client.ts` (含 connect.challenge 握手逻辑) 但没有 `npm run build` 并 rsync `chat.js` 到 jingao。浏览器加载旧 JS，不含 OpenClaw 握手代码，收到 `connect.challenge` 后不发送 `connect` 回复
2. **缺少 `dangerouslyDisableDeviceAuth: true`**: OpenClaw 对通过代理连接的客户端要求设备配对，代理场景下无法完成配对流程

**时间线分析**: 11 秒 = 1 秒健康检查 + 10 秒 OpenClaw 握手超时。OpenClaw 发送 `connect.challenge` → 等待 10 秒 → 无 `connect` 回复 → 发送 WS close (code=1000) → bridge 关闭 → webchat 重连

**诊断过程**: 添加帧级 debug 日志 + close handler 到 `openclaw_bridge.go`。发现 `up→down` 有 `connect.challenge` 帧但 `down→up` 零帧，证明浏览器端完全没有发送数据

**第二个 bug**: 修复握手后发现文本重复渲染 — OpenClaw 同时发送 `agent` stream (逐 token delta) 和 `chat` delta (累计快照)，两路都被渲染。修复：`event-parser.ts` 忽略 `chat` delta

**修复** (4 处):
1. `webchat/src/lib/event-parser.ts`: `chat` state=delta → `ignore` (消除重复文本)
2. `gateway/internal/docker/openclaw.go`: GenerateConfig 添加 `dangerouslyDisableDeviceAuth: true` + `trustedProxies`
3. `gateway/internal/docker/openclaw.go`: UpstreamAddr 优先用 DB `container_ip` (支持多主机 OpenClaw)
4. 重新构建并部署 webchat JS: `npm run build` + rsync

**参考**: [FastClaw](https://github.com/fastclaw-ai/fastclaw) — K8s 原生 OpenClaw 管理平台，其 WS 代理和容器配置是主要参考

**规则**:
- webchat 代码变更后**必须** `npm run build` + 部署 `chat.js`，否则浏览器加载旧代码
- OpenClaw 容器代理场景**必须** `dangerouslyDisableDeviceAuth: true` + `trustedProxies`
- OpenClaw 同时发送 `agent` stream 和 `chat` delta 两路文本，前端只能使用一路
- 调试 WS 代理问题时，首先添加帧级日志确认数据流方向，再定位具体组件

**触发**: 分析 webchat 用户流程时，发现 webchat 的 `WSClient` 只包装 `OpenClawClient`，但没有明确的架构边界声明，导致 `config.ts` OPENCLAW_TOKEN 会 fallback 到 AUTH_TOKEN（安全隐患），`selfProvisionHandler` 硬编码 vm-agent（用户无法自助获得 OpenClaw 容器）。

**明确架构边界**:
- **webchat = OpenClaw 专属前端**: 只说 OpenClaw WS 协议，不接入 vm-agent
- **桌面端 = vm-agent 专属**: 通过 sidecar RPC 或 /ws/agent 接入 vm-agent 容器
- **网关 /ws/oc = 双后端分派**: 按 `container_type` 分派，但 webchat 用户自动分配 OpenClaw 容器

**修复**:
1. `config.ts`: OPENCLAW_TOKEN 不再 fallback 到 AUTH_TOKEN，空就是空
2. `container.ts`: provision 请求发送 `container_type: "openclaw"`
3. `selfProvisionHandler`: 接受 `container_type` 参数，openclaw 走 `ocClient.Provision`
4. `containerStatusHandler`: 返回 `container_type` + openclaw 容器返回 `container_token`
5. `EnsureRunning`: openclaw 容器 not_found 时自动 reprovision
6. `ContainerPanel`: provision 成功后 reload 页面注入新 OPENCLAW_TOKEN
7. AGENTS.md 和 webchat/AGENTS.md 明确 "OpenClaw 专属" 定位

**规则**: webchat 和桌面端是两个独立产品入口，共享 UI 组件但连接协议完全不同。不要在 webchat 中加 vm-agent 兼容路径。

## 2026-03-09: Windows 下文档生成乱码 (mojibake)

**触发**: 标哥反馈 Windows 下 Agent 创建/编辑 Excel 文件全是乱码，`ä¸°å®` 形式的 UTF-8→Latin-1 mojibake。

**根因分析**:
1. 乱码模式是 UTF-8 字节被当作 Latin-1 解读（`丰` → `ä¸°`），不是 GBK 问题
2. ExcelJS 本身写 xlsx 用 UTF-8 XML，没问题
3. **主因**: LLM 有时通过 bash heredoc/echo/cat 创建 `.mjs` 脚本文件（而非 `write` 工具），MSYS2 bash 在 Windows 下可能破坏非 ASCII 字符编码
4. **次因**: 捆绑的 Bun v1.2.5 有已知的 ZigString UTF-8/Latin-1 混淆 bug（oven-sh/bun#26647），影响文件路径和部分 API

**修复**:
1. SKILL.md 新增强制规则：必须用 `write` 工具创建含非 ASCII 的脚本文件，禁止 bash heredoc/echo/cat
2. system prompt 新增 Windows 编码规则：`CRITICAL ENCODING RULE` 提示 LLM 不要通过 shell 传递 CJK 文本
3. bash 工具在 Windows 上自动设置 `LANG=C.UTF-8` 和 `LC_ALL=C.UTF-8` commandPrefix
4. 升级捆绑 Bun 版本 1.2.5 → 1.3.10（包含大量 Windows 修复）

**规则**: 在 Windows 上，非 ASCII 文本（中日韩等）绝对不能通过 bash shell 管道传递。所有包含非 ASCII 的文件必须通过 `write` 工具（UTF-8 `writeFile`）创建，然后用纯 ASCII bash 命令执行。
