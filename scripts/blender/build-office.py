#!/usr/bin/env python3
"""
Build Agent Observatory Office Scene (v2 — fixed scale & placement).

Layout: ~24m x 24m office (12x12 floor grid @2m tiles).
5 zones tightly packed, connected by short corridors.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/build-office.py
"""
import bpy
import os
import math

# ── Config ────────────────────────────────────────────────
S = 2.0  # scale: Kenney 1 unit → 2m real
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "webchat/public/observatory/office.glb")
PREVIEW_DIR = "/tmp/office-build"
os.makedirs(PREVIEW_DIR, exist_ok=True)

# ── Clean ──────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in bpy.data.meshes: bpy.data.meshes.remove(m)
for m in bpy.data.materials: bpy.data.materials.remove(m)

# ── Import helper (origin-centered) ───────────────────────
def imp(filename, pos=(0,0,0), rot_z=0, sc=None, name=None):
    """Import GLB centered at pos with correct scale."""
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        return None

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    new_objs = list(set(bpy.data.objects) - before)
    if not new_objs:
        return None

    # Find footprint center and Z-bottom from all mesh vertices
    coords = []
    for obj in new_objs:
        if obj.type == 'MESH':
            for v in obj.data.vertices:
                co = obj.matrix_world @ v.co
                coords.append(co)

    if coords:
        cx = (min(c.x for c in coords) + max(c.x for c in coords)) / 2
        cy = (min(c.y for c in coords) + max(c.y for c in coords)) / 2
        cz_min = min(c.z for c in coords)
    else:
        cx = cy = cz_min = 0

    parent = bpy.data.objects.new(name or filename.replace('.glb',''), None)
    bpy.context.collection.objects.link(parent)

    for obj in new_objs:
        obj.parent = parent
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= cz_min  # ground the model bottom at z=0

    s = sc or S
    parent.scale = (s, s, s)
    parent.rotation_euler.z = rot_z
    parent.location = pos
    return parent


def tile_floor(cx, cy, cols, rows):
    """Grid of floor tiles centered at (cx, cy)."""
    t = S  # tile size after scale
    x0 = cx - (cols * t) / 2 + t / 2
    y0 = cy - (rows * t) / 2 + t / 2
    for r in range(rows):
        for c in range(cols):
            imp("floorFull.glb", pos=(x0 + c*t, y0 + r*t, 0), name=f"f_{c}_{r}")


def wall_row(x0, y0, count, axis='x', windows=None, doors=None):
    """Place wall segments. windows/doors = set of indices."""
    windows = windows or set()
    doors = doors or set()
    t = S
    for i in range(count):
        if axis == 'x':
            p = (x0 + i * t, y0, 0)
            rot = 0
        else:
            p = (x0, y0 + i * t, 0)
            rot = math.pi / 2
        if i in doors:
            imp("wallDoorway.glb", pos=p, rot_z=rot, name=f"wd_{x0:.0f}_{y0:.0f}_{i}")
        elif i in windows:
            imp("wallWindow.glb", pos=p, rot_z=rot, name=f"ww_{x0:.0f}_{y0:.0f}_{i}")
        else:
            imp("wall.glb", pos=p, rot_z=rot, name=f"w_{x0:.0f}_{y0:.0f}_{i}")


def workstation(cx, cy, facing=0, idx=0):
    """Desk + chair + monitor + keyboard + mouse, facing = rotation."""
    dh = 0.384 * S  # desk top Z
    imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")

    # Chair offset (in front of desk, opposite to facing)
    co = 0.55 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")

    # Monitor (back of desk)
    mo = 0.25 * S
    imp("computerScreen.glb",
        pos=(cx + math.sin(facing)*mo, cy - math.cos(facing)*mo, dh),
        rot_z=facing + math.pi, name=f"ws{idx}_mon")

    # Keyboard + mouse
    imp("computerKeyboard.glb", pos=(cx, cy, dh), rot_z=facing, name=f"ws{idx}_kb")
    mx = cx + math.cos(facing) * 0.2 * S
    my = cy + math.sin(facing) * 0.2 * S
    imp("computerMouse.glb", pos=(mx, my, dh), rot_z=facing, name=f"ws{idx}_ms")


# ══════════════════════════════════════════════════════════
#  LAYOUT — compact 24m x 24m office
# ══════════════════════════════════════════════════════════
#
#  ┌─────────────┬─────────────┐
#  │  TOWER      │  COURT      │
#  │  会议室     │  评审室     │
#  │ (-5, 5)     │ (5, 5)      │
#  ├──── HUB 大厅 (0,0) ──────┤
#  │  FORGE      │  LOUNGE     │
#  │  开发区     │  茶歇区     │
#  │ (-5, -5)    │ (5, -5)     │
#  └─────────────┴─────────────┘
#
# Each zone ~10x10m = 5x5 tiles. Total ~24x24m = 12x12 tiles.

print("\n" + "="*60)
print("  Building Office Scene v2")
print("="*60)

# ── FLOOR ──────────────────────────────────────────────────
print("\n📐 Floor (12x12 = 144 tiles)...")
tile_floor(0, 0, 12, 12)

# ── OUTER WALLS ────────────────────────────────────────────
print("\n🧱 Outer walls...")
H = 12  # half-grid in tiles
L = -H * S + S  # left/bottom wall start x or y

# South wall (y = −12)
wall_row(L, -H*S, 12, 'x', windows={1,2,4,5,7,8,10,11})
# North wall (y = +12)
wall_row(L, H*S, 12, 'x', windows={1,2,4,5,7,8,10,11})
# West wall
wall_row(-H*S, L, 12, 'y', windows={1,2,4,5,7,8,10,11})
# East wall (entrance)
wall_row(H*S, L, 12, 'y', windows={1,2,4,5,7,8,10,11}, doors={5,6})

# ── INTERNAL PARTITIONS ────────────────────────────────────
print("\n🚪 Partitions...")
# Horizontal center line (y=0): half-walls with gaps
for i in [-5, -4, -3, 3, 4, 5]:
    imp("wallHalf.glb", pos=(i*S, 0, 0), name=f"ph_{i}")
# Doorways at hub entrances
imp("doorwayOpen.glb", pos=(-1*S, 0, 0), name="door_hub_w")
imp("doorwayOpen.glb", pos=(1*S, 0, 0), name="door_hub_e")

# Vertical center line (x=0): half-walls with gaps
for i in [-5, -4, 3, 4, 5]:
    imp("wallHalf.glb", pos=(0, i*S, 0), rot_z=math.pi/2, name=f"pv_{i}")
imp("doorwayOpen.glb", pos=(0, -2*S, 0), rot_z=math.pi/2, name="door_hub_s")
imp("doorwayOpen.glb", pos=(0, 2*S, 0), rot_z=math.pi/2, name="door_hub_n")

# ── FORGE — 开发工位区 (−5, −5) ───────────────────────────
print("\n🔨 Forge...")
fx, fy = -5*S, -5*S

# 6 workstations: 2 rows x 3, face-to-face (wider spacing)
for row in range(2):
    for col in range(3):
        idx = row * 3 + col
        wx = fx + (col - 1) * 3.0 * S
        wy = fy + (row - 0.5) * 2.5 * S
        face = 0 if row == 0 else math.pi
        workstation(wx, wy, facing=face, idx=idx)

# Decoration
imp("bookcaseOpen.glb", pos=(fx+5*S, fy-3*S, 0), name="forge_shelf1")
imp("books.glb", pos=(fx+5*S, fy-3*S, 0.88*S), name="forge_books")
imp("pottedPlant.glb", pos=(fx-4*S, fy+4*S, 0), name="forge_plant")
imp("lampRoundFloor.glb", pos=(fx+5*S, fy+4*S, 0), name="forge_flamp")
imp("plantSmall2.glb", pos=(fx+2*S, fy-4*S, 0), name="forge_plant2")

# ── TOWER — 会议室 (−5, 5) ────────────────────────────────
print("\n🏢 Tower...")
tx, ty = -5*S, 5*S

imp("tableRound.glb", pos=(tx, ty, 0), sc=S*1.8, name="tower_table")
for i in range(6):
    a = (2 * math.pi * i) / 6
    r = 1.8 * S
    imp("chairModernCushion.glb",
        pos=(tx + math.cos(a)*r, ty + math.sin(a)*r, 0),
        rot_z=a + math.pi, name=f"tower_ch_{i}")

# Laptops on table
for i in range(3):
    a = (2 * math.pi * i) / 3 + 0.3
    imp("laptop.glb", pos=(tx + math.cos(a)*0.8*S, ty + math.sin(a)*0.8*S, 0.37*S*1.8),
        rot_z=a + math.pi, name=f"tower_lap_{i}")

imp("bookcaseClosedWide.glb", pos=(tx, ty+4*S, 0), sc=S*1.5, name="tower_board")
imp("pottedPlant.glb", pos=(tx-4*S, ty+4*S, 0), name="tower_p1")
imp("pottedPlant.glb", pos=(tx+4*S, ty+4*S, 0), name="tower_p2")

# ── COURT — 评审室 (5, 5) ─────────────────────────────────
print("\n⚖️ Court...")
cx, cy = 5*S, 5*S

# Two tables merged into long table
imp("table.glb", pos=(cx-0.8*S, cy, 0), sc=S*1.3, name="court_t1")
imp("table.glb", pos=(cx+0.8*S, cy, 0), sc=S*1.3, name="court_t2")

# Chairs 3 per side
for i in range(3):
    ox = (i - 1) * 1.5 * S
    imp("chairModernFrameCushion.glb", pos=(cx+ox, cy-1.2*S, 0), rot_z=0, name=f"court_cs_{i}")
    imp("chairModernFrameCushion.glb", pos=(cx+ox, cy+1.2*S, 0), rot_z=math.pi, name=f"court_cn_{i}")

# Presentation screen
imp("computerScreen.glb", pos=(cx, cy+4*S, 1.2), sc=S*4, rot_z=math.pi, name="court_screen")

imp("bookcaseOpen.glb", pos=(cx+4*S, cy-3*S, 0), name="court_shelf")
imp("books.glb", pos=(cx+4*S, cy-3*S, 0.88*S), name="court_books")
imp("pottedPlant.glb", pos=(cx-4*S, cy+4*S, 0), name="court_plant")

# ── LOUNGE — 茶歇区 (5, −5) ───────────────────────────────
print("\n☕ Lounge...")
lx, ly = 5*S, -5*S

# Sofa arrangement
imp("loungeSofa.glb", pos=(lx-1.5*S, ly-1*S, 0), rot_z=math.pi/2, name="lg_sofa1")
imp("loungeSofa.glb", pos=(lx+1.5*S, ly-1*S, 0), rot_z=-math.pi/2, name="lg_sofa2")
imp("loungeChairRelax.glb", pos=(lx, ly+1.5*S, 0), rot_z=math.pi, name="lg_chair")
imp("tableCoffeeGlass.glb", pos=(lx, ly, 0), name="lg_ctable")
imp("rugRectangle.glb", pos=(lx, ly, 0.01), sc=S*1.2, name="lg_rug")

# Kitchen corner
imp("sideTableDrawers.glb", pos=(lx+4*S, ly+2*S, 0), name="lg_counter")
imp("kitchenCoffeeMachine.glb", pos=(lx+4*S, ly+2*S, 0.38*S), name="lg_coffee")
imp("kitchenFridgeSmall.glb", pos=(lx+4*S, ly+4*S, 0), name="lg_fridge")
imp("kitchenMicrowave.glb", pos=(lx+4*S, ly+3*S, 0.38*S), name="lg_micro")
imp("sideTableDrawers.glb", pos=(lx+4*S, ly+3*S, 0), name="lg_counter2")

for i in range(3):
    imp("stoolBar.glb", pos=(lx+2.5*S, ly+1.5*S+i*0.9*S, 0),
        rot_z=-math.pi/2, name=f"lg_stool_{i}")

imp("pottedPlant.glb", pos=(lx-3*S, ly+4*S, 0), name="lg_plant1")
imp("pottedPlant.glb", pos=(lx+4*S, ly-4*S, 0), name="lg_plant2")
imp("lampRoundFloor.glb", pos=(lx-3*S, ly-3*S, 0), name="lg_floorlamp")

# ── HUB — 大厅 (0, 0) ─────────────────────────────────────
print("\n🏛 Hub...")

imp("deskCorner.glb", pos=(-0.5*S, 1*S, 0), name="hub_desk1")
imp("deskCorner.glb", pos=(0.5*S, 1*S, 0), rot_z=math.pi/2, name="hub_desk2")
imp("computerScreen.glb", pos=(0, 1.3*S, 0.38*S), name="hub_mon")
imp("chairDesk.glb", pos=(0, 0.2*S, 0), rot_z=math.pi, name="hub_chair")

imp("loungeSofa.glb", pos=(-2*S, -2*S, 0), rot_z=math.pi/4, name="hub_sofa1")
imp("loungeSofa.glb", pos=(2*S, -2*S, 0), rot_z=-math.pi/4, name="hub_sofa2")
imp("tableCoffeeGlassSquare.glb", pos=(0, -2.2*S, 0), name="hub_ctable")
imp("rugRound.glb", pos=(0, -2*S, 0.01), sc=S*1.5, name="hub_rug")

imp("pottedPlant.glb", pos=(-3*S, 3*S, 0), sc=S*1.2, name="hub_p1")
imp("pottedPlant.glb", pos=(3*S, 3*S, 0), sc=S*1.2, name="hub_p2")
imp("lampSquareFloor.glb", pos=(-3*S, -1*S, 0), name="hub_lamp1")
imp("lampSquareFloor.glb", pos=(3*S, -1*S, 0), name="hub_lamp2")

# ── WALL LAMPS (no ceiling in isometric view) ─────────────
print("\n💡 Lights...")
wall_h = 1.29 * S  # 2.58m

# Wall lamps on partition walls instead of floating ceiling lamps
for i in range(-4, 5, 2):
    imp("lampWall.glb", pos=(i*S, 0.15, 0.9*S), rot_z=math.pi, name=f"wl_h_{i}")
    imp("lampWall.glb", pos=(0.15, i*S, 0.9*S), rot_z=-math.pi/2, name=f"wl_v_{i}")

# Actual render lights
bpy.ops.object.light_add(type='SUN', location=(8, 8, 15))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.data.color = (1.0, 0.97, 0.92)
sun.name = "Sun"

bpy.ops.object.light_add(type='SUN', location=(-8, -8, 12))
fill = bpy.context.active_object
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(70), 0, math.radians(150))
fill.data.color = (0.85, 0.82, 0.78)
fill.name = "Fill"

# Zone accent area lights
for (zn, zx, zy, zcol) in [
    ("hub", 0, 0, (0.9, 0.95, 1.0)),
    ("tower", -5*S, 5*S, (0.6, 0.7, 1.0)),
    ("forge", -5*S, -5*S, (1.0, 0.85, 0.6)),
    ("court", 5*S, 5*S, (0.5, 1.0, 0.65)),
    ("lounge", 5*S, -5*S, (1.0, 0.92, 0.75)),
]:
    bpy.ops.object.light_add(type='AREA', location=(zx, zy, wall_h - 0.1))
    al = bpy.context.active_object
    al.data.energy = 60
    al.data.size = 5
    al.data.color = zcol
    al.name = f"al_{zn}"

# ── WORLD ──────────────────────────────────────────────────
world = bpy.data.worlds.new("Office")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.78, 0.82, 0.90, 1.0)
bg.inputs["Strength"].default_value = 0.2

# ── CAMERA ─────────────────────────────────────────────────
print("\n📷 Camera...")
bpy.ops.object.camera_add(location=(22, -22, 20))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 30
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── RENDER ─────────────────────────────────────────────────
print("\n🎨 Rendering...")
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 1000

bpy.context.scene.render.filepath = os.path.join(PREVIEW_DIR, "office-v2.png")
bpy.ops.render.render(write_still=True)
print(f"  ✅ {PREVIEW_DIR}/office-v2.png")

# ── EXPORT GLB ─────────────────────────────────────────────
print("\n📦 Export...")
for obj in list(bpy.data.objects):
    if obj.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath=OUTPUT_GLB,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_materials='EXPORT',
    export_extras=True,
)
kb = os.path.getsize(OUTPUT_GLB) / 1024
print(f"  ✅ {OUTPUT_GLB} ({kb:.1f} KB)")
print(f"\n🎉 Done!")
