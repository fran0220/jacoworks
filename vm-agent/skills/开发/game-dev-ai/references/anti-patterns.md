# Godot 反模式清单

## 代码反模式

| ❌ 反模式 | ✅ 替代方案 | 说明 |
|----------|-----------|------|
| `_process` 中轮询不变数据 | 用信号响应变化 | `_process` 每帧调用，轮询浪费性能 |
| `get_parent().method()` | Signal up 或 group | 子节点不应知道父节点类型 |
| 深路径 `$A/B/C/D` | `%UniqueName` | 重构场景时深路径容易断 |
| `load()` 在 `_process` 中 | `preload()` 或缓存到变量 | 每帧 load 严重影响性能 |
| 无类型变量 `var x = 5` | 始终加类型 `var x: int = 5` | 类型提示提升可读性和性能 |
| 魔法数字 `if health < 20` | `const LOW_HEALTH: int = 20` 或 `@export` | 方便调试和修改 |
| Autoload 中放游戏逻辑 | Autoload 仅做服务/管理器 | 全局状态过多导致耦合 |
| `emit_signal("name")` | 类型化: `signal_name.emit()` | Godot 4 推荐类型化信号 |
| `node != null` 判断已释放节点 | `is_instance_valid(node)` | `!= null` 对已 free 的节点返回 true |

## 架构反模式

| ❌ 反模式 | ✅ 替代方案 |
|----------|-----------|
| 一个脚本 500+ 行 | 拆分为组件节点 (各自一个脚本) |
| 所有逻辑在 `_process` | 用状态机或信号驱动 |
| 硬编码场景切换路径 | 用 `@export var next_scene: PackedScene` |
| 多个脚本修改同一变量 | 单一权威源 + 信号通知 |
| 用 Timer 做精确物理计时 | 在 `_physics_process` 中用 delta 累积 |

## 工作流反模式

| ❌ 反模式 | ✅ 替代方案 |
|----------|-----------|
| 一次写 5 个文件再测试 | **每写一个脚本立即 `--check-only` 测试** |
| 先写完整游戏再运行 | **增量开发: 场景 → 一个脚本 → 测试 → 下一个** |
| 不看 stderr 输出 | **始终检查 godot 命令的 stderr** |
| 写复杂功能 | **最简方案优先 (simplest solution that works)** |
| 依赖视觉验证 | **先用 headless 测试逻辑，再截图验证画面** |
| 不用 export_presets.cfg | **项目创建时就复制导出预设** |

## 常见陷阱

### 1. 场景循环引用
```gdscript
# ❌ A.tscn 实例化 B.tscn, B.tscn 又实例化 A.tscn
# → 无限递归, 崩溃

# ✅ 用代码动态 add_child, 或重构场景层级
```

### 2. _ready 中访问未就绪的兄弟节点
```gdscript
# ❌ _ready 中兄弟节点可能还没 ready
func _ready() -> void:
    $"../OtherNode".do_something()  # 可能未就绪

# ✅ 延迟一帧
func _ready() -> void:
    await get_tree().process_frame
    $"../OtherNode".do_something()
```

### 3. 释放后访问节点
```gdscript
# ❌
enemy.queue_free()
enemy.health  # 可能已释放

# ✅
if is_instance_valid(enemy):
    enemy.health
```

### 4. 字符串信号名 (Godot 4 过时)
```gdscript
# ❌ Godot 3 风格
emit_signal("health_changed", new_health)
connect("health_changed", callable)

# ✅ Godot 4 类型化
health_changed.emit(new_health)
health_changed.connect(_on_health_changed)
```
