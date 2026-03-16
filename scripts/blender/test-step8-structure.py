#!/usr/bin/env python3
"""
Step 8: Structural fixes — continuous walls, proper partitions, zone identity.
Fixes:
  - wallHalf is 0.5 units wide (1m scaled), so place 2 per S gap to close seams
  - wallCorner is 0.55×0.55 — nudge to overlap wall row endpoints
  - Reduce outer wall windows (solid walls at corners + mid-sections)
  - Each zone gets a distinctive large rug + signature prop cluster
  - Monitor offset reduced for better desk alignment

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/test-step8-structure.py
"""
import bpy
import os
import math

S = 2.0
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "webchat/public/observatory/office.glb")
os.makedirs(PREVIEW_DIR, exist_ok=True)

SIDE_TABLE_TOP_Z = 0.38 * S
CEILING_Z = 1.29 * S - 0.05

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in bpy.data.meshes: bpy.data.meshes.remove(m)
for m in bpy.data.materials: bpy.data.materials.remove(m)


def imp(filename, pos=(0,0,0), rot_z=0, sc=None, name=None):
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
        cz_min = min(c.z for c in coords)
    else:
        cx = cy = cz_min = 0
    parent = bpy.data.objects.new(name or filename.replace('.glb',''), None)
    bpy.context.collection.objects.link(parent)
    for obj in new_objs:
        obj.parent = parent
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= cz_min
    s = sc or S
    parent.scale = (s, s, s)
    parent.rotation_euler.z = rot_z
    parent.location = pos
    return parent


def top_z(obj):
    if obj is None:
        return 0
    coords = []
    for child in [obj] + list(obj.children_recursive):
        if child.type == 'MESH':
            for v in child.data.vertices:
                coords.append((child.matrix_world @ v.co).z)
    return max(coords) if coords else obj.location.z


def tile_floor(cx, cy, cols, rows):
    t = S
    x0 = cx - (cols * t) / 2 + t / 2
    y0 = cy - (rows * t) / 2 + t / 2
    for r in range(rows):
        for c in range(cols):
            imp("floorFull.glb", pos=(x0 + c*t, y0 + r*t, 0), name=f"f_{c}_{r}")


def wall_row(x0, y0, count, axis='x', windows=None, doors=None):
    """Place count wall segments. Each is 1 Kenney unit (S meters) wide."""
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


def partition_row(x0, y0, positions, axis='x', doorways=None):
    """Place partition walls using full wall.glb (1.0 unit wide = fills S slot exactly).
    wallHalf was only 0.5 units wide causing gaps.
    Using wall.glb makes solid continuous partitions at full height.
    """
    doorways = doorways or set()
    for i in positions:
        pos_val = i * S
        if i in doorways:
            if axis == 'x':
                imp("wallDoorway.glb", pos=(pos_val, y0, 0), rot_z=0,
                    name=f"pd_{axis}_{i}")
            else:
                imp("wallDoorway.glb", pos=(x0, pos_val, 0), rot_z=math.pi/2,
                    name=f"pd_{axis}_{i}")
        else:
            if axis == 'x':
                imp("wall.glb", pos=(pos_val, y0, 0), rot_z=0,
                    name=f"ph_{i}")
            else:
                imp("wall.glb", pos=(x0, pos_val, 0), rot_z=math.pi/2,
                    name=f"pv_{i}")


def workstation(cx, cy, facing=0, idx=0):
    dh = 0.384 * S
    desk = imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")
    co = 0.55 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")
    # Monitor closer to desk center (was 0.25, now 0.18)
    mo = 0.18 * S
    imp("computerScreen.glb",
        pos=(cx + math.sin(facing)*mo, cy - math.cos(facing)*mo, dh),
        rot_z=facing + math.pi, name=f"ws{idx}_mon")
    imp("computerKeyboard.glb", pos=(cx, cy, dh), rot_z=facing, name=f"ws{idx}_kb")
    mx = cx + math.cos(facing) * 0.15 * S
    my = cy + math.sin(facing) * 0.15 * S
    imp("computerMouse.glb", pos=(mx, my, dh), rot_z=facing, name=f"ws{idx}_ms")
    return desk


# ══════════════════════════════════════════════════════════
print("\n" + "="*60)
print("  Step 8: Structural fixes + Zone identity")
print("="*60)

# ── FLOOR ─────────────────────────────────────────────────
print("\n📐 Floor...")
tile_floor(0, 0, 12, 12)

# ── OUTER WALLS ───────────────────────────────────────────
# FIX: Solid walls at positions 0 and 11 (next to corners), fewer windows
# Pattern: solid-win-win-solid-win-win-solid-win-win-solid-win-solid
# = solid at {0,3,6,9,11}, windows at {1,2,4,5,7,8,10}
print("\n🧱 Outer walls...")
H = 6
L = -H * S + S / 2  # = -11

OUTER_WIN = {1,2,4,5,7,8,10}  # solid at 0,3,6,9,11 (near corners + mid pillars)

# South wall (y = -12)
wall_row(L, -H*S, 12, 'x', windows=OUTER_WIN)
# North wall (y = +12)
wall_row(L, H*S, 12, 'x', windows=OUTER_WIN)
# West wall (x = -12)
wall_row(-H*S, L, 12, 'y', windows=OUTER_WIN)
# East wall (entrance) — doors at 5,6
wall_row(H*S, L, 12, 'y', windows=OUTER_WIN - {5,6}, doors={5,6})

# Corners: wallCorner is 0.55×0.55 raw (1.1×1.1 scaled)
# imp() centers it, so its center goes at the corner point.
# The L-shape extends 0.55m each way from center (scaled).
# This overlaps nicely with the wall row endpoints at ±12.
imp("wallCorner.glb", pos=(-H*S, -H*S, 0), rot_z=0, name="corner_sw")
imp("wallCorner.glb", pos=(H*S, -H*S, 0), rot_z=math.pi/2, name="corner_se")
imp("wallCorner.glb", pos=(-H*S, H*S, 0), rot_z=-math.pi/2, name="corner_nw")
imp("wallCorner.glb", pos=(H*S, H*S, 0), rot_z=math.pi, name="corner_ne")

# ── PARTITIONS ────────────────────────────────────────────
# FIX: wallHalf is 0.5 units wide → 2 per S gap for continuous partition
# Partition walls: [-5,-4,-3] and [3,4,5] on each axis
# Doorways at [-2, 2] (full-width wallDoorway = 1 unit, no double-up needed)
print("\n🚪 Partitions...")

# Horizontal partition (y=0 line)
partition_row(0, 0, [-5,-4,-3, 3,4,5], axis='x')
imp("wallDoorway.glb", pos=(-2*S, 0, 0), name="door_h_w")
imp("wallDoorway.glb", pos=(2*S, 0, 0), name="door_h_e")

# Vertical partition (x=0 line)
partition_row(0, 0, [-5,-4,-3, 3,4,5], axis='y')
imp("wallDoorway.glb", pos=(0, -2*S, 0), rot_z=math.pi/2, name="door_v_s")
imp("wallDoorway.glb", pos=(0, 2*S, 0), rot_z=math.pi/2, name="door_v_n")

# ── FORGE — 开发工位区 (−6, −6) ───────────────────────────
print("\n🔨 Forge (dev workspace)...")
fx, fy = -6, -6

# Signature: large warm-toned rectangle rug
imp("rugRectangle.glb", pos=(fx, fy, 0.01), sc=S*2.0, name="forge_rug")

for row in range(2):
    for col in range(3):
        idx = row * 3 + col
        wx = fx + (col - 1) * 3.2
        wy = fy + (row - 0.5) * 3.0
        face = 0 if row == 0 else math.pi
        workstation(wx, wy, facing=face, idx=idx)

# Props near zone edges (within ±4m of center)
imp("bookcaseOpen.glb", pos=(fx-3.5, fy-3.8, 0), name="forge_shelf")
imp("books.glb", pos=(fx-3.5, fy-3.8, 0.88*S), name="forge_books")
imp("coatRackStanding.glb", pos=(fx-3.8, fy+4.0, 0), name="forge_coat")
imp("trashcan.glb", pos=(fx+4.0, fy-3.8, 0), name="forge_trash")
imp("pottedPlant.glb", pos=(fx-3.8, fy-2, 0), name="forge_plant")
imp("lampRoundFloor.glb", pos=(fx+4.0, fy+4.0, 0), name="forge_flamp")
imp("plantSmall1.glb", pos=(fx-3.2, fy-1.5, 0.384*S), name="forge_dplant1")
imp("plantSmall3.glb", pos=(fx+3.2, fy+1.5, 0.384*S), name="forge_dplant2")
# Micro-detail: boxes
imp("cardboardBoxClosed.glb", pos=(fx-3.6, fy-4.6, 0), name="forge_box1")
imp("cardboardBoxOpen.glb", pos=(fx-4.2, fy-4.2, 0), name="forge_box2")
# Extra bookcase for dev reference
imp("bookcaseOpenLow.glb", pos=(fx+4.0, fy-2.0, 0), name="forge_lowshelf")

# ── TOWER — 会议室 (−6, 6) ────────────────────────────────
print("\n🏢 Tower (meeting room)...")
tx, ty = -6, 6

# Signature: large round rug (blue-toned in the asset)
imp("rugRound.glb", pos=(tx, ty, 0.01), sc=S*2.5, name="tower_rug")

tower_table = imp("tableRound.glb", pos=(tx, ty, 0), sc=S*1.8, name="tower_table")
for i in range(6):
    a = (2 * math.pi * i) / 6
    r = 3.2
    imp("chairModernCushion.glb",
        pos=(tx + math.cos(a)*r, ty + math.sin(a)*r, 0),
        rot_z=a + math.pi, name=f"tower_ch_{i}")

tt_z = top_z(tower_table) + 0.01 if tower_table else 0.37*S*1.8
for i in range(3):
    a = (2 * math.pi * i) / 3 + 0.3
    imp("laptop.glb",
        pos=(tx + math.cos(a)*1.4, ty + math.sin(a)*1.4, tt_z),
        rot_z=a + math.pi, name=f"tower_lap_{i}")
imp("lampRoundTable.glb", pos=(tx+0.5, ty+0.5, tt_z), name="tower_tlamp")
imp("speakerSmall.glb", pos=(tx-0.5, ty-0.5, tt_z), name="tower_speaker")

# Signature: wide bookcase as "whiteboard" against partition wall
imp("bookcaseClosedWide.glb", pos=(tx-3.2, ty+3.5, 0), sc=S*1.5, name="tower_board")
imp("pottedPlant.glb", pos=(tx+4.0, ty+3.8, 0), name="tower_p1")
imp("pottedPlant.glb", pos=(tx-3.8, ty-1, 0), name="tower_p2")
imp("coatRackStanding.glb", pos=(tx+4.0, ty-3.8, 0), name="tower_coat")
# TV/display for presentations
imp("televisionModern.glb", pos=(tx+4.0, ty+1.0, 1.0), sc=S*1.5, name="tower_tv")

# ── COURT — 评审室 (6, 6) ─────────────────────────────────
print("\n⚖️ Court (review room)...")
crx, cry = 6, 6

# Signature: square rug (formal/structured)
imp("rugSquare.glb", pos=(crx, cry, 0.01), sc=S*2.5, name="court_rug")

court_t1 = imp("table.glb", pos=(crx-1.2, cry, 0), sc=S*1.3, name="court_t1")
imp("table.glb", pos=(crx+1.2, cry, 0), sc=S*1.3, name="court_t2")

for i in range(3):
    ox = (i - 1) * 2.5
    imp("chairModernFrameCushion.glb", pos=(crx+ox, cry-2, 0), rot_z=0, name=f"court_cs_{i}")
    imp("chairModernFrameCushion.glb", pos=(crx+ox, cry+2, 0), rot_z=math.pi, name=f"court_cn_{i}")

# Presentation screen on wall
imp("computerScreen.glb", pos=(crx, cry+3.8, 1.2), sc=S*2, rot_z=math.pi, name="court_screen")

imp("bookcaseOpen.glb", pos=(crx+3.8, cry-4, 0), name="court_shelf")
imp("books.glb", pos=(crx+3.8, cry-4, 0.88*S), name="court_books")
imp("pottedPlant.glb", pos=(crx-4.0, cry+3.8, 0), name="court_plant")
imp("lampSquareFloor.glb", pos=(crx+3.8, cry+3.8, 0), name="court_lamp")
imp("trashcan.glb", pos=(crx+3.5, cry+2, 0), name="court_trash")
imp("benchCushion.glb", pos=(crx-4, cry-4, 0), name="court_bench")
# Extra: formal side table with speaker
imp("sideTable.glb", pos=(crx+3.8, cry+1.5, 0), name="court_stable")
imp("speaker.glb", pos=(crx+3.8, cry+1.5, SIDE_TABLE_TOP_Z), name="court_spk")

# ── LOUNGE — 茶歇区 (6, −6) ──────────────────────────────
print("\n☕ Lounge (break room)...")
lx, ly = 6, -6

# Signature: layered rugs (warm, cozy)
imp("rugRounded.glb", pos=(lx, ly, 0.005), sc=S*2.0, name="lg_rug_outer")
imp("rugRound.glb", pos=(lx, ly, 0.01), sc=S*1.5, name="lg_rug")

imp("loungeSofa.glb", pos=(lx-2, ly-1, 0), rot_z=math.pi/2, name="lg_sofa1")
imp("loungeSofa.glb", pos=(lx+2, ly-1, 0), rot_z=-math.pi/2, name="lg_sofa2")
imp("loungeChairRelax.glb", pos=(lx, ly+2, 0), rot_z=math.pi, name="lg_chair")
imp("tableCoffeeGlass.glb", pos=(lx, ly, 0), name="lg_ctable")

# Kitchen corner
lg_counter = imp("sideTableDrawers.glb", pos=(lx+3.8, ly+2, 0), name="lg_counter")
cnt_z = top_z(lg_counter) + 0.01 if lg_counter else SIDE_TABLE_TOP_Z
imp("kitchenCoffeeMachine.glb", pos=(lx+3.8, ly+2, cnt_z), name="lg_coffee")
imp("kitchenFridgeSmall.glb", pos=(lx+3.8, ly+4.0, 0), name="lg_fridge")
lg_counter2 = imp("sideTableDrawers.glb", pos=(lx+3.8, ly+3.2, 0), name="lg_counter2")
cnt2_z = top_z(lg_counter2) + 0.01 if lg_counter2 else SIDE_TABLE_TOP_Z
imp("kitchenMicrowave.glb", pos=(lx+3.8, ly+3.2, cnt2_z), name="lg_micro")
imp("toaster.glb", pos=(lx+3.4, ly+2, cnt_z), name="lg_toaster")
imp("kitchenBlender.glb", pos=(lx+3.4, ly+3.2, cnt2_z), name="lg_blender")

for i in range(3):
    imp("stoolBar.glb", pos=(lx+2.5, ly+1.5+i*1.2, 0),
        rot_z=-math.pi/2, name=f"lg_stool_{i}")

imp("pottedPlant.glb", pos=(lx-4, ly-3.8, 0), name="lg_plant1")
imp("pottedPlant.glb", pos=(lx+3.8, ly-3.8, 0), name="lg_plant2")
imp("lampRoundFloor.glb", pos=(lx-4.0, ly-3, 0), name="lg_floorlamp")
imp("pillow.glb", pos=(lx-1.5, ly-1, 0.35*S), name="lg_pillow1")
imp("pillowBlueLong.glb", pos=(lx+1.5, ly-1, 0.35*S), name="lg_pillow2")
imp("radio.glb", pos=(lx, ly+2, 0.38*S), name="lg_radio")
imp("rugDoormat.glb", pos=(lx+3.2, ly+3.0, 0.01), name="lg_kmat")
imp("plantSmall2.glb", pos=(lx+3.4, ly+1, cnt_z), name="lg_splant")
# Cozy extra: ottoman + design sofa corner piece
imp("loungeSofaOttoman.glb", pos=(lx-1.5, ly+1.5, 0), name="lg_ottoman")

# ── HUB — 大厅 (0, 0) ────────────────────────────────────
print("\n🏛 Hub (lobby)...")

# Signature: big layered rugs as the visual anchor
imp("rugRound.glb", pos=(0, -1.5, 0.005), sc=S*2.5, name="hub_rug_big")
imp("rugSquare.glb", pos=(0, 1.2, 0.01), sc=S*1.2, name="hub_deskrug")

# Reception desk
hub_desk = imp("deskCorner.glb", pos=(-0.8, 1.5, 0), name="hub_desk1")
imp("deskCorner.glb", pos=(0.8, 1.5, 0), rot_z=math.pi/2, name="hub_desk2")
hd_z = top_z(hub_desk) + 0.01 if hub_desk else SIDE_TABLE_TOP_Z
imp("computerScreen.glb", pos=(0, 2, hd_z), name="hub_mon")
imp("chairDesk.glb", pos=(0, 0.3, 0), rot_z=math.pi, name="hub_chair")

# Low display bookcase behind reception
imp("bookcaseOpenLow.glb", pos=(0, 3.0, 0), name="hub_shelf")
imp("books.glb", pos=(0, 3.0, 0.44*S), name="hub_shelf_books")

# Seating area
imp("loungeSofa.glb", pos=(-2.5, -2, 0), rot_z=math.pi/4, name="hub_sofa1")
imp("loungeSofa.glb", pos=(2.5, -2, 0), rot_z=-math.pi/4, name="hub_sofa2")
imp("tableCoffeeGlassSquare.glb", pos=(0, -2.5, 0), name="hub_ctable")

# Plants as zone gatepost markers (scaled up)
imp("pottedPlant.glb", pos=(-3.5, 3.5, 0), sc=S*1.3, name="hub_p1")
imp("pottedPlant.glb", pos=(3.5, 3.5, 0), sc=S*1.3, name="hub_p2")
imp("pottedPlant.glb", pos=(-3.0, -3.5, 0), name="hub_p3")
imp("pottedPlant.glb", pos=(3.0, -3.5, 0), name="hub_p4")

# Side tables
imp("sideTable.glb", pos=(-1.2, -3.5, 0), name="hub_stable1")
imp("sideTable.glb", pos=(1.2, -3.5, 0), name="hub_stable2")
imp("plantSmall1.glb", pos=(-1.2, -3.5, SIDE_TABLE_TOP_Z), name="hub_tplant")
imp("plantSmall2.glb", pos=(1.2, -3.5, SIDE_TABLE_TOP_Z), name="hub_tplant2")
imp("pillow.glb", pos=(-1.8, -2, 0.35*S), name="hub_pillow")

# Mascot + doormat at entrance
imp("bear.glb", pos=(2.4, 2.2, 0), name="hub_bear")
imp("rugDoormat.glb", pos=(0, -0.5, 0.01), name="hub_entrymat")

# ── CORRIDOR DECORATION ──────────────────────────────────
print("\n🌿 Corridors...")

# North corridor (between y=0 partition and y=12 outer wall)
imp("benchCushionLow.glb", pos=(0, 10.2, 0), rot_z=math.pi, name="corr_n_bench")
imp("pottedPlant.glb", pos=(-2.8, 10.2, 0), name="corr_n_p1")
imp("pottedPlant.glb", pos=(2.8, 10.2, 0), name="corr_n_p2")

# South corridor
imp("benchCushionLow.glb", pos=(0, -10.2, 0), name="corr_s_bench")
imp("pottedPlant.glb", pos=(-2.8, -10.2, 0), name="corr_s_p1")
imp("pottedPlant.glb", pos=(2.8, -10.2, 0), name="corr_s_p2")

# West corridor
imp("bench.glb", pos=(-10.2, 0, 0), rot_z=math.pi/2, name="corr_w_bench")
imp("pottedPlant.glb", pos=(-10.2, 3.0, 0), name="corr_w_p1")
imp("pottedPlant.glb", pos=(-10.2, -3.0, 0), name="corr_w_p2")

# East corridor (entrance side)
imp("coatRackStanding.glb", pos=(10.2, 4.5, 0), name="corr_e_coat1")
imp("coatRackStanding.glb", pos=(10.2, -4.5, 0), name="corr_e_coat2")
imp("pottedPlant.glb", pos=(10.2, 2.5, 0), name="corr_e_p1")
imp("pottedPlant.glb", pos=(10.2, -2.5, 0), name="corr_e_p2")
imp("rugDoormat.glb", pos=(10.2, 0, 0.01), sc=S*1.2, name="corr_e_mat")

# ── CEILING FANS ──────────────────────────────────────────
print("\n🌀 Ceiling fans...")
for (cfn, cfx, cfy) in [
    ("cf_hub", 0, 0),
    ("cf_forge", -6, -6),
    ("cf_tower", -6, 6),
    ("cf_court", 6, 6),
    ("cf_lounge", 6, -6),
]:
    imp("ceilingFan.glb", pos=(cfx, cfy, CEILING_Z), sc=S*0.85, name=cfn)

# ── LIGHTING ──────────────────────────────────────────────
print("\n💡 Lights...")

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

for (zn, zx, zy, zcol) in [
    ("hub", 0, 0, (0.9, 0.95, 1.0)),
    ("tower", -6, 6, (0.6, 0.7, 1.0)),
    ("forge", -6, -6, (1.0, 0.85, 0.6)),
    ("court", 6, 6, (0.5, 1.0, 0.65)),
    ("lounge", 6, -6, (1.0, 0.92, 0.75)),
]:
    bpy.ops.object.light_add(type='AREA', location=(zx, zy, 1.29*S - 0.1))
    al = bpy.context.active_object
    al.data.energy = 60
    al.data.size = 5
    al.data.color = zcol
    al.name = f"al_{zn}"

# Wall lamps on partition wall segments
for x in [-10, -8, 8, 10]:
    imp("lampWall.glb", pos=(x, 0.15, 0.9*S), rot_z=math.pi, sc=S*0.7, name=f"wl_h_{x}")
for y in [-10, -8, 8, 10]:
    imp("lampWall.glb", pos=(0.15, y, 0.9*S), rot_z=-math.pi/2, sc=S*0.7, name=f"wl_v_{y}")

# ── WORLD ──────────────────────────────────────────────────
world = bpy.data.worlds.new("Office")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.78, 0.82, 0.90, 1.0)
bg.inputs["Strength"].default_value = 0.2

# ── CAMERA ─────────────────────────────────────────────────
print("\n📷 Camera...")
bpy.ops.object.camera_add(location=(28, -28, 26))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 36
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── RENDER ─────────────────────────────────────────────────
print("\n🎨 Rendering...")
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1600
bpy.context.scene.render.resolution_y = 1000

out = os.path.join(PREVIEW_DIR, "step8-structure.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")

# ── EXPORT GLB ─────────────────────────────────────────────
print("\n📦 Export GLB...")
for obj in list(bpy.data.objects):
    if obj.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(obj, do_unlink=True)

os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)
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
