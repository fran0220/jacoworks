# Lessons Learned

## 2026-02-22: Phase 2 完成 + Go 网关 MVP

**完成内容**:
1. 向量记忆 (SQLite-vec + local gemma-300m embedding) 验证通过
2. 子 Agent (sessions_spawn) 需要 `openclaw devices approve` 配对提升 operator→admin scope，配对后正常工作
3. 创建快照 `v2-full-verified`
4. Go 管理网关 MVP 搭建完成并端到端验证通过:
   - Login → JWT → ReverseProxy → OpenClaw → Claude 响应 ✅
   - SSE 流式透传 (`FlushInterval: -1`) ✅
   - Admin API (容器列表) ✅

**教训**:
- LXD 容器 IP 在 macOS 上不可直接访问 (10.10.10.0/24 是宿主机 bridge)，开发时需 SSH 隧道。生产环境 Go 网关跑在宿主机上则无此问题
- OpenClaw `sessions_spawn` 需要 admin scope，每次 Gateway 重启都会产生新的 pairing request，需要自动批准机制（容器模板中预配置）
- `lxc list --format=csv` 输出的 IPv4 字段可能包含多个 IP (Docker bridge + LXD eth0)，解析需考虑

**规则**: 开发阶段用 SSH 隧道测试没问题，但不要把隧道端口写死在配置里。生产部署 Go 网关在宿主机运行。

---

## 2026-02-22: 最终决策 — 切回 OpenClaw

**背景**: 经过 6 方案 (OpenClaw → nanobot → ZeroClaw → PicoClaw → 评估 IronClaw → 切回 OpenClaw) 完整迭代，最终选定 OpenClaw。

**关键转折**: 用户明确表示宿主机会随企业规模扩容，内存不再是硬约束。此前放弃 OpenClaw 的唯一原因消失。

**选回 OpenClaw 的决定性因素**:
1. **功能碾压全场** — 25+ 工具, 40+ HTTP API 端点, OpenAI 兼容 `/v1/chat/completions`, 向量记忆, 浏览器自动化, 3000+ 技能生态
2. **管理网关开发量减少 60%** — OpenClaw 已内置 OpenAI 兼容 API + 飞书/钉钉/企微插件，网关只需认证+路由+LXD管理
3. **已有验证基础** — `tpl-openclaw` 容器快照 `gateway-v4-e2e-verified` 已通过 HTTP API + SSE + 多轮记忆端到端验证
4. **中国 LLM 原生支持** — 千帆/Moonshot/豆包/MiniMax/千问内置，不需要 hack

**教训**:
- **约束分析要区分"当前约束"和"长期约束"**。内存是当前开发机的约束，不是企业生产环境的约束。过早优化导致 5 次方案切换
- **"功能最强"在约束解除后就是"最适合"**。之前 "功能最强 ≠ 最适合" 的判断是正确的（受限于内存），但约束变化后结论也要跟着变
- **已有验证资产要充分利用**。`tpl-openclaw` 快照已验证核心链路，重新部署仅需 ~1.5 小时，比从零验证新方案快得多

**规则**: 选型优先级最终版: 功能完整度 → 中文稳定性 → IM 通道 → HTTP API → 安全模型 → 生态成熟度。内存占用降级为次要考量（生产环境资源可扩容）。

---

## 2026-02-22: IronClaw 评估 — 功能强大但不适合中国企业场景

**背景**: 评估 nearai/ironclaw (Rust, 2.6k ⭐, OpenClaw 的 Rust 重写) 作为 JAcoworks Agent 引擎候选。

**关键发现**:
1. **IronClaw 是所有候选中 HTTP API 最强的** — 内置 OpenAI 兼容 `/v1/chat/completions` 端点 + 40+ API，但中国企业 IM 通道（飞书 P3、钉钉/企微完全未规划）是致命缺陷
2. **IronClaw 曾有与 ZeroClaw 相同的 UTF-8 panic bug** — 在 PR #57 中修复了 `truncate()` 多字节字符边界问题。说明 Rust 项目处理 CJK 文本需要额外注意
3. **内嵌 wasmtime (WASM JIT) 是双刃剑** — WASM 通道/工具沙箱安全性好，但内存开销大，与 Per-User VM 轻量目标冲突
4. **IronClaw 需要 PostgreSQL 或 libSQL** — 数据库依赖增加每容器部署复杂度和资源占用

**教训**:
- "功能最强" ≠ "最适合"。IronClaw 安全模型和 API 远超其他候选，但关键 IM 通道缺失使其完全不可用
- OpenClaw 生态的 Rust 重写（ZeroClaw、IronClaw）都出现过 UTF-8 边界 panic，Go 项目 (PicoClaw) 天然免疫此类问题
- 数据库依赖对 Per-User VM 架构是沉重负担（PostgreSQL ~300MB 磁盘 + ~50MB 内存）

**规则**: 中国企业 IM 通道（飞书/钉钉/企微）仍是第一优先级筛选条件。没有这三个通道的方案不考虑。

---

## 2026-02-22: 技术选型第四次迭代 — ZeroClaw → PicoClaw

**背景**: ZeroClaw 在处理中文文本时因 UTF-8 多字节边界 panic 而被废弃。经过对 5 个候选方案 (PicoClaw、pi_agent_rust、pi-mono、oh-my-pi、ZeroClaw) 的源码级深度调研，最终选定 PicoClaw。

**关键发现**:
1. **所有候选方案都没有内置 HTTP API** — 不只是某一个。PicoClaw 的 `gateway` 模式是 IM 通道聚合器，不是 HTTP server；pi-mono/pi_agent_rust 的 RPC 模式是 stdin/stdout JSON 协议
2. **PicoClaw 添加 HTTP API 最简单** — Go Channel 接口设计干净，~150 行代码即可实现 HTTP 通道（参考 maixcam.go）
3. **飞书通道是真正的差异化优势** — PicoClaw 内置 13 个 IM 通道（飞书/钉钉/企微/QQ 等），使管理网关开发量减少 40-50%
4. **Grok Search 和 Librarian 的搜索结果需要交叉验证** — AI 搜索工具会产生 hallucination（搜到假的 PicoClaw 机器人硬件项目），必须用 Librarian 访问实际 GitHub 仓库确认

**教训**:
- 选型时不要只看官方声称的功能，要查看源码确认实际实现
- "gateway" 这个词在不同项目中含义完全不同（HTTP server vs IM aggregator vs health probe）
- Go 项目对中文团队的可维护性远高于 Rust 项目
- 备选方案要保留（pi_agent_rust 作为长期深度定制备选）

**规则**: 选型优先级更新为：中文稳定性 → 内置通道 → 内存占用 → 技术栈统一性 → 扩展性

---

## 2026-02-21: 技术选型演进 — OpenClaw → nanobot → ZeroClaw

**背景**: 三次选型迭代，最终确定 ZeroClaw 作为 Agent 引擎。

**教训**:
1. 内存占用是 Per-User VM 架构的核心约束。OpenClaw 380MB/用户，30 人就吃掉 11GB；ZeroClaw <15MB/用户，同样资源可服务 10x 用户
2. 运行时依赖越少越好。Python/Node.js 在容器内需要完整运行时环境；Rust 单二进制零依赖，部署和模板克隆都更简单
3. 自建 HTTP wrapper 是技术债。nanobot 需要自建 http_api.py 才能对外服务；ZeroClaw 内置 Axum Gateway，省去这层
4. 先做端到端验证再做架构决策。每次切换都是因为先验证了核心链路才发现问题

**规则**: 选型时优先考虑：内存占用 → 运行时依赖 → 内置能力 → 社区生态

---

## [历史] 2026-02-21: nanobot Claude proxy_ 前缀问题

> 已归档 — nanobot 方案已弃用，保留记录供参考

**问题**: Claude 模型在 function calling 时会给工具名加 `proxy_` 前缀（如 `proxy_read_file`），导致 nanobot 找不到工具。

**解决**: 在 `CustomProvider._parse()` 中添加逻辑自动剥离 `proxy_` 前缀。

**规则**: 使用 LLM 中转平台时，注意模型可能修改工具名。ZeroClaw 使用原生 Anthropic/OpenAI function calling 协议，需验证是否存在同样问题。

---

## [历史] 2026-02-21: nanobot 没有内置 HTTP API

> 已归档 — nanobot 方案已弃用，保留记录供参考

**问题**: nanobot 的 `gateway` 是 WebSocket 配对模式（类似 Claude Code），不是 HTTP API server。

**解决**: 基于 `AgentLoop.process_direct()` 自建 HTTP API wrapper（Starlette + uvicorn + sse-starlette）。

**规则**: 选型时确认框架是否内置 HTTP API 端点。ZeroClaw 内置 Axum Gateway (POST /webhook on port 18800)，无需额外开发。

---

## [历史] 2026-02-20: OpenClaw LLM Provider 配置

> 已归档 — OpenClaw 方案已弃用，保留记录供参考

**问题**: OpenClaw 的 `custom` provider 配置格式与文档不一致，需要特定的 JSON 结构。

**规则**: 框架文档不可全信，以实际代码为准。
