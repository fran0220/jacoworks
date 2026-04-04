# Godot 4.6 Headless CLI 命令参考

容器内 Godot 路径: `/usr/local/bin/godot`
操作脚本路径: `/opt/godot-tools/godot_operations.gd`
导出模板路径: `/opt/godot-tools/templates/export_presets.cfg`

## 基本命令

```bash
# 版本检查
godot --version
# 输出: 4.6.1.stable

# 语法检查 (不运行, 仅验证脚本)
godot --headless --check-only --path <project> 2>&1

# Headless 运行 (逻辑层, 无渲染, 用于自动化测试)
timeout 5 godot --headless --path <project> 2>&1 || true

# 带渲染运行 (需要 Xvfb)
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 godot --path <project>
```

## godot_operations.gd 操作

通用调用格式:
```bash
godot --headless --path <project> \
  --script /opt/godot-tools/godot_operations.gd -- <operation> '<json_params>'
```

### create_scene — 创建场景文件

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  create_scene '{"path":"scenes/main.tscn","root_type":"Node2D"}'
```

参数:
- `path` (必需): 场景文件路径 (相对于项目根)
- `root_type` (必需): 根节点类型 (Node2D, Node3D, Control, etc.)

常用根节点类型:
| 类型 | 用途 |
|------|------|
| `Node2D` | 2D 游戏场景 |
| `Node3D` | 3D 游戏场景 |
| `Control` | UI 界面 |
| `CharacterBody2D` | 可控角色 |
| `RigidBody2D` | 物理对象 |

### add_node — 向场景添加节点

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  add_node '{"scene":"scenes/main.tscn","parent":".","type":"CharacterBody2D","name":"Player"}'
```

参数:
- `scene` (必需): 目标场景文件路径
- `parent` (必需): 父节点路径 (`.` 表示根节点)
- `type` (必需): 节点类型
- `name` (必需): 节点名称

常用节点类型:
| 类型 | 用途 |
|------|------|
| `CharacterBody2D` | 可控角色 |
| `RigidBody2D` | 物理刚体 |
| `StaticBody2D` | 静态碰撞体 |
| `Area2D` | 检测区域 |
| `Sprite2D` | 2D 精灵 |
| `AnimatedSprite2D` | 帧动画精灵 |
| `CollisionShape2D` | 碰撞形状 |
| `Camera2D` | 2D 相机 |
| `TileMapLayer` | 瓦片地图层 |
| `CanvasLayer` | UI 层 |
| `Label` | 文字标签 |
| `Button` | 按钮 |
| `Timer` | 定时器 |
| `AudioStreamPlayer` | 音频播放 |

### load_sprite — 设置纹理

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  load_sprite '{"scene":"scenes/main.tscn","node":"Player/Sprite","texture":"assets/sprites/player.png"}'
```

### save_scene — 保存场景

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  save_scene '{"path":"scenes/main.tscn"}'
```

### get_uid — 获取资源 UID

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  get_uid '{"path":"scenes/main.tscn"}'
```

### update_uids — 批量更新 UID

```bash
godot --headless --path ~/game \
  --script /opt/godot-tools/godot_operations.gd -- \
  update_uids '{}'
```

## Web 导出

```bash
# 前提: project 根目录需有 export_presets.cfg
cp /opt/godot-tools/templates/export_presets.cfg ~/game/

# 确保导出目录存在
mkdir -p ~/game/export/web

# 执行导出
cd ~/game && godot --headless --export-release "Web" export/web/index.html 2>&1

# 验证产物
ls -la ~/game/export/web/
# 预期文件: index.html, index.js, index.wasm, index.pck, index.worker.js, ...
```

导出产物说明:
| 文件 | 说明 | 大小 |
|------|------|------|
| `index.html` | 入口页面 | ~10KB |
| `index.wasm` | WebAssembly 二进制 | ~20-30MB |
| `index.pck` | 游戏资源包 | 视资源而定 |
| `index.js` | JavaScript 胶水代码 | ~200KB |
| `index.worker.js` | Web Worker | ~5KB |

## 截图

```bash
# 启动虚拟显示
Xvfb :99 -screen 0 1280x720x24 &
XVB_PID=$!

# 运行游戏
DISPLAY=:99 godot --path ~/game &
GODOT_PID=$!

# 等待渲染
sleep 3

# ImageMagick 截图
DISPLAY=:99 import -window root /tmp/screenshot.png

# 清理
kill $GODOT_PID $XVB_PID 2>/dev/null
```

## 常见超时保护

所有 Godot 命令都加超时，防止无限挂起：

```bash
# 语法检查 (10 秒足够)
timeout 10 godot --headless --check-only --path ~/game 2>&1

# 运行测试 (5 秒)
timeout 5 godot --headless --path ~/game 2>&1 || true

# 导出 (60 秒, 大项目可能需要更久)
timeout 60 godot --headless --export-release "Web" export/web/index.html 2>&1

# 截图流程 (10 秒)
timeout 10 bash -c 'DISPLAY=:99 godot --path ~/game & sleep 3 && DISPLAY=:99 import -window root /tmp/screenshot.png && kill %1'
```

## 错误排查

| 错误信息 | 原因 | 修复 |
|---------|------|------|
| `Parse Error: ...` | GDScript 语法错误 | 检查错误行号，修复语法 |
| `Invalid get index 'xxx'` | 节点路径不存在 | 检查场景树结构 |
| `Condition "..." is true` | 运行时断言失败 | 检查游戏逻辑 |
| `Failed to load resource` | 资源路径错误 | 检查 `res://` 路径 |
| `Export template not found` | 缺少导出模板 | 检查 export_presets.cfg |
| `No main scene defined` | project.godot 未设主场景 | 设置 `run/main_scene` |
