---
name: team-builder
description: 创建和管理多 Agent 协作团队 — 在容器内自助创建团队，无需管理员操作
---

# 团队创建与管理工具

你可以帮用户在当前 OpenClaw 容器内创建多 Agent 协作团队。创建后的团队 agents 由 OpenClaw cron 定时唤醒，自动协作。

## 核心能力

1. **创建团队** — 根据用户需求设计角色、生成 prompts/skills、写入配置
2. **安装预置模板** — 安装 JaMOSS 等预定义团队模板
3. **管理团队** — 查看、修改、删除已创建的团队
4. **JaMOSS 中间件** — 已内置于容器 (Go 二进制, systemd 服务, port 6565)

## 创建团队的完整流程

### Step 1: 设计团队结构

与用户确认：
- 团队名称 (英文小写，如 `research-team`)
- 角色列表 (每个角色: id, 名称, 职责描述)
- 谁是 leader (用户对话入口，必须恰好一个)
- 每个角色的模型选择
- cron 唤醒间隔 (默认 15 分钟)
- 是否需要 JaMOSS 任务调度中间件

### Step 2: 创建 Agent 目录和文件

每个 agent 需要创建以下文件：

```
/home/node/.openclaw/agents/{agent-id}/
  prompt.md           # 系统提示词（角色定义、职责、行为规范）
  skills/
    {skill-name}/
      SKILL.md        # AgentSkill（工具使用说明）
```

**prompt.md 模板**:
```markdown
# 角色：{角色名称}

## 身份
你是{角色名称}，专注于{核心职责}。

## 核心职责
1. {职责1}
2. {职责2}
...

## 工作原则
- 每次唤醒时先检查当前状态
- 自主执行，不要询问确认
- 所有产出放在共享工作目录下
- 重要操作后写日志记录

## 每次唤醒时的检查流程
通过 OpenClaw cron 定时唤醒（isolated 模式），每次按以下顺序执行：
1. 检查当前任务状态
2. 执行待办工作
3. 记录工作日志
```

**SKILL.md 模板**:
```markdown
---
name: {skill-name}
description: {技能描述}
---

# {技能名称}

## 使用方式
{具体工具和命令说明}
```

### Step 3: 创建共享工作区

```bash
mkdir -p /data/teams/{team-name}
```

写入 `AGENTS.md` 到工作区，描述团队成员和协作方式。

### Step 4: 修改 openclaw.json 注册 agents

使用 `gateway` 工具的 `config.patch` 注册新 agents：

```bash
# 1. 获取当前配置和 hash
gateway config.get

# 2. 构造 patch — 添加 agents.list
gateway config.patch '{
  "raw": "{
    \"agents\": {
      \"list\": [
        {
          \"id\": \"{agent-id}\",
          \"workspace\": \"/data/teams/{team-name}\",
          \"agentDir\": \"/home/node/.openclaw/agents/{agent-id}\",
          \"model\": { \"primary\": \"proxy/{model-name}\" },
          \"skills\": [\"{skill-name}\"],
          \"cron\": {
            \"schedule\": { \"kind\": \"every\", \"everyMs\": 900000 },
            \"sessionTarget\": \"isolated\",
            \"message\": \"{cron唤醒提示}\"
          }
        }
      ]
    }
  }",
  "baseHash": "{hash-from-config-get}",
  "note": "添加团队 {team-name}"
}'
```

**⚠️ 重要**：
- `agents.list` 的变更会被 OpenClaw **自动热重载**，无需重启
- 必须传入 `baseHash` 防止并发覆盖
- 如果已有 agents.list，需要先读取现有列表再 append 新 agents

### Step 5: 验证

```bash
# 检查 agents 目录
ls -la /home/node/.openclaw/agents/

# 检查 openclaw.json 中的 agents.list
cat /home/node/.openclaw/openclaw.json | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
for a in cfg.get('agents', {}).get('list', []):
    print(f\"  {a['id']} → workspace: {a.get('workspace', 'default')}\")
"
```

## 可用模型

所有模型通过 `proxy/` 前缀访问 LLM 中转站：

| 模型 | 适用场景 |
|------|---------|
| `proxy/gpt-5.4` | **推荐** — 通用任务、编码、规划、审查 |
| `proxy/claude-sonnet-4-6` | 日常对话、规划 |
| `proxy/claude-opus-4-6` | 复杂推理、架构设计 |
| `proxy/grok-4.1-fast` | 高速巡查、简单任务 |
| `proxy/gemini-3.1-pro-preview` | 深度推理、长文分析 |

## Cron 配置

```json
{
  "schedule": { "kind": "every", "everyMs": 900000 },
  "sessionTarget": "isolated",
  "message": "唤醒时要执行的指令"
}
```

| everyMs | 间隔 | 适用角色 |
|---------|------|---------|
| 300000 | 5 分钟 | 高频轮询 |
| 600000 | 10 分钟 | 常规执行 |
| 900000 | 15 分钟 | 默认推荐 |
| 1800000 | 30 分钟 | 巡查、监控 |
| 3600000 | 1 小时 | 低频检查 |

`sessionTarget: "isolated"` — cron 唤醒使用独立会话，不干扰用户对话。

## JaMOSS 中间件（已内置）

JMOS 是 Go 单体二进制，已预装在 Golden Image 中，所有容器开箱即用。路径：`/usr/local/bin/jmos`，以 systemd 服务 `jmos.service` 运行，监听端口 6565。

```bash
# 检查 JMOS 服务状态
systemctl status jmos.service

# 或通过 API 检查健康
curl -s http://127.0.0.1:6565/api/health
```

**无需手动安装**。如果服务异常，重启即可：`systemctl restart jmos.service`

Agents 通过 `task-cli.py` 调用 JMOS API：

```bash
python3 /opt/jamoss/task-cli.py --key $JAMOSS_API_KEY <command>
```

## 管理已有团队

### 查看当前团队

```bash
cat /home/node/.openclaw/openclaw.json | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
agents = cfg.get('agents', {}).get('list', [])
if not agents:
    print('当前无自定义团队')
else:
    for a in agents:
        cron = '有' if a.get('cron') else '无'
        print(f\"  {a['id']} | model: {a['model']['primary']} | cron: {cron}\")
"
```

### 删除团队

1. 用 `gateway config.get` 获取当前配置
2. 从 `agents.list` 中移除对应 agents
3. 用 `gateway config.patch` 写回
4. 清理 agent 目录: `rm -rf /home/node/.openclaw/agents/{agent-id}`

## 预置模板

以下为可用的预置团队模板，可直接安装：

### JaMOSS 四角色协作团队

| 角色 | ID | 模型 | 职责 |
|------|----|------|------|
| 规划师 | planner | gpt-5.4 | 任务分解、分配、交付 (leader) |
| 执行者 | executor | gpt-5.4 | 编码实现、提交成果 |
| 审查者 | reviewer | gpt-5.4 | 质量审查、评分 |
| 巡查者 | patrol | gpt-5.4 | 异常监控、超时检测 |

用户说 "安装 JaMOSS 团队" 时，按上述角色创建完整团队。

## 重要约束

- **每个团队必须有且仅有一个 `isLeader` agent** — 这是用户在 webchat 中选择对话的入口
- **agent ID 全局唯一** — 不能与已有 agent ID 冲突
- **sessionKey 格式**: `agent:{agentId}:main` — 用户通过切换 sessionKey 与不同 leader 对话
- **所有 agents 共享工作区** — 通过 `/data/teams/{team-name}/` 文件系统协作
- **config.patch 需要 baseHash** — 先 `config.get` 获取 hash，防止并发写入冲突
- **agents 变更自动热重载** — 修改 agents.list 后 OpenClaw 自动生效，无需重启
