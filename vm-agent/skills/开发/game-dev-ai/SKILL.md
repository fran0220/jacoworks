---
name: game-dev-ai
display-name: 游戏开发助手
display-description: 使用 Godot 引擎开发游戏，支持创建、调试、导出和发布
description: >
  Game development with Godot Engine. Creates scenes, scripts, runs and
  debugs games using Godot CLI. Exports to Web and deploys to game gallery.
  Triggers on: 做游戏, 开发游戏, game development, godot, 游戏开发.
---

# 游戏开发助手 — Godot Engine

使用容器预装的 Godot 4.6.1 (headless) 开发游戏。通过 bash/write 工具完成全流程。

## 环境检查

收到游戏开发请求后，**先检查环境**：

```bash
godot --version          # 应输出 4.6.1.stable
ls /opt/godot-tools/     # godot_operations.gd + templates/
which Xvfb               # 虚拟显示 (截图用)
```

如果 `godot` 不可用：
- **OpenClaw 容器**: 报告异常，Godot 应已预装
- **本地模式**: 提示用户切换到 OpenClaw 模式 (推荐) 或自行安装 `brew install --cask godot`

## 项目创建

新游戏项目的标准结构：

```bash
# 1. 创建项目目录
mkdir -p ~/game/{scenes,scripts,assets/{sprites,sounds,fonts},export/web}

# 2. 创建 project.godot (最小配置)
cat > ~/game/project.godot << 'PROJ'
; Engine configuration file
; Do not modify this file directly

[application]
config/name="MyGame"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.4")

[display]
window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"

[rendering]
renderer/rendering_method="gl_compatibility"
PROJ

# 3. 复制 Web 导出预设
cp /opt/godot-tools/templates/export_presets.cfg ~/game/
```

## 场景操作

### 方式 1: godot_operations.gd (推荐，复杂场景)

```bash
# 创建场景
godot --headless --path ~/game --script /opt/godot-tools/godot_operations.gd -- \
  create_scene '{"path":"scenes/main.tscn","root_type":"Node2D"}'

# 添加节点
godot --headless --path ~/game --script /opt/godot-tools/godot_operations.gd -- \
  add_node '{"scene":"scenes/main.tscn","parent":".","type":"CharacterBody2D","name":"Player"}'

# 添加精灵
godot --headless --path ~/game --script /opt/godot-tools/godot_operations.gd -- \
  add_node '{"scene":"scenes/main.tscn","parent":"Player","type":"Sprite2D","name":"Sprite"}'
```

### 方式 2: 直接写 .tscn 文件 (简单场景或 godot_operations.gd 不支持时)

`.tscn` 是纯文本格式，可直接用 write 工具创建：

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="."]
script = ExtResource("1")

[node name="CollisionShape2D" type="CollisionShape2D" parent="Player"]

[node name="Sprite2D" type="Sprite2D" parent="Player"]
```

## GDScript 编写

用 write 工具创建脚本。**必须遵循规范** (见 `references/godot-best-practices.md`)：

```gdscript
# scripts/player.gd
class_name Player
extends CharacterBody2D

## 移动速度 (像素/秒)
@export var speed: float = 300.0
## 跳跃力度
@export var jump_velocity: float = -400.0

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")

func _physics_process(delta: float) -> void:
    if not is_on_floor():
        velocity.y += gravity * delta

    if Input.is_action_just_pressed("ui_accept") and is_on_floor():
        velocity.y = jump_velocity

    var direction: float = Input.get_axis("ui_left", "ui_right")
    velocity.x = direction * speed if direction else move_toward(velocity.x, 0, speed)

    move_and_slide()
```

## 测试与调试

**80/20 法则：每写一个脚本就测试，不要一次写多个文件再测。**

```bash
# 语法检查 (快速, 首选)
godot --headless --check-only --path ~/game 2>&1

# 运行项目 (逻辑层, 无画面, 5 秒超时)
timeout 5 godot --headless --path ~/game 2>&1 || true

# 带渲染运行 + 截图
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 godot --path ~/game &
sleep 3
DISPLAY=:99 import -window root /tmp/screenshot.png
kill %2  # 杀掉 godot
kill %1  # 杀掉 Xvfb
```

**错误处理**: 解析 stderr 输出，修复后重新测试。常见错误：
- `Parse Error` → 语法错误，检查 GDScript
- `Invalid get index` → 节点路径错误，检查场景树
- `Condition "..." is true` → 运行时断言，检查逻辑

## Web 导出

```bash
# 确保 export_presets.cfg 存在
ls ~/game/export_presets.cfg || cp /opt/godot-tools/templates/export_presets.cfg ~/game/

# 创建导出目录
mkdir -p ~/game/export/web

# 导出 (headless)
cd ~/game && godot --headless --export-release "Web" export/web/index.html 2>&1

# 验证产物
ls -la ~/game/export/web/
# 应包含: index.html, index.wasm, index.pck, index.js 等
```

## 部署到游戏广场

导出成功后，打包上传到 Gateway 游戏广场 API：

```bash
# 1. 截取游戏截图 (如果没有的话)
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 godot --path ~/game &
sleep 3
DISPLAY=:99 import -window root /tmp/screenshot.png
kill %2 %1

# 2. 打包 Web 导出产物
cd ~/game/export/web
tar czf /tmp/game-deploy.tar.gz .

# 3. 上传到游戏广场
curl -s -X POST "http://10.0.1.1:8847/api/games/deploy" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -F "file=@/tmp/game-deploy.tar.gz" \
  -F "title=我的游戏" \
  -F "description=游戏描述" \
  -F "thumbnail=@/tmp/screenshot.png"

# 返回: { "id": "xxx", "play_url": "https://jaco.jingao.club/games/xxx" }
```

部署成功后告知用户游戏广场链接，任何人可直接在浏览器试玩。

## 工作流总结

```
1. 检查环境 → godot --version
2. 创建项目 → mkdir + project.godot + export_presets.cfg
3. 创建场景 → godot_operations.gd 或直接写 .tscn
4. 编写脚本 → write 工具创建 .gd 文件
5. 测试验证 → godot --headless --check-only → godot --headless 运行
6. 迭代修复 → 解析错误 → 修改 → 重新测试
7. 导出 Web  → godot --export-release "Web"
8. 部署发布 → tar + curl POST /api/games/deploy
```

## 反模式 (必须避免)

见 `references/anti-patterns.md`，关键几条：

| ❌ 不要 | ✅ 替代 |
|---------|--------|
| `_process` 中轮询不变数据 | 用信号响应变化 |
| `get_parent().method()` | Signal up 或 group |
| 无类型变量 | 始终加类型提示 |
| 一次生成 5 个文件再测试 | 每写一个脚本立即测试 |

## References

- GDScript 编码规范: `references/godot-best-practices.md`
- Godot CLI 命令参考: `references/godot-cli-reference.md`
- 反模式清单: `references/anti-patterns.md`
