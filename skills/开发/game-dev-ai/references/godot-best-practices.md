# GDScript 编码规范 (Godot 4.x)

## 命名约定

| 类型 | 风格 | 示例 |
|------|------|------|
| 类名 | PascalCase | `class_name PlayerController` |
| 函数/变量 | snake_case | `var move_speed: float`, `func apply_damage()` |
| 常量 | SCREAMING_SNAKE | `const MAX_HEALTH: int = 100` |
| 信号 | snake_case (过去分词) | `signal health_changed(new_value: int)` |
| 枚举名 | PascalCase | `enum State { IDLE, RUNNING, JUMPING }` |
| 枚举值 | SCREAMING_SNAKE | `State.IDLE` |
| 文件名 | snake_case | `player_controller.gd` |
| 场景文件 | snake_case | `main_menu.tscn` |

## 脚本结构顺序

严格按以下顺序组织脚本：

```gdscript
# 1. class_name (可选)
class_name Player

# 2. extends
extends CharacterBody2D

# 3. 文档注释
## 玩家控制器，处理移动、跳跃和碰撞

# 4. 信号
signal health_changed(new_value: int)
signal died

# 5. 枚举
enum State { IDLE, RUNNING, JUMPING, FALLING }

# 6. @export 变量
@export var speed: float = 300.0
@export var jump_force: float = -400.0
@export_group("Combat")
@export var max_health: int = 100

# 7. 常量
const COYOTE_TIME: float = 0.1

# 8. 普通变量
var current_state: State = State.IDLE
var _health: int = 100  # 私有用下划线前缀

# 9. @onready 变量
@onready var sprite: Sprite2D = %Sprite2D
@onready var animation_player: AnimationPlayer = %AnimationPlayer
@onready var collision_shape: CollisionShape2D = %CollisionShape2D

# 10. 生命周期函数
func _ready() -> void:
    pass

func _process(delta: float) -> void:
    pass

func _physics_process(delta: float) -> void:
    pass

func _input(event: InputEvent) -> void:
    pass

# 11. 公共方法
func take_damage(amount: int) -> void:
    _health -= amount
    health_changed.emit(_health)
    if _health <= 0:
        died.emit()

# 12. 私有方法 (下划线前缀)
func _update_animation() -> void:
    pass
```

## 类型提示 (强制)

**始终为所有变量和函数加类型提示**：

```gdscript
# ✅ 正确
var speed: float = 100.0
var player_name: String = "Hero"
var items: Array[Item] = []
var stats: Dictionary = {}

func calculate_damage(base: int, multiplier: float) -> int:
    return int(base * multiplier)

func get_player() -> Player:
    return $Player as Player

# ❌ 错误 (无类型)
var speed = 100.0
func calculate_damage(base, multiplier):
    return base * multiplier
```

## 节点引用

```gdscript
# ✅ 推荐: Unique Name (场景中右键 → "% Access as Unique Name")
@onready var player: Player = %Player
@onready var hud: CanvasLayer = %HUD

# ✅ 可接受: 短路径
@onready var sprite: Sprite2D = $Sprite2D

# ❌ 避免: 深路径
@onready var health_bar = $UI/HUD/Panels/StatusBar/HealthBar

# ❌ 避免: get_node 字符串
var player = get_node("../../Player")
```

## 通信模式: Signal Up, Call Down

```gdscript
# 父节点调用子节点方法 (Call Down) ✅
func _on_attack_pressed() -> void:
    $Weapon.fire()

# 子节点通知父节点用信号 (Signal Up) ✅
# player.gd
signal health_changed(value: int)
func take_damage(amount: int) -> void:
    health -= amount
    health_changed.emit(health)

# ❌ 不要从子节点调用父节点方法
func take_damage(amount: int) -> void:
    get_parent().update_health_bar(health)  # 耦合!
```

## 资源管理

```gdscript
# ✅ 预加载 (编译时, 用于已知资源)
const BULLET_SCENE: PackedScene = preload("res://scenes/bullet.tscn")

# ✅ 运行时加载 (用于动态资源)
var texture: Texture2D = load("res://assets/sprites/enemy_%s.png" % type_name)

# ❌ 不要在 _process 中 load
func _process(delta: float) -> void:
    var tex = load("res://assets/sprite.png")  # 每帧加载!
```

## 场景实例化

```gdscript
# 标准模式
const ENEMY_SCENE: PackedScene = preload("res://scenes/enemy.tscn")

func spawn_enemy(pos: Vector2) -> void:
    var enemy: Enemy = ENEMY_SCENE.instantiate() as Enemy
    enemy.global_position = pos
    add_child(enemy)
```

## 常用 2D 物理模式

### CharacterBody2D 移动

```gdscript
extends CharacterBody2D

@export var speed: float = 300.0
@export var jump_velocity: float = -400.0

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")

func _physics_process(delta: float) -> void:
    # 重力
    if not is_on_floor():
        velocity.y += gravity * delta

    # 跳跃
    if Input.is_action_just_pressed("ui_accept") and is_on_floor():
        velocity.y = jump_velocity

    # 水平移动
    var direction: float = Input.get_axis("ui_left", "ui_right")
    if direction:
        velocity.x = direction * speed
    else:
        velocity.x = move_toward(velocity.x, 0, speed)

    move_and_slide()
```

### Area2D 碰撞检测

```gdscript
extends Area2D

signal collected

func _ready() -> void:
    body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
    if body is Player:
        collected.emit()
        queue_free()
```

## 状态机模式

```gdscript
class_name StateMachine
extends Node

@export var initial_state: State

var current_state: State
var states: Dictionary = {}

func _ready() -> void:
    for child in get_children():
        if child is State:
            states[child.name.to_lower()] = child
            child.transitioned.connect(_on_child_transition)

    if initial_state:
        initial_state.enter()
        current_state = initial_state

func _process(delta: float) -> void:
    if current_state:
        current_state.update(delta)

func _physics_process(delta: float) -> void:
    if current_state:
        current_state.physics_update(delta)

func _on_child_transition(state: State, new_state_name: String) -> void:
    if state != current_state:
        return
    var new_state: State = states.get(new_state_name.to_lower())
    if not new_state:
        return
    current_state.exit()
    new_state.enter()
    current_state = new_state
```
