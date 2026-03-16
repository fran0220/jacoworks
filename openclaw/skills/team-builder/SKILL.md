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

---

## 一、创建团队完整流程

### Step 1: 设计团队结构

与用户确认以下信息：

| 项目 | 要求 | 示例 |
|------|------|------|
| 团队名称 | 英文小写 + 连字符 | `research-team` |
| 角色列表 | id、名称、职责 | leader / researcher / writer |
| Leader | **有且仅有一个** (用户对话入口) | leader 设为 `isLeader: true` |
| 模型选择 | 参考下方模型列表 | `proxy/gpt-5.4` |
| Cron 间隔 | 参考下方 Cron 配置 | `900000` (15 分钟) |
| 中间件 | 是否需要 JaMOSS 任务调度 | 简单团队可不需要 |
| 共享工作区 | 统一在 `/data/teams/{name}/` | 所有角色共享 |

### Step 2: 创建 Agent 目录和文件

每个 agent 需要在容器内创建以下结构：

```
/home/node/.openclaw/agents/{agent-id}/
  prompt.md                    # 系统提示词
  skills/
    {skill-name}/
      SKILL.md                 # AgentSkill 定义
```

**prompt.md 编写规范**：

```markdown
# 角色：{角色名称}

## 身份
你是{角色名称}，专注于{核心职责}。

## 核心职责
1. {职责1} — 具体描述
2. {职责2} — 具体描述

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

## 语气风格
{描述该角色的沟通风格}

## 禁止事项
- ❌ {明确禁止的行为}
```

**SKILL.md 编写规范**：

```markdown
---
name: {skill-name}
description: {一句话描述}
---

# {技能名称}

## 使用方式
{具体工具和命令说明，带完整示例}
```

**Skill 来源说明**：
- **容器共享 Skill** (`~/.openclaw/skills/`) 中的 Skill 所有 Agent 自动可用，无需复制
- **Agent 专属 Skill** 才需要写入 `{agentDir}/skills/` 目录
- 先用 `ls /home/node/.openclaw/skills/` 检查已有共享 Skill，避免重复创建

### Step 3: 创建共享工作区

```bash
mkdir -p /data/teams/{team-name}
```

写入 `AGENTS.md` 到工作区，描述团队成员和协作方式：

```markdown
# {团队名称} 工作区

## 团队成员
- **{角色1}** — {职责描述}
- **{角色2}** — {职责描述}

## 目录结构
tasks/                    任务工作目录
  {任务名}_{短ID}/        每个任务一个目录

## 协作方式
{描述团队如何通过文件系统或 API 协作}
```

### Step 4: 注册 Agents 到 openclaw.json

使用 `gateway` 工具注册（**推荐用 Python 脚本避免 JSON 转义错误**）：

```bash
python3 -c "
import json, subprocess, sys

# 1. 获取当前配置
result = subprocess.run(['gateway', 'config.get'], capture_output=True, text=True)
current = json.loads(result.stdout)
base_hash = current.get('hash', '')

# 2. 构造新 agents
new_agents = [
    {
        'id': '{agent-id}',
        'workspace': '/data/teams/{team-name}',
        'agentDir': '/home/node/.openclaw/agents/{agent-id}',
        'model': {'primary': 'proxy/gpt-5.4'},
        'skills': ['{skill-name}'],
        'cron': {
            'schedule': {'kind': 'every', 'everyMs': 900000},
            'sessionTarget': 'isolated',
            'message': '{cron 唤醒指令}'
        }
    }
    # ... 添加更多 agents
]

# 3. 合并已有 agents (如果有的话)
existing = current.get('config', {}).get('agents', {}).get('list', [])
merged = existing + new_agents

# 4. 构造 patch
patch = {
    'raw': json.dumps({'agents': {'list': merged}}),
    'baseHash': base_hash,
    'note': '添加团队 {team-name}'
}

# 5. 执行 patch
result = subprocess.run(
    ['gateway', 'config.patch', json.dumps(patch)],
    capture_output=True, text=True
)
if result.returncode != 0:
    print(f'❌ config.patch 失败: {result.stderr}', file=sys.stderr)
    sys.exit(1)
print('✅ agents 注册成功，OpenClaw 将自动热重载')
"
```

**⚠️ 重要注意事项**：
- `agents.list` 变更后 OpenClaw **自动热重载**，无需重启
- `baseHash` 防止并发覆盖，必须从 `config.get` 获取
- 如果已有 `agents.list`，必须先读取再 append，不能覆盖

### Step 5: 验证

```bash
# 1. 检查 agents 目录是否创建正确
ls -la /home/node/.openclaw/agents/

# 2. 检查每个 agent 的文件
for agent_id in {agent-id-1} {agent-id-2}; do
  echo "=== $agent_id ==="
  ls -la /home/node/.openclaw/agents/$agent_id/
  ls -la /home/node/.openclaw/agents/$agent_id/skills/ 2>/dev/null
done

# 3. 检查 openclaw.json 中的 agents.list
python3 -c "
import json
with open('/home/node/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
for a in cfg.get('agents', {}).get('list', []):
    cron = '✅' if a.get('cron') else '❌'
    skills = ', '.join(a.get('skills', []))
    print(f\"  {a['id']} | model: {a['model']['primary']} | cron: {cron} | skills: {skills}\")
"

# 4. 检查工作区
ls -la /data/teams/{team-name}/
cat /data/teams/{team-name}/AGENTS.md
```

---

## 二、错误恢复

### config.patch 失败

| 错误 | 原因 | 解决 |
|------|------|------|
| `hash mismatch` | 配置已被其他操作修改 | 重新 `config.get` 获取最新 hash，再 patch |
| `invalid JSON` | patch 内容格式错误 | 用 Python `json.dumps()` 生成，避免手动转义 |
| `permission denied` | 权限不足 | 确认用 `gateway` 工具而非直接编辑文件 |

### Agent 未生效

```bash
# 检查 OpenClaw 是否热重载成功
cat /home/node/.openclaw/openclaw.json | python3 -m json.tool

# 如果 agent 未出现，手动触发重载
gateway config.get  # 读取一次触发检测

# 极端情况：直接编辑 openclaw.json 后等待自动检测 (通常 <5s)
```

### 回滚团队

如果创建的团队有问题，按以下步骤回滚：

```bash
# 1. 从 agents.list 移除
python3 -c "
import json, subprocess
result = subprocess.run(['gateway', 'config.get'], capture_output=True, text=True)
current = json.loads(result.stdout)
base_hash = current.get('hash', '')

# 要删除的 agent IDs
remove_ids = {'{agent-id-1}', '{agent-id-2}'}
existing = current.get('config', {}).get('agents', {}).get('list', [])
filtered = [a for a in existing if a['id'] not in remove_ids]

patch = {
    'raw': json.dumps({'agents': {'list': filtered}}),
    'baseHash': base_hash,
    'note': '回滚团队 {team-name}'
}
subprocess.run(['gateway', 'config.patch', json.dumps(patch)])
print('✅ agents 已从配置移除')
"

# 2. 清理 agent 目录
rm -rf /home/node/.openclaw/agents/{agent-id-1}
rm -rf /home/node/.openclaw/agents/{agent-id-2}

# 3. 可选：清理工作区（谨慎，可能有产出物）
# rm -rf /data/teams/{team-name}
```

---

## 三、可用模型

所有模型通过 `proxy/` 前缀访问 LLM 中转站。容器 provision 时已自动配置。

| 模型 | 适用场景 | 上下文 | 特点 |
|------|---------|--------|------|
| `proxy/gpt-5.4` | **推荐默认** — 通用任务、编码、规划 | 128K | 均衡性价比 |
| `proxy/gpt-5.3-codex` | 纯编码任务 | 192K | 编码专精 |
| `proxy/claude-sonnet-4-6` | 日常对话、文档写作 | 200K | 快速响应 |
| `proxy/claude-opus-4-6` | 复杂推理、架构设计 | 200K | 深度推理 (reasoning) |
| `proxy/grok-4.1-fast` | 高速轮询、简单任务 | 131K | 低延迟 |
| `proxy/gemini-3.1-pro-preview` | 长文分析、深度推理 | 1M | 超长上下文 |
| `proxy/glm-5` | 中文深度推理 | 128K | 中文优化 |

**选型建议**：
- **Leader / Planner** → `gpt-5.4` 或 `claude-opus-4-6` (需要规划和决策能力)
- **Executor** → `gpt-5.4` 或 `gpt-5.3-codex` (编码类用 codex)
- **Reviewer** → `gpt-5.4` 或 `claude-sonnet-4-6` (审查不需要超强推理)
- **Patrol / Monitor** → `grok-4.1-fast` (高频轮询，低延迟优先)
- **Research / Analysis** → `gemini-3.1-pro-preview` (长文分析) 或 `glm-5` (中文场景)

**注意**：实际可用模型由管理后台 DB 配置决定。查看当前可用模型：
```bash
cat /home/node/.openclaw/openclaw.json | python3 -c "
import json, sys
cfg = json.load(sys.stdin)
for pname, p in cfg.get('models', {}).get('providers', {}).items():
    for m in p.get('models', []):
        print(f'  {pname}/{m[\"id\"]} — {m.get(\"name\", \"\")} (ctx: {m.get(\"contextWindow\", \"?\")})')
"
```

---

## 四、Cron 配置

```json
{
  "schedule": { "kind": "every", "everyMs": 900000 },
  "sessionTarget": "isolated",
  "message": "唤醒时要执行的指令"
}
```

| everyMs | 间隔 | 适用角色 |
|---------|------|---------|
| 300000 | 5 分钟 | 高频轮询（不推荐，消耗大） |
| 600000 | 10 分钟 | 常规执行 |
| 900000 | 15 分钟 | **默认推荐** |
| 1800000 | 30 分钟 | 巡查、监控 |
| 3600000 | 1 小时 | 低频检查、日报 |

**关键概念**：
- `sessionTarget: "isolated"` — cron 唤醒使用独立会话，**不干扰用户对话**
- `message` — 每次唤醒时发给 agent 的指令，应具体到要执行的检查流程
- `kind: "every"` — 固定间隔；还可用 `kind: "cron", expr: "0 7 * * *"` 做定时触发

---

## 五、JaMOSS 中间件

### 概述

JMOS 是 Go 单体二进制，**已预装在 Golden Image 中**，所有容器开箱即用。

| 项目 | 值 |
|------|-----|
| 二进制 | `/usr/local/bin/jmos` |
| 配置 | `/etc/jmos/config.yaml` |
| 服务 | `jmos.service` (systemd, 开机自启) |
| 端口 | `6565` |
| 数据库 | `/data/workspace/jamoss/data/tasks.db` (SQLite) |

### 检查与管理

```bash
# 检查服务状态
systemctl status jmos.service

# 健康检查
curl -s http://127.0.0.1:6565/api/health

# 重启 (异常时)
systemctl restart jmos.service
```

### Agent 调用方式

所有角色通过 `task-cli.py` CLI 工具与 JMOS 交互：

```bash
python3 /opt/jamoss/task-cli.py --key $JAMOSS_API_KEY <command> [args]
```

**常用命令速查**：

| 角色 | 高频命令 |
|------|---------|
| **Planner** | `task create`, `st create`, `module create`, `st list`, `rules` |
| **Executor** | `st mine`, `st claim`, `st start`, `st submit`, `rules` |
| **Reviewer** | `st list --status review`, `review create`, `rules` |
| **Patrol** | `st list --status in_progress`, `agents list`, `rules` |
| **所有角色** | `rules` (每次唤醒必须先执行), `log create`, `score me` |

### 有无中间件的区别

| | 有 JaMOSS | 无中间件 |
|--|-----------|---------|
| **协作方式** | REST API (task-cli.py → JMOS :6565) | 共享文件系统读写 |
| **适用场景** | 复杂多步骤任务分解 | 简单对话型团队 |
| **任务追踪** | Task → Module → SubTask 状态机 | 自行管理 |
| **评分审查** | 内置评分 + 排行榜 | 无 |
| **异常监控** | 巡查 + 阻塞检测 | 无 |

**建议**：如果团队需要任务分解和质量管控，使用 JaMOSS；如果只是多角色对话协作（如翻译团队、研究团队），可以不用中间件，通过共享文件协作。

---

## 六、安装预置模板 — JaMOSS 快速安装

当用户说「安装 JaMOSS 团队」时，执行以下完整步骤：

### 自动安装流程

```bash
# Step 1: 创建 Agent 目录结构
for agent_id in planner executor reviewer patrol; do
  mkdir -p /home/node/.openclaw/agents/$agent_id/skills
done

# Step 2: 检查 JMOS 服务
systemctl status jmos.service
curl -s http://127.0.0.1:6565/api/health
```

### 四个角色的配置

| 角色 | Agent ID | Skill | Model | Cron | 职责 |
|------|----------|-------|-------|------|------|
| 规划师 | `planner` | `task-planner-skill` | `proxy/gpt-5.4` | 15 分钟 | 任务分解、分配、交付 (**leader**) |
| 执行者 | `executor` | `task-executor-skill` | `proxy/gpt-5.4` | 15 分钟 | 编码实现、提交成果 |
| 审查者 | `reviewer` | `task-reviewer-skill` | `proxy/gpt-5.4` | 15 分钟 | 质量审查、评分 |
| 巡查者 | `patrol` | `task-patrol-skill` | `proxy/gpt-5.4` | 30 分钟 | 超时检测、异常监控 |

### 各角色 prompt.md 和 SKILL.md

你需要为每个角色创建对应的 prompt.md 和 SKILL.md。以下是各角色的核心内容要点：

**planner/prompt.md** — 任务规划师：
- 需求理解 → 模块划分 → 子任务拆分 → Agent 匹配
- 每次唤醒流程：`rules` → `score logs` → 异常处理 → 进度监控 → 收尾交付
- 工作目录规范：`tasks/{任务名}_{短ID}/{子任务名}_{短ID}/`

**executor/prompt.md** — 执行者：
- 认领子任务 → 编码实现 → 提交审查
- 每次唤醒：`rules` → `st mine` → 执行 → `st submit`
- 所有产出放在子任务工作目录下

**reviewer/prompt.md** — 审查者：
- 查看待审查 → 读交付摘要 → 检查文件 → 评分
- 评分标准：5=超出预期 4=完全达标 3=基本达标 2=部分达标 1=严重不足
- 驳回时必须具体说明问题

**patrol/prompt.md** — 巡查者：
- 超时检测 (in_progress > 1h = warning, > 2h = critical)
- 卡住检测 (无更新 > 2h)、孤儿任务 (无人认领 > 1h)
- warning 只记录不改状态，critical 标记 blocked

**各角色 Skill 的核心命令**：

| Skill | 核心命令 |
|-------|---------|
| `task-planner-skill` | `task create/list/get`, `module create`, `st create/list`, `rules`, `log create`, `score adjust` |
| `task-executor-skill` | `st mine/available/claim/start/submit/block`, `rules`, `log create` |
| `task-reviewer-skill` | `st list --status review`, `review create <id> approved/rejected <score>`, `rules` |
| `task-patrol-skill` | `st list --status in_progress`, `agents list`, `rules`, `log create "patrol"` |

### 注册到 openclaw.json

```bash
python3 -c "
import json, subprocess

result = subprocess.run(['gateway', 'config.get'], capture_output=True, text=True)
current = json.loads(result.stdout)
base_hash = current.get('hash', '')

agents = [
    {
        'id': 'planner',
        'workspace': '/data/teams/jamoss',
        'agentDir': '/home/node/.openclaw/agents/planner',
        'model': {'primary': 'proxy/gpt-5.4'},
        'skills': ['task-planner-skill'],
        'cron': {
            'schedule': {'kind': 'every', 'everyMs': 900000},
            'sessionTarget': 'isolated',
            'message': '检查任务队列，分配待分配子任务，跟进阻塞项，处理收尾交付'
        }
    },
    {
        'id': 'executor',
        'workspace': '/data/teams/jamoss',
        'agentDir': '/home/node/.openclaw/agents/executor',
        'model': {'primary': 'proxy/gpt-5.4'},
        'skills': ['task-executor-skill'],
        'cron': {
            'schedule': {'kind': 'every', 'everyMs': 900000},
            'sessionTarget': 'isolated',
            'message': '检查我的子任务，继续执行进行中的任务，认领新任务'
        }
    },
    {
        'id': 'reviewer',
        'workspace': '/data/teams/jamoss',
        'agentDir': '/home/node/.openclaw/agents/reviewer',
        'model': {'primary': 'proxy/gpt-5.4'},
        'skills': ['task-reviewer-skill'],
        'cron': {
            'schedule': {'kind': 'every', 'everyMs': 900000},
            'sessionTarget': 'isolated',
            'message': '检查待审查的子任务，逐个审查评分'
        }
    },
    {
        'id': 'patrol',
        'workspace': '/data/teams/jamoss',
        'agentDir': '/home/node/.openclaw/agents/patrol',
        'model': {'primary': 'proxy/gpt-5.4'},
        'skills': ['task-patrol-skill'],
        'cron': {
            'schedule': {'kind': 'every', 'everyMs': 1800000},
            'sessionTarget': 'isolated',
            'message': '执行巡查：超时检测、卡住检测、孤儿任务、返工监控'
        }
    }
]

existing = current.get('config', {}).get('agents', {}).get('list', [])
existing_ids = {a['id'] for a in existing}
for a in agents:
    if a['id'] not in existing_ids:
        existing.append(a)

patch = {
    'raw': json.dumps({'agents': {'list': existing}}),
    'baseHash': base_hash,
    'note': '安装 JaMOSS 团队'
}
result = subprocess.run(['gateway', 'config.patch', json.dumps(patch)], capture_output=True, text=True)
if result.returncode != 0:
    print(f'❌ 失败: {result.stderr}')
else:
    print('✅ JaMOSS 团队安装成功')
"
```

### 创建工作区

```bash
mkdir -p /data/teams/jamoss/tasks
cat > /data/teams/jamoss/AGENTS.md << 'EOF'
# JaMOSS 多智能体协作团队工作区

## 团队成员
- **规划师 (Planner)** — 需求分析、任务拆分、进度监控、收尾交付
- **执行者 (Executor)** — 领取子任务、高质量执行、交付成果
- **审查者 (Reviewer)** — 质量审查、评分打分、返工决策
- **巡查者 (Patrol)** — 超时检测、异常监控、闭环跟踪

## 目录结构
tasks/                    任务工作目录
  {任务名}_{短ID}/        每个任务一个目录
    {子任务名}_{短ID}/    每个子任务一个子目录

## 协作方式
通过 JaMOSS API (localhost:6565) + 共享文件系统协作，无需直接通信。
EOF
```

### 验证安装

```bash
echo "=== 1. Agent 目录 ==="
for id in planner executor reviewer patrol; do
  echo "$id: $(ls /home/node/.openclaw/agents/$id/ 2>/dev/null || echo 'NOT FOUND')"
done

echo -e "\n=== 2. openclaw.json agents ==="
python3 -c "
import json
with open('/home/node/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
for a in cfg.get('agents', {}).get('list', []):
    print(f\"  {a['id']} | {a['model']['primary']} | skills: {a.get('skills', [])}\")
"

echo -e "\n=== 3. JMOS 健康 ==="
curl -s http://127.0.0.1:6565/api/health

echo -e "\n=== 4. 工作区 ==="
ls -la /data/teams/jamoss/
```

---

## 七、管理已有团队

### 查看所有团队

```bash
python3 -c "
import json
with open('/home/node/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
agents = cfg.get('agents', {}).get('list', [])
if not agents:
    print('当前无自定义团队')
else:
    # 按 workspace 分组显示
    teams = {}
    for a in agents:
        ws = a.get('workspace', 'default')
        teams.setdefault(ws, []).append(a)
    for ws, members in teams.items():
        print(f'\n📁 {ws}')
        for a in members:
            cron = '✅' if a.get('cron') else '❌'
            skills = ', '.join(a.get('skills', []))
            leader = ' 👑' if a.get('id') == members[0].get('id') else ''
            print(f'  {a[\"id\"]}{leader} | model: {a[\"model\"][\"primary\"]} | cron: {cron} | skills: {skills}')
"
```

### 修改团队配置

修改某个 agent 的模型或 cron：

```bash
python3 -c "
import json, subprocess

result = subprocess.run(['gateway', 'config.get'], capture_output=True, text=True)
current = json.loads(result.stdout)
base_hash = current.get('hash', '')

agents = current.get('config', {}).get('agents', {}).get('list', [])
for a in agents:
    if a['id'] == '{target-agent-id}':
        a['model']['primary'] = 'proxy/{new-model}'        # 改模型
        # a['cron']['schedule']['everyMs'] = 600000         # 改间隔

patch = {
    'raw': json.dumps({'agents': {'list': agents}}),
    'baseHash': base_hash,
    'note': '修改 {target-agent-id} 配置'
}
subprocess.run(['gateway', 'config.patch', json.dumps(patch)])
"
```

### 删除团队

```bash
python3 -c "
import json, subprocess

result = subprocess.run(['gateway', 'config.get'], capture_output=True, text=True)
current = json.loads(result.stdout)
base_hash = current.get('hash', '')

# 要删除的 agent IDs
remove_ids = {'{agent-id-1}', '{agent-id-2}'}
existing = current.get('config', {}).get('agents', {}).get('list', [])
filtered = [a for a in existing if a['id'] not in remove_ids]

patch = {
    'raw': json.dumps({'agents': {'list': filtered}}),
    'baseHash': base_hash,
    'note': '删除团队 {team-name}'
}
subprocess.run(['gateway', 'config.patch', json.dumps(patch)])
print('✅ agents 已从配置移除')
"

# 清理 agent 目录
for id in {agent-id-1} {agent-id-2}; do
  rm -rf /home/node/.openclaw/agents/$id
done

# 可选：清理工作区（谨慎操作，确认无需保留的产出物）
# rm -rf /data/teams/{team-name}
```

---

## 八、关键概念与约束

### 核心概念

| 概念 | 说明 |
|------|------|
| **sessionKey** | `agent:{agentId}:main` — webchat 通过切换 sessionKey 选择对话 agent |
| **isolated session** | cron 唤醒使用独立会话，不与用户对话混合 |
| **shared workspace** | 所有 agent 共享 `/data/teams/{name}/` 目录，通过文件协作 |
| **agentDir** | `/home/node/.openclaw/agents/{id}/` — 存放 prompt.md 和专属 skills |
| **共享 skills** | `~/.openclaw/skills/` — 所有 agent 自动可见的公共技能 |

### 约束清单

- ✅ 每个团队**有且仅有一个 Leader** — 这是 webchat 中用户选择对话的入口
- ✅ **Agent ID 全局唯一** — 不能与已有 agent ID 冲突 (含 profiles 中的 agents)
- ✅ **config.patch 需要 baseHash** — 先 `config.get` 获取 hash，防止并发写入
- ✅ **agents 变更自动热重载** — 修改 agents.list 后 OpenClaw 自动生效 (<5s)
- ✅ **prompt.md 是必须的** — 每个 agent 必须有，否则使用默认空提示词
- ❌ **不要直接编辑 openclaw.json** — 用 `gateway config.patch`，除非紧急回滚
- ❌ **不要在 sandbox 模式下创建团队** — 容器 sandbox 为 off，团队创建需要文件系统访问
