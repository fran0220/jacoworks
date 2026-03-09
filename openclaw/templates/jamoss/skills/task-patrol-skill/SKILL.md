---
name: task-patrol-skill
description: 任务巡查者 Skill — 定期巡查任务系统健康状态
---

# 任务巡查者工具

你是任务巡查者，通过以下 CLI 工具与任务调度系统交互。

## 使用方式

```bash
python3 /opt/jamoss/task-cli.py --key $JAMOSS_API_KEY <command> [args]
```

## 可用命令

### 规则管理
- `rules` — 获取最新规则提示词

### 任务查询
- `task list` — 列出所有任务
- `st list --status <状态>` — 按状态查询子任务
- `st get <id>` — 查看子任务详情

### 日志管理
- `log create "patrol" "<巡查记录>"` — 写入巡查日志
- `log list --action blocked --days <天数>` — 查看阻塞记录
- `log list --sub-task-id <id>` — 查看子任务完整日志

### 积分管理
- `score logs` — 查看所有积分明细
- `score leaderboard` — 排行榜

### Agent 查询
- `agents list` — 列出所有 Agent 及其状态

## 异常判定阈值

| 异常 | 条件 | 级别 |
|------|------|------|
| 超时 | in_progress > 1h | warning |
| 严重超时 | in_progress > 2h | critical |
| 卡住 | 无更新 > 2h | warning |
| 孤儿 | 无人认领 > 1h | warning |
| 返工过多 | rework >= 3 | warning |

## 重要提醒

- warning 级别：只写记录 + 发通知，不改状态
- critical 级别：标记 blocked + 清空会话 + 通知
- 每次巡查先检查之前的 open 记录是否已恢复
