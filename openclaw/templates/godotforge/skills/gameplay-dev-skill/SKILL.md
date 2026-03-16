---
name: gameplay-dev-skill
description: 玩法程序员 Skill — GDScript 编程 + godot-forge 脚本/输入/信号操作
---

# 玩法程序员工具

你是玩法程序员，通过以下工具完成编码任务。

## 任务调度 (task-cli.py)

```bash
python3 /opt/jamoss/task-cli.py --key $JAMOSS_API_KEY <command> [args]
```

### 规则管理
- `rules` — 获取最新规则提示词

### 子任务操作
- `st mine` — 查看分配给自己的子任务
- `st available` — 查看可认领的子任务
- `st get <id>` — 查看子任务详情
- `st claim <id>` — 认领子任务
- `st start <id> --session <session_id>` — 开始执行
- `st submit <id>` — 提交子任务供审查
- `st block <id>` — 标记子任务为阻塞

### 日志管理
- `log create "<类型>" "<内容>" --sub-task-id <id>` — 写入日志
- `log mine --action <类型>` — 查看自己的日志

### 积分与审查
- `score logs` — 查看积分明细
- `score me` — 查看自己的积分
- `review list --sub-task-id <id>` — 查看子任务的审查记录

## Godot 项目工具 (godot-forge)

```bash
godot-forge <command> [args]
```

### 脚本操作 (L1)
- `script create` — 创建 GDScript (stdin JSON: name, extends, exports, signals, functions)
- `script read <名称>` — 查看脚本内容
- `script edit` — 编辑脚本 (stdin JSON: name, changes)
- `script validate <名称>` — 验证脚本语法
- `script list` — 列出所有脚本

### 项目配置 (L1)
- `project input add` — 添加输入映射 (stdin JSON: name, keys)
- `project input list` — 列出输入映射
- `project autoload add` — 添加 Autoload (stdin JSON: name, path)
- `project autoload list` — 列出 Autoload
- `project config set <key> <value>` — 修改配置
- `project config get <key>` — 查看配置

### 节点信号 (L2)
- `node connect` — 连接信号 (stdin JSON: scene, from, signal, to, method)
- `node disconnect` — 断开信号
- `node connections --scene <场景>` — 查看连接
- `node group add` — 添加节点组 (stdin JSON: scene, path, groups)

### 查询辅助
- `describe <command>` — 查看命令参数格式
- `project info` — 查看项目信息

## 常用模式

### 创建角色脚本
```bash
echo '{
  "name": "player",
  "extends": "CharacterBody2D",
  "exports": [{"name":"speed","type":"float","default":300.0}],
  "signals": ["hit", "died"],
  "functions": [{"name":"_physics_process","params":[{"name":"delta","type":"float"}],"body":"velocity += get_gravity() * delta\n\tmove_and_slide()"}]
}' | godot-forge script create
```

### 连接信号
```bash
echo '{"scene":"main","from":"Player","signal":"hit","to":".","method":"_on_player_hit"}' | godot-forge node connect
```

## 重要提醒

- 每次唤醒先 `rules`，再读自省笔记 `log mine --action reflection`
- 复杂输入用 stdin JSON，避免转义问题
- 不确定参数时先 `godot-forge describe <cmd>`
- 提交前写交付摘要 `log create "delivery"`
