# Agent Profiles

每个子目录是一个独立的 Agent 配置。最少只需两个文件：

```
{name}/
  profile.json    # 元数据
  prompt.md       # 系统提示词
  skills/         # 可选 — OpenClaw AgentSkill 包
```

## profile.json 格式

```json
{
  "name": "my-agent",
  "displayName": "我的 Agent",
  "description": "一句话描述",
  "icon": "bot",
  "model": "proxy/gpt-5.4",
  "prompt": "prompt.md",
  "skills": [],
  "workspace": "/data/workspace"
}
```

## 工作区隔离

- **共享**: `"workspace": "/data/workspace"` — 所有 agent 读写同一目录
- **独立**: `"workspace": "/data/workspace/my-agent"` — 各自隔离

## 会话隔离

每个 profile 自动获得独立的 sessionKey `agent:{name}:main`，对话上下文天然隔离。

## 生效方式

放入目录后，下次 `SyncConfig` 或容器重建时自动注入 `openclaw.json` 的 `agents.list[]`，无需手动安装。
