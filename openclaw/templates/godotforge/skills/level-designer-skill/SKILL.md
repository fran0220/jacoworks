---
name: level-designer-skill
description: 关卡设计师 Skill — godot-forge 场景/节点操作 + 任务调度
---

# 关卡设计师工具

你是关卡设计师，通过以下工具构建游戏世界。

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
- `review list --sub-task-id <id>` — 查看审查记录

## Godot 项目工具 (godot-forge)

```bash
godot-forge <command> [args]
```

### 场景操作 (L2)
- `scene create` — 创建场景 (stdin JSON: name, root_type, children)
- `scene read <名称>` — 查看场景节点树
- `scene list` — 列出所有场景
- `scene delete <名称>` — 删除场景
- `scene rename <旧名> <新名>` — 重命名场景
- `scene merge` — 合并场景 (stdin JSON: target, sources)

### 节点操作 (L2)
- `node add` — 添加节点 (stdin JSON: scene, name, type/instance, properties, children)
- `node remove --scene <场景> --path <路径>` — 删除节点
- `node list --scene <场景>` — 列出节点树
- `node update` — 更新节点属性 (stdin JSON: scene, path, properties)
- `node move` — 移动节点 (stdin JSON: scene, path, new_parent, new_name)
- `node duplicate` — 复制节点 (stdin JSON: scene, path, new_name)

### 查询辅助
- `describe <command>` — 查看命令参数格式
- `describe node-types` — 列出可用节点类型 (L3a)

## 常用模式

### 创建带嵌套子节点的关卡场景
```bash
echo '{
  "name": "level_01",
  "root_type": "Node2D",
  "children": [
    {"name":"World","type":"Node2D","children":[
      {"name":"Ground","type":"StaticBody2D","children":[
        {"name":"CollisionShape","type":"CollisionShape2D"}
      ]}
    ]},
    {"name":"SpawnPoints","type":"Node2D"},
    {"name":"PlayerSpawn","type":"Marker2D","properties":{"position":"Vector2(100,200)"}}
  ]
}' | godot-forge scene create
```

### 实例化子场景
```bash
echo '{"scene":"level_01","name":"Player","instance":"res://scenes/player.tscn","parent":"World"}' | godot-forge node add
```

### 复制节点 (批量放置)
```bash
echo '{"scene":"level_01","path":"World/Ground","new_name":"Ground2"}' | godot-forge node duplicate
```

## 重要提醒

- 每次唤醒先 `rules`，再读自省笔记
- 实例化子场景前确认目标 .tscn 文件存在 (`scene list`)
- 复杂节点树用 stdin JSON 输入
- 不确定参数时先 `godot-forge describe node.add`
- 提交前写交付摘要，包含场景路径和节点数量
