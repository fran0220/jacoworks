# 更新日志

## v0.1.7 (2026-02-27)

### 新功能

- 🔥 在线技能热更新系统：管理员可在后台直接管理技能，无需重新发版
- 📥 客户端启动时自动拉取最新技能包，保持技能始终最新
- 🔄 双向技能同步：本地 → 服务器 → OpenClaw 容器
- 📝 管理后台新增技能管理页面（列表/编辑/新建/删除）
- 🎨 新增 AI 图片生成能力（fal-ai，支持 Pro 模式自动降级）

### 修复与改进

- 🧠 向量记忆 Embedding 支持配置独立代理地址，解决国内直连延迟
- 🛠 管理后台设置页新增 Embedding / fal_api_key 配置字段
- 🪟 下载页新增 Windows Smart App Control 安装说明
- ⚡ 技能加载优先级：远程 > 内置 > 用户自建
- 🔧 Updater API 平台匹配逻辑优化
- 🪟 新增 Windows x64 安装包（NSIS 安装器 + 自动更新签名）

## v0.1.6 (2026-02-27)

### 修复

- 📡 SSE 流式传输切换为 Tauri invoke，解决跨平台兼容性
- 🪟 Windows 构建：隐藏 sidecar 控制台窗口、DevTools 配置警告修复
- 移除未使用的 deep-link 插件

## v0.1.5 (2026-02-26)

### 修复

- 替换 EventSource 为 Tauri invoke SSE，修复 Windows 流式响应问题

## v0.1.4 (2026-02-26)

### 修复

- Windows DevTools 支持、隐藏 sidecar 命令窗口、CORS 修复

## v0.1.3 (2026-02-26)

### 修复

- 🤫 生产模式隐藏 RPC 调试日志面板
- 🔄 OpenClaw 连接状态去重显示

## v0.1.2 (2026-02-26)

### 改进

- 🖼 全新应用图标设计
- 🔐 macOS Bun sidecar JIT 权限修复（Entitlements.plist）

## v0.1.1 (2026-02-25)

### 改进

- macOS 代码签名与公证支持
- 下载页新增 macOS xattr 安装说明
- 移除 Linux 构建目标

## v0.1.0 (2026-02-25)

### 新功能

- 🎉 首次发布
- 本地 AI Agent 对话
- 多模型支持 (Claude / GPT / Gemini / Grok)
- 工作空间文件访问 — Agent 直接读写本地项目文件
- 智能记忆系统 — 跨会话记住你的偏好与上下文
- OpenClaw 云端协作模式
- 飞书 SSO 登录
- 激活码注册机制
- 会话云端同步
- 流式响应实时显示
- 自动会话标题生成
- Web 搜索与网页抓取工具
- 暖色奶油风格 UI
