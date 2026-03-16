---
name: blender-scene
description: "Create and export 3D scenes using Blender 4.4 bpy scripts + Kenney GLB assets for Three.js. Use when building office environments, assembling furniture layouts, or exporting GLB for the observatory."
---

# Blender Scene Builder Skill

Assemble 3D scenes from Kenney Furniture Kit GLB assets via headless Blender, export as `.glb` for Three.js.

## Environment

| Item | Path |
|------|------|
| Blender 4.4 | `/Applications/Blender.app/Contents/MacOS/Blender` |
| Kenney assets (raw) | `/tmp/kenney-furniture/Models/GLTF format/*.glb` |
| Build scripts | `scripts/blender/*.py` |
| Preview output | `/tmp/office-build/*.png` |
| Diagnostic output | `/tmp/office-build/*-diag.txt` |
| GLB output | `webchat/public/observatory/office.glb` |

## ⚠️ 核心原则：永远不要一次性生成完整脚本

**一次性生成 500 行 Blender 脚本是赌博。** 必须采用渐进式构建：

1. **一个构建脚本始终是单一源文件** — 但通过 `edit_file` 逐段追加内容
2. **每追加一段后立即渲染 + 验证** — 不要等到最后
3. **验证失败时只修改出问题的部分** — 不要重写整个脚本
4. **数值诊断优先于肉眼** — 用诊断脚本检测浮空/越界，不靠猜

---

## 渐进式构建流程 (8 个 Gate)

每个 Gate 都有明确的通过条件。**不通过不准进入下一步。**

```
Gate 1: 骨架          地板 + 外墙 + 角件 → 渲染全景 + 诊断 → ✓ 围合无缺口
Gate 2: 隔断          十字分隔 + 门洞 → 渲染全景 → ✓ 连续无缝隙
Gate 3: 第一个区域    选一个区域 (如 Forge) 放满家具 → 近景渲染 + 诊断 → ✓ 无浮空无越界
Gate 4: 剩余区域      逐个添加 Tower/Court/Lounge/Hub → 每加一个: 近景渲染 + 诊断 → ✓
Gate 5: 走廊 + 装饰   走廊家具、绿植、灯具 → 全景渲染 → ✓ 密度适当
Gate 6: 灯光 + 相机   灯光调色、相机角度 → 全景渲染 → ✓ 视觉质量
Gate 7: 诊断全检      跑完整诊断脚本 → ✓ 零浮空、零越界、零穿墙
Gate 8: AI Review     --strict 模式审核 → ✓ PASS (≥8.0 且无 critical)
         ↓ PASS → 导出 GLB
         ↓ NEEDS_FIX → 定位问题 → edit_file 修补 → 回到对应 Gate 重验
```

### 每个 Gate 的操作模板

```
1. edit_file: 在构建脚本末尾（渲染代码之前）追加新内容
2. Bash: 运行 Blender 渲染
3. look_at: 查看渲染 PNG (全景或近景)
4. Bash: 运行诊断脚本检测数值问题
5. 判断: 通过 → 下一个 Gate | 不通过 → edit_file 修复 → 重复 2~4
```

---

## 运行命令

```bash
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"

# 渲染预览 (看最后 20 行即可)
$BLENDER --background --factory-startup --python scripts/blender/build-office.py 2>&1 | tail -20

# 检查输出
# → /tmp/office-build/xxx.png  (用 look_at 工具查看)
# → webchat/public/observatory/office.glb (最终产物)
```

---

## 三个验证工具

### 1. look_at — 视觉检查 (每步必用)

渲染后用 `look_at` 工具查看 PNG，描述清楚要检查什么：

```
look_at("/tmp/office-build/gate1-walls.png",
  objective="检查四个角落是否完全闭合, 外墙是否连续无缺口",
  context="Gate 1 验证: 地板+外墙+角件的围合完整性")
```

**全景 vs 近景**:
- 全景: `ortho_scale = 36`, 检查整体布局
- 近景: `ortho_scale = 16~22`, 相机对准单个区域中心, 检查家具细节

近景相机代码 (临时替换渲染段):
```python
# 近景检查 Forge 区 (-6, -6)
bpy.ops.object.camera_add(location=(-6+18, -6-18, 18))
cam = bpy.context.active_object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 18
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
```

### 2. 诊断脚本 — 数值检测 (Gate 3+ 必用)

在构建脚本末尾（渲染之后）追加诊断代码，打印所有物体的 Z 位置和边界：

```python
# ── DIAGNOSTICS (追加在渲染之后) ──
print("\n" + "="*60)
print("  DIAGNOSTICS: Object placement audit")
print("="*60)

FLOOR_Z = 0.0
TOLERANCE = 0.02  # 2cm tolerance
BOUNDARY = 12.0   # outer wall at ±12m
issues = []

for obj in bpy.data.objects:
    if obj.type == 'EMPTY' and obj.children:
        # Get world-space bounding box
        all_coords = []
        for child in [obj] + list(obj.children_recursive):
            if child.type == 'MESH':
                for v in child.data.vertices:
                    all_coords.append(child.matrix_world @ v.co)
        if not all_coords:
            continue
        z_min = min(c.z for c in all_coords)
        z_max = max(c.z for c in all_coords)
        x_min = min(c.x for c in all_coords)
        x_max = max(c.x for c in all_coords)
        y_min = min(c.y for c in all_coords)
        y_max = max(c.y for c in all_coords)
        name = obj.name

        # Check: object floating above floor (should be grounded)
        if "f_" not in name and z_min > FLOOR_Z + TOLERANCE:
            # Tabletop items are OK if their parent name contains desk/table/counter
            is_tabletop = any(k in name.lower() for k in ['mon', 'kb', 'ms', 'lamp', 'coffee', 'micro', 'toaster', 'blender', 'books', 'plant', 'splant', 'radio', 'speaker', 'spk'])
            if is_tabletop:
                print(f"  📎 {name:30s} z_min={z_min:.3f} (tabletop OK)")
            else:
                issues.append(f"🔴 FLOAT: {name} z_min={z_min:.3f} (expected ~{FLOOR_Z})")

        # Check: object outside boundary
        if x_max > BOUNDARY + 0.5 or x_min < -BOUNDARY - 0.5:
            issues.append(f"🔴 OOB-X: {name} x=[{x_min:.1f}, {x_max:.1f}]")
        if y_max > BOUNDARY + 0.5 or y_min < -BOUNDARY - 0.5:
            issues.append(f"🔴 OOB-Y: {name} y=[{y_min:.1f}, {y_max:.1f}]")

if issues:
    print(f"\n  ❌ {len(issues)} issues found:")
    for iss in issues:
        print(f"     {iss}")
else:
    print("\n  ✅ All objects grounded and within bounds!")
```

**⚠️ 关键**: 诊断代码应该放在渲染之后、GLB 导出之前。这样渲染产物不受影响，但能在控制台看到所有问题。

### 3. AI Scene Review — 严格审核 (Gate 8 必用)

```bash
# 基础审核
python3 scripts/blender/review-scene.py /tmp/office-build/stepN.png

# 严格模式 (评分标准上浮, 任何瑕疵都算 critical)
python3 scripts/blender/review-scene.py /tmp/office-build/stepN.png --strict

# 对比审核 (与上一版对比，检测改进/退步)
python3 scripts/blender/review-scene.py /tmp/office-build/stepN.png --reference /tmp/office-build/prev.png

# 指定模型
REVIEW_MODEL=claude-sonnet-4-6 python3 scripts/blender/review-scene.py /tmp/office-build/stepN.png
```

**环境变量**:
```bash
export LLM_PROXY_URL="http://67.230.182.59:8317"
export LLM_PROXY_KEY="your-key"
export REVIEW_MODEL="gpt-5.4"  # 可选: gpt-5.4 / claude-sonnet-4-6 / claude-opus-4-6
```

**审核维度** (4 项, 各 25%):
| 维度 | 检查内容 |
|------|---------|
| 结构完整性 | 外墙连续、角落闭合、隔断连续、地板完整 |
| 家具摆放 | 显示器贴桌面、椅子位置合理、不穿墙 |
| 区域识别度 | 5 区可区分、标志性家具/地毯、走廊有装饰 |
| 视觉质量 | 构图平衡、色彩丰富、密度适当、有故事感 |

**判定标准**:
| Verdict | 条件 | 后续动作 |
|---------|------|---------|
| ✅ PASS | score ≥ 8.0 且无 critical issues | 导出 GLB ✓ |
| ⚠️ NEEDS_FIX | score ≥ 6.0 或有 critical issues | 定位问题 → edit_file → 重验 |
| ❌ FAIL | score < 6.0 | 回退到出问题的 Gate 重做 |

**输出**: `{image}-review.json`，退出码: 0=PASS, 1=NEEDS_FIX, 2=FAIL。

---

## 修复循环 (NEEDS_FIX 时)

```
1. 读 review JSON → 提取 critical_issues 列表
2. 对每个 critical issue:
   a. 定位脚本中的相关代码段 (用 Grep 搜名称)
   b. edit_file 修改该段 (最小 diff)
   c. 渲染 → look_at 确认该 issue 已修复
   d. 诊断脚本确认数值正确
3. 全部 critical 修完后 → 重新跑 AI Review --strict --reference 上一版
4. 仍然 NEEDS_FIX → 重复; PASS → 导出 GLB
```

**⚠️ 每次修复只改一个问题，验证后再改下一个。不要批量修改。**

---

## imp() — 核心导入函数 (已验证正确)

所有 Kenney 模型的 origin 在 min corner (不在中心)。`imp()` 自动完成：
1. 导入 GLB
2. 计算所有 mesh 顶点的 XY 中心 + Z 底部
3. 创建 parent empty，偏移子物体使模型 XY 居中、Z 底部归零
4. 应用缩放、旋转、定位

```python
def imp(filename, pos=(0,0,0), rot_z=0, sc=None, name=None):
    """Import GLB, center XY, ground Z (bottom at z=0), place at pos."""
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        print(f"  ⚠️  Missing: {filename}")
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    new_objs = list(set(bpy.data.objects) - before)
    if not new_objs: return None
    coords = []
    for obj in new_objs:
        if obj.type == 'MESH':
            for v in obj.data.vertices:
                coords.append(obj.matrix_world @ v.co)
    if coords:
        cx = (min(c.x for c in coords) + max(c.x for c in coords)) / 2
        cy = (min(c.y for c in coords) + max(c.y for c in coords)) / 2
        cz_min = min(c.z for c in coords)  # ← 关键: Z 底部
    else:
        cx = cy = cz_min = 0
    parent = bpy.data.objects.new(name or filename.replace('.glb',''), None)
    bpy.context.collection.objects.link(parent)
    for obj in new_objs:
        obj.parent = parent
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= cz_min  # ← 关键: 模型底部贴地
    s = sc or S
    parent.scale = (s, s, s)
    parent.rotation_euler.z = rot_z
    parent.location = pos
    return parent
```

### top_z() — 获取物体顶部高度 (桌面物品必用)

```python
def top_z(obj):
    """Get the world-space top Z coordinate of obj + all children."""
    if obj is None:
        return 0
    coords = []
    for child in [obj] + list(obj.children_recursive):
        if child.type == 'MESH':
            for v in child.data.vertices:
                coords.append((child.matrix_world @ v.co).z)
    return max(coords) if coords else obj.location.z
```

**⚠️ 桌面物品的 Z 坐标必须用 `top_z(desk_obj) + 0.01` 而不是硬编码 `0.384 * S`**:
```python
desk = imp("desk.glb", pos=(cx, cy, 0), ...)
dh = top_z(desk) + 0.01  # ← 用实际桌面高度，不用常量
imp("computerScreen.glb", pos=(cx, cy, dh), ...)
```

---

## 常用建筑函数

### tile_floor — 铺地板

```python
def tile_floor(cx, cy, cols, rows):
    t = S
    x0 = cx - (cols * t) / 2 + t / 2
    y0 = cy - (rows * t) / 2 + t / 2
    for r in range(rows):
        for c in range(cols):
            imp("floorFull.glb", pos=(x0 + c*t, y0 + r*t, 0), name=f"f_{c}_{r}")
```

### wall_row — 砌墙 (支持窗/门)

```python
def wall_row(x0, y0, count, axis='x', windows=None, doors=None):
    windows = windows or set()
    doors = doors or set()
    t = S
    for i in range(count):
        if axis == 'x':
            p = (x0 + i * t, y0, 0); rot = 0
        else:
            p = (x0, y0 + i * t, 0); rot = math.pi / 2
        if i in doors:
            imp("wallDoorway.glb", pos=p, rot_z=rot, name=f"wd_{i}")
        elif i in windows:
            imp("wallWindow.glb", pos=p, rot_z=rot, name=f"ww_{i}")
        else:
            imp("wall.glb", pos=p, rot_z=rot, name=f"w_{i}")
```

### workstation — 完整工位 (使用 top_z)

```python
def workstation(cx, cy, facing=0, idx=0):
    desk = imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")
    dh = top_z(desk) + 0.01  # ← 用实际高度!

    # Chair: tight offset (0.45*S, not 0.55*S)
    co = 0.45 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")

    # Monitor: close to desk back edge
    mo = 0.18 * S
    imp("computerScreen.glb",
        pos=(cx + math.sin(facing)*mo, cy - math.cos(facing)*mo, dh),
        rot_z=facing + math.pi, name=f"ws{idx}_mon")

    # Keyboard + mouse on desk surface
    imp("computerKeyboard.glb", pos=(cx, cy, dh), rot_z=facing, name=f"ws{idx}_kb")
    mx = cx + math.cos(facing) * 0.15 * S
    my = cy + math.sin(facing) * 0.15 * S
    imp("computerMouse.glb", pos=(mx, my, dh), rot_z=facing, name=f"ws{idx}_ms")
    return desk
```

### partition_row — 内部隔断 (用 wall.glb, 不用 wallHalf)

```python
def partition_row(x0, y0, positions, axis='x', doorways=None):
    """Place partition walls using wall.glb (1.0 unit wide = fills S slot exactly).
    wallHalf was only 0.5 units wide causing gaps — NEVER use wallHalf for partitions.
    """
    doorways = doorways or set()
    for i in positions:
        pos_val = i * S
        if i in doorways:
            if axis == 'x':
                imp("wallDoorway.glb", pos=(pos_val, y0, 0), rot_z=0, name=f"pd_{axis}_{i}")
            else:
                imp("wallDoorway.glb", pos=(x0, pos_val, 0), rot_z=math.pi/2, name=f"pd_{axis}_{i}")
        else:
            if axis == 'x':
                imp("wall.glb", pos=(pos_val, y0, 0), rot_z=0, name=f"ph_{i}")
            else:
                imp("wall.glb", pos=(x0, pos_val, 0), rot_z=math.pi/2, name=f"pv_{i}")
```

---

## 办公室布局约束 (12×12 tile, 24m×24m)

```
地板范围: -12m ~ +12m (X/Y 两轴)
外墙位置: ±12m
内部隔断: x=0 和 y=0 轴线 (十字分隔)
4 象限: 每象限约 12×12m 可用空间

区域中心推荐坐标 (绝对米数, 不用 *S):
  Hub:    (0, 0)     — 中央十字交汇
  Forge:  (-6, -6)   — 左下 (开发工位区)
  Tower:  (-6, 6)    — 左上 (会议室)
  Court:  (6, 6)     — 右上 (评审室)
  Lounge: (6, -6)    — 右下 (茶歇区)

家具偏移上限: 区域中心 ± 4.5m (确保不超出 ±11m, 留墙厚余量)
```

### 区域特征参考 (增强识别度)

| 区域 | 必须有 | 推荐加 | 地毯 |
|------|--------|--------|------|
| Hub | 前台桌 + 接待椅 + 导视熊 | 低矮展示柜、门垫 | rugSquare 大型 |
| Forge | 6 工位 (3×2) + 书架 | 任务板(bookcaseClosedWide)、纸箱、落地灯 | rugRectangle 暖色 |
| Tower | 圆桌 + 6 椅 + 笔记本 | 演示电视、宽书架(白板替代)、盆栽 | rugRound 蓝色 |
| Court | 长桌 + 6 正式椅 + 大屏 | 观摩长椅、落地灯、书架 | rugSquare 正式 |
| Lounge | 双沙发对坐 + 咖啡桌 | 厨房角(咖啡机/冰箱)、吧凳、抱枕、收音机 | rugRounded 叠层 |

---

## 相机 & 渲染

```python
# 全景等距相机
bpy.ops.object.camera_add(location=(28, -28, 26))
cam = bpy.context.active_object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 36  # 全场景
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# 近景相机 (检查单区域, 以 Forge 为例)
# bpy.ops.object.camera_add(location=(-6+18, -6-18, 18))
# cam.data.ortho_scale = 18

# EEVEE 渲染
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 1000
```

---

## GLB 导出 (Blender 4.4)

```python
# 导出前删除相机和灯光 (Three.js 自己管)
for obj in list(bpy.data.objects):
    if obj.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath="webchat/public/observatory/office.glb",
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_materials='EXPORT',
    export_extras=True,
    # ⚠️ Blender 4.4 已移除: export_colors, export_draco_*
)
```

---

## 灯光模板

```python
# 主光 (暖色阳光)
bpy.ops.object.light_add(type='SUN', location=(8, 8, 15))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.data.color = (1.0, 0.97, 0.92)

# 补光 (冷色)
bpy.ops.object.light_add(type='SUN', location=(-8, -8, 12))
fill = bpy.context.active_object
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(70), 0, math.radians(150))
fill.data.color = (0.85, 0.82, 0.78)

# 区域重点灯 (每个功能区一盏)
bpy.ops.object.light_add(type='AREA', location=(zx, zy, 2.4))
al = bpy.context.active_object
al.data.energy = 60
al.data.size = 5
al.data.color = zone_color_tuple  # e.g. (1.0, 0.85, 0.6) for warm
```

---

## ⚠️ 已踩过的坑

| 坑 | 原因 | 正确做法 |
|----|------|---------|
| 物件浮空 | 没有 `z -= cz_min` | imp() 中已修复; 桌面物品用 `top_z(desk)+0.01` |
| 桌面物品浮空 | 用硬编码 `dh = 0.384*S` | **必须用 `top_z(desk_obj) + 0.01`** |
| 家具超出边界 | 区域中心离墙太近 | 偏移上限 ±4.5m, 诊断脚本检测越界 |
| Blender 4.4 导出报错 | 已移除参数 | 不用 `export_colors`、`export_draco_*` |
| 模型重叠 | 工位间距太小 | 工位间距 ≥ 3m (col) / 3m (row) |
| 隔断墙有缝隙 | `wallHalf` 仅 0.5 单位宽 | **隔断用 `wall.glb`**, 绝不用 `wallHalf` |
| 外墙窗户太多显断裂 | 12 段 8 窗 | 位置 0,3,6,9,11 用实墙, 窗 `{1,2,4,5,7,8,10}` |
| 外墙角件不对齐 | wallCorner 0.55×0.55 | imp() 居中, 放在 `(±H*S, ±H*S)` |
| 书架穿墙 | 靠墙物品坐标太大 | 偏移上限 ±4.5m, 外墙内侧留 0.5m |
| 一次性生成脚本失败 | 500行无验证 | **渐进式: edit_file → render → verify → next** |
| AI Review 后批量修改 | 改了 A 坏了 B | **每次只修一个 issue, 验证后改下一个** |

---

## Kenney 模型尺寸速查 (scale=1, 原点在 min corner)

| 模型 | 宽(X) × 深(Y) × 高(Z) | 缩放后高度 (S=2) |
|------|----------------------|-----------------|
| floorFull | 1.0 × 1.0 × 0.05 | 0.10m (薄片) |
| wall | 1.0 × 0.05 × 1.29 | 2.58m |
| wallHalf | 1.0 × 0.05 × 0.645 | 1.29m |
| wallCorner | 0.55 × 0.55 × 1.29 | L形角件 |
| desk | 0.73 × 0.39 × 0.384 | 0.77m |
| deskCorner | 0.625 × 0.625 × 0.384 | 0.77m |
| chairDesk | 0.34 × 0.31 × 0.61 | 1.22m |
| computerScreen | 0.39 × 0.10 × 0.29 | 0.58m |
| tableRound | 0.85 × 0.85 × 0.37 | 0.74m |
| table | 0.73 × 0.39 × 0.37 | 0.74m |
| sideTable | 0.31 × 0.31 × 0.38 | 0.76m |
| sideTableDrawers | 0.31 × 0.31 × 0.38 | 0.76m |

**缩放规则**: `S = 2.0` 使 Kenney 1 unit ≈ 2m 真实尺寸。

---

## 脚本模板 (新场景起点 — Gate 1)

只包含地板 + 外墙 + 角件 + 灯光 + 相机 + 渲染 + 诊断。后续 Gate 通过 `edit_file` 逐段追加。

```python
#!/usr/bin/env python3
"""Build office scene. Gate 1: Floor + outer walls + corners."""
import bpy, os, math

S = 2.0
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "webchat/public/observatory/office.glb")
os.makedirs(PREVIEW_DIR, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in bpy.data.meshes: bpy.data.meshes.remove(m)
for m in bpy.data.materials: bpy.data.materials.remove(m)

# ── imp() + top_z() + tile_floor() + wall_row() ──
# (copy from skill reference)

# ── GATE 1: Floor + Walls ──
tile_floor(0, 0, 12, 12)

H = 6
L = -H * S + S / 2
OUTER_WIN = {1,2,4,5,7,8,10}

wall_row(L, -H*S, 12, 'x', windows=OUTER_WIN)
wall_row(L, H*S, 12, 'x', windows=OUTER_WIN)
wall_row(-H*S, L, 12, 'y', windows=OUTER_WIN)
wall_row(H*S, L, 12, 'y', windows=OUTER_WIN - {5,6}, doors={5,6})

imp("wallCorner.glb", pos=(-H*S, -H*S, 0), rot_z=0, name="corner_sw")
imp("wallCorner.glb", pos=(H*S, -H*S, 0), rot_z=math.pi/2, name="corner_se")
imp("wallCorner.glb", pos=(-H*S, H*S, 0), rot_z=-math.pi/2, name="corner_nw")
imp("wallCorner.glb", pos=(H*S, H*S, 0), rot_z=math.pi, name="corner_ne")

# ── GATE 2+ content will be inserted HERE by edit_file ──
# === INSERTION POINT ===

# ── LIGHTING ──
bpy.ops.object.light_add(type='SUN', location=(8, 8, 15))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.data.color = (1.0, 0.97, 0.92)

bpy.ops.object.light_add(type='SUN', location=(-8, -8, 12))
fill = bpy.context.active_object
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(70), 0, math.radians(150))
fill.data.color = (0.85, 0.82, 0.78)

# ── CAMERA + RENDER ──
bpy.ops.object.camera_add(location=(28, -28, 26))
cam = bpy.context.active_object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 36
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 1000

out = os.path.join(PREVIEW_DIR, "gate1-walls.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")

# ── DIAGNOSTICS ──
# (copy diagnostic code block from skill reference)
```

后续 Gate 2 时用 `edit_file` 把隔断代码插入 `=== INSERTION POINT ===` 处:
```
edit_file(path="scripts/blender/build-office.py",
  old_str="# === INSERTION POINT ===",
  new_str="# ── GATE 2: Partitions ──\n...\n\n# === INSERTION POINT ===")
```

---

## Kenney 资产完整清单 (134 GLB)

```
# 地板 (4)
floorFull floorHalf floorCorner floorCornerRound

# 墙壁 (7)
wall wallHalf wallCorner wallCornerRond wallWindow wallWindowSlide wallDoorway wallDoorwayWide

# 门框 (3)
doorway doorwayFront doorwayOpen

# 桌椅 (12)
desk deskCorner table tableCloth tableCross tableCrossCloth tableGlass tableRound
chairDesk chair chairCushion chairRounded chairModernCushion chairModernFrameCushion

# 沙发 (7)
loungeSofa loungeSofaLong loungeSofaCorner loungeSofaOttoman
loungeChair loungeChairRelax loungeDesignChair loungeDesignSofa loungeDesignSofaCorner

# 茶几 (5)
tableCoffee tableCoffeeGlass tableCoffeeSquare tableCoffeeGlassSquare sideTable sideTableDrawers

# 电脑 (4)
computerScreen computerKeyboard computerMouse laptop

# 书架 (5)
bookcaseOpen bookcaseOpenLow bookcaseClosed bookcaseClosedDoors bookcaseClosedWide

# 厨房 (12)
kitchenBar kitchenBarEnd kitchenBlender kitchenCabinet kitchenCabinetCornerInner
kitchenCabinetCornerRound kitchenCabinetDrawer kitchenCabinetUpper
kitchenCabinetUpperCorner kitchenCabinetUpperDouble kitchenCabinetUpperLow
kitchenCoffeeMachine kitchenFridge kitchenFridgeBuiltIn kitchenFridgeLarge
kitchenFridgeSmall kitchenMicrowave kitchenSink kitchenStove kitchenStoveElectric

# 灯具 (6)
lampRoundFloor lampRoundTable lampSquareCeiling lampSquareFloor lampSquareTable lampWall

# 电视 (3)
televisionAntenna televisionModern televisionVintage

# 音响 (3)
speaker speakerSmall radio

# 植物 (4)
pottedPlant plantSmall1 plantSmall2 plantSmall3

# 地毯 (5)
rugRectangle rugRound rugRounded rugSquare rugDoormat

# 吧凳 (2)
stoolBar stoolBarSquare

# 长椅 (3)
bench benchCushion benchCushionLow

# 床 (3)
bedBunk bedDouble bedSingle

# 柜子 (5)
cabinetBed cabinetBedDrawer cabinetBedDrawerTable cabinetTelevision cabinetTelevisionDoors

# 装饰 (10)
bear books cardboardBoxClosed cardboardBoxOpen coatRack coatRackStanding
paneling pillow pillowBlue pillowBlueLong pillowLong toaster trashcan

# 楼梯 (4)
stairs stairsCorner stairsOpen stairsOpenSingle

# 卫浴 (8+)
bathroomCabinet bathroomCabinetDrawer bathroomMirror bathroomSink bathroomSinkSquare
bathtub shower showerRound toilet toiletSquare washer dryer washerDryerStacked

# 其他
ceilingFan hoodLarge hoodModern
```

---

## 已有构建脚本

| 脚本 | 用途 | 分数 |
|------|------|------|
| `scripts/blender/review-scene.py` | AI 审核 (vision LLM 严格评分) | — |
| `scripts/blender/test-step8-structure.py` | **当前最新**: 连续墙壁 + 区域识别 + 走廊装饰 | 6.8/10 NEEDS_FIX |
| `scripts/blender/test-step7-polish.py` | 密度/平衡优化 (wallHalf 缝隙问题) | — |
| `scripts/blender/test-step6-fix.py` | 对称隔断 + 墙壁对齐修复 | — |
| `scripts/blender/test-step4-full.py` | 早期完整构建 | 8/10 |
| `scripts/blender/test-step1-floor-desk.py` | 最小测试: 地板+桌子 | — |
| `scripts/blender/test-step2-room.py` | 围合房间+单工位 | — |
| `scripts/blender/test-step3-forge.py` | Forge 区 6 工位 | — |
