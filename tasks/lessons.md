# Lessons Learned

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
