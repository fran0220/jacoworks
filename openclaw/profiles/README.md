# Agent Profiles

每个子目录是一个独立的 Agent 配置，使用 OpenClaw 原生文件约定。

```
{name}/
  profile.json       # 必须 — Gateway 元数据 (name, model, workspace)
  SOUL.md             # 人格、语气、价值观、边界
  IDENTITY.md         # Agent 名字、风格、emoji
  USER.md             # 用户信息 (姓名、时区、偏好)
  AGENTS.md           # 工作指引、记忆流程、协作规则
  TOOLS.md            # 工具使用说明
  HEARTBEAT.md        # 可选 — cron 心跳检查清单
  MEMORY.md           # 可选 — 长期记忆
  skills/             # 可选 — OpenClaw AgentSkill 包
    my-skill/SKILL.md
```

## profile.json (最小必须)

```json
{
  "name": "my-agent",
  "displayName": "我的 Agent",
  "description": "一句话描述",
  "icon": "bot",
  "model": "proxy/gpt-5.4",
  "workspace": "/data/workspace"
}
```

只有 `profile.json` 是 gateway 需要的元数据，其余全是 OpenClaw 原生文件。

## 文件部署位置

| 文件类型 | 部署到容器的位置 | 说明 |
|---------|----------------|------|
| `*.md` (SOUL/IDENTITY/USER/...) | `{workspace}/` | OpenClaw 每次对话自动注入上下文 |
| `skills/` | `{agentDir}/skills/` | OpenClaw AgentSkill 包 |
| `profile.json` | 不部署 | 仅 Gateway 读取 |

## 工作区隔离

- **共享**: `"workspace": "/data/workspace"` — 所有 agent 看到同一目录
- **独立**: `"workspace": "/data/workspace/my-agent"` — 文件和记忆完全隔离

对话 session 通过 `agent:{name}:main` 始终天然隔离。

## 生效方式

放入目录后，容器 provision 或 config sync 时自动部署。无需手动安装。
