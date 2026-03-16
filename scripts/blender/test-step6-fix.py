#!/usr/bin/env python3
"""
Step 6: Fix — wall alignment, symmetric partitions, lamp cleanup, prop redistribution.
Based on step5 analysis. Fixes:
  P0: Wall start L = -H*S + S/2 (closes perimeter gaps)
  P0: Symmetric cross partitions (Hub reads as 5th zone)
  P1: Wall lamps only on real wall segments, smaller scale
  P1: Court screen sc=S*2 (was S*4, way too big)
  P2: Props redistributed toward outer walls
  P2: top_z() helper for surface-snapped tabletop items
  P3: Hub visual identity (bigger rug, tighter seating, plant gateposts)

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/test-step6-fix.py
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
    """Get the world-space top Z of an object (including children)."""
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
    dh = 0.384 * S
    desk = imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")
    co = 0.55 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")
    mo = 0.25 * S
    imp("computerScreen.glb",
        pos=(cx + math.sin(facing)*mo, cy - math.cos(facing)*mo, dh),
        rot_z=facing + math.pi, name=f"ws{idx}_mon")
    imp("computerKeyboard.glb", pos=(cx, cy, dh), rot_z=facing, name=f"ws{idx}_kb")
    mx = cx + math.cos(facing) * 0.2 * S
    my = cy + math.sin(facing) * 0.2 * S
    imp("computerMouse.glb", pos=(mx, my, dh), rot_z=facing, name=f"ws{idx}_ms")
    return desk


# ══════════════════════════════════════════════════════════
print("\n" + "="*60)
print("  Step 6: Fixed Office (5 zones)")
print("="*60)

# ── FLOOR (12x12 = 144 tiles) ────────────────────────────
print("\n📐 Floor...")
tile_floor(0, 0, 12, 12)

# ── OUTER WALLS (P0 FIX: L = -H*S + S/2) ─────────────────
print("\n🧱 Outer walls...")
H = 6
L = -H * S + S / 2   # = -11 (was -10, caused 2m gap)

# South wall (y = -12)
wall_row(L, -H*S, 12, 'x', windows={1,2,4,5,7,8,10,11})
# North wall (y = +12)
wall_row(L, H*S, 12, 'x', windows={1,2,4,5,7,8,10,11})
# West wall (x = -12)
wall_row(-H*S, L, 12, 'y', windows={1,2,4,5,7,8,10,11})
# East wall (entrance) with doors
wall_row(H*S, L, 12, 'y', windows={1,2,4,5,7,8,10,11}, doors={5,6})

# Wall corners (4 outer corners)
imp("wallCorner.glb", pos=(-H*S, -H*S, 0), rot_z=0, name="corner_sw")
imp("wallCorner.glb", pos=(H*S, -H*S, 0), rot_z=math.pi/2, name="corner_se")
imp("wallCorner.glb", pos=(-H*S, H*S, 0), rot_z=-math.pi/2, name="corner_nw")
imp("wallCorner.glb", pos=(H*S, H*S, 0), rot_z=math.pi, name="corner_ne")

# ── PARTITIONS (P0 FIX: symmetric cross) ─────────────────
print("\n🚪 Partitions...")
# Horizontal center line (y=0): symmetric half-walls + doorways
for i in [-5, -4, -3, 3, 4, 5]:
    imp("wallHalf.glb", pos=(i*S, 0, 0), name=f"ph_{i}")
imp("wallDoorway.glb", pos=(-2*S, 0, 0), name="door_h_w")
imp("wallDoorway.glb", pos=(2*S, 0, 0), name="door_h_e")

# Vertical center line (x=0): symmetric half-walls + doorways
for i in [-5, -4, -3, 3, 4, 5]:
    imp("wallHalf.glb", pos=(0, i*S, 0), rot_z=math.pi/2, name=f"pv_{i}")
imp("wallDoorway.glb", pos=(0, -2*S, 0), rot_z=math.pi/2, name="door_v_s")
imp("wallDoorway.glb", pos=(0, 2*S, 0), rot_z=math.pi/2, name="door_v_n")

# ── FORGE — 开发工位区 (center at −6, −6) ─────────────────
print("\n🔨 Forge...")
fx, fy = -6, -6

for row in range(2):
    for col in range(3):
        idx = row * 3 + col
        wx = fx + (col - 1) * 3.2
        wy = fy + (row - 0.5) * 3.0
        face = 0 if row == 0 else math.pi
        workstation(wx, wy, facing=face, idx=idx)

# P2: Props toward outer walls (west/south perimeter)
imp("bookcaseOpen.glb", pos=(fx-4.5, fy-4.5, 0), name="forge_shelf")
imp("books.glb", pos=(fx-4.5, fy-4.5, 0.88*S), name="forge_books")
imp("coatRackStanding.glb", pos=(fx-4.5, fy+4.5, 0), name="forge_coat")
imp("trashcan.glb", pos=(fx+4.5, fy-4.5, 0), name="forge_trash")
imp("pottedPlant.glb", pos=(fx-4.5, fy-2, 0), name="forge_plant")
imp("lampRoundFloor.glb", pos=(fx+4.5, fy+4.5, 0), name="forge_flamp")
imp("plantSmall1.glb", pos=(fx-3.2, fy-1.5, 0.384*S), name="forge_dplant1")
imp("plantSmall3.glb", pos=(fx+3.2, fy+1.5, 0.384*S), name="forge_dplant2")
imp("rugRectangle.glb", pos=(fx, fy, 0.01), sc=S*1.5, name="forge_rug")

# ── TOWER — 会议室 (top-left quadrant) ─────────────────────
print("\n🏢 Tower...")
tx, ty = -6, 6

tower_table = imp("tableRound.glb", pos=(tx, ty, 0), sc=S*1.8, name="tower_table")
for i in range(6):
    a = (2 * math.pi * i) / 6
    r = 3.2
    imp("chairModernCushion.glb",
        pos=(tx + math.cos(a)*r, ty + math.sin(a)*r, 0),
        rot_z=a + math.pi, name=f"tower_ch_{i}")

# Laptops on table — use top_z for accurate placement
tt_z = top_z(tower_table) + 0.01 if tower_table else 0.37*S*1.8
for i in range(3):
    a = (2 * math.pi * i) / 3 + 0.3
    imp("laptop.glb",
        pos=(tx + math.cos(a)*1.4, ty + math.sin(a)*1.4, tt_z),
        rot_z=a + math.pi, name=f"tower_lap_{i}")
imp("lampRoundTable.glb", pos=(tx+0.5, ty+0.5, tt_z), name="tower_tlamp")
imp("speakerSmall.glb", pos=(tx-0.5, ty-0.5, tt_z), name="tower_speaker")

# P2: Tall props toward north/west outer walls
imp("bookcaseClosedWide.glb", pos=(tx-4.5, ty+4.5, 0), sc=S*1.5, name="tower_board")
imp("pottedPlant.glb", pos=(tx+4.5, ty+4.5, 0), name="tower_p1")
imp("pottedPlant.glb", pos=(tx-4.5, ty-1, 0), name="tower_p2")
imp("coatRackStanding.glb", pos=(tx+4.5, ty-4.5, 0), name="tower_coat")
imp("rugRound.glb", pos=(tx, ty, 0.01), sc=S*2.0, name="tower_rug")

# ── COURT — 评审室 (top-right quadrant) ────────────────────
print("\n⚖️ Court...")
crx, cry = 6, 6

court_t1 = imp("table.glb", pos=(crx-1.2, cry, 0), sc=S*1.3, name="court_t1")
imp("table.glb", pos=(crx+1.2, cry, 0), sc=S*1.3, name="court_t2")

for i in range(3):
    ox = (i - 1) * 2.5
    imp("chairModernFrameCushion.glb", pos=(crx+ox, cry-2, 0), rot_z=0, name=f"court_cs_{i}")
    imp("chairModernFrameCushion.glb", pos=(crx+ox, cry+2, 0), rot_z=math.pi, name=f"court_cn_{i}")

# P1 FIX: Screen sc=S*2 (was S*4), mounted tight to north wall
imp("computerScreen.glb", pos=(crx, cry+4.5, 1.2), sc=S*2, rot_z=math.pi, name="court_screen")

# P2: Props toward east outer wall
imp("bookcaseOpen.glb", pos=(crx+4.5, cry-4, 0), name="court_shelf")
imp("books.glb", pos=(crx+4.5, cry-4, 0.88*S), name="court_books")
imp("pottedPlant.glb", pos=(crx-4.5, cry+4.5, 0), name="court_plant")
imp("lampSquareFloor.glb", pos=(crx+4.5, cry+4.5, 0), name="court_lamp")
imp("trashcan.glb", pos=(crx+4.5, cry+2, 0), name="court_trash")
imp("rugRectangle.glb", pos=(crx, cry, 0.01), sc=S*1.3, name="court_rug")
imp("benchCushion.glb", pos=(crx-4, cry-4, 0), name="court_bench")

# ── LOUNGE — 茶歇区 (bottom-right quadrant) ────────────────
print("\n☕ Lounge...")
lx, ly = 6, -6

imp("loungeSofa.glb", pos=(lx-2, ly-1, 0), rot_z=math.pi/2, name="lg_sofa1")
imp("loungeSofa.glb", pos=(lx+2, ly-1, 0), rot_z=-math.pi/2, name="lg_sofa2")
imp("loungeChairRelax.glb", pos=(lx, ly+2, 0), rot_z=math.pi, name="lg_chair")
imp("tableCoffeeGlass.glb", pos=(lx, ly, 0), name="lg_ctable")
imp("rugRectangle.glb", pos=(lx, ly, 0.01), sc=S*1.2, name="lg_rug")

# Kitchen corner
lg_counter = imp("sideTableDrawers.glb", pos=(lx+4.5, ly+2, 0), name="lg_counter")
cnt_z = top_z(lg_counter) + 0.01 if lg_counter else 0.38*S
imp("kitchenCoffeeMachine.glb", pos=(lx+4.5, ly+2, cnt_z), name="lg_coffee")
imp("kitchenFridgeSmall.glb", pos=(lx+4.5, ly+4.5, 0), name="lg_fridge")
lg_counter2 = imp("sideTableDrawers.glb", pos=(lx+4.5, ly+3.2, 0), name="lg_counter2")
cnt2_z = top_z(lg_counter2) + 0.01 if lg_counter2 else 0.38*S
imp("kitchenMicrowave.glb", pos=(lx+4.5, ly+3.2, cnt2_z), name="lg_micro")

for i in range(3):
    imp("stoolBar.glb", pos=(lx+3, ly+1.5+i*1.2, 0),
        rot_z=-math.pi/2, name=f"lg_stool_{i}")

# P2: Perimeter decoration
imp("pottedPlant.glb", pos=(lx-4, ly-4.5, 0), name="lg_plant1")
imp("pottedPlant.glb", pos=(lx+4.5, ly-4.5, 0), name="lg_plant2")
imp("lampRoundFloor.glb", pos=(lx-4.5, ly-3, 0), name="lg_floorlamp")
imp("pillow.glb", pos=(lx-1.5, ly-1, 0.35*S), name="lg_pillow1")
imp("pillowBlueLong.glb", pos=(lx+1.5, ly-1, 0.35*S), name="lg_pillow2")
imp("radio.glb", pos=(lx, ly+2, 0.38*S), name="lg_radio")
imp("rugRound.glb", pos=(lx+3.5, ly+3, 0.01), sc=S*0.8, name="lg_krug")
imp("plantSmall2.glb", pos=(lx+4.5, ly+1, cnt_z), name="lg_splant")

# ── HUB — 大厅 (0, 0) (P3: enhanced identity) ────────────
print("\n🏛 Hub...")

# Reception desk (tighter)
hub_desk = imp("deskCorner.glb", pos=(-0.8, 1.5, 0), name="hub_desk1")
imp("deskCorner.glb", pos=(0.8, 1.5, 0), rot_z=math.pi/2, name="hub_desk2")
hd_z = top_z(hub_desk) + 0.01 if hub_desk else 0.38*S
imp("computerScreen.glb", pos=(0, 2, hd_z), name="hub_mon")
imp("chairDesk.glb", pos=(0, 0.3, 0), rot_z=math.pi, name="hub_chair")

# Seating area (pulled tighter to center)
imp("loungeSofa.glb", pos=(-2.5, -2, 0), rot_z=math.pi/4, name="hub_sofa1")
imp("loungeSofa.glb", pos=(2.5, -2, 0), rot_z=-math.pi/4, name="hub_sofa2")
imp("tableCoffeeGlassSquare.glb", pos=(0, -2.5, 0), name="hub_ctable")

# P3: Bigger rug + desk rug for visual anchor
imp("rugRound.glb", pos=(0, -2, 0.01), sc=S*1.8, name="hub_rug")
imp("rugSquare.glb", pos=(0, 1.2, 0.01), sc=S*1.0, name="hub_deskrug")

# P3: Plant gateposts framing the Hub from north
imp("pottedPlant.glb", pos=(-3.5, 3.5, 0), sc=S*1.3, name="hub_p1")
imp("pottedPlant.glb", pos=(3.5, 3.5, 0), sc=S*1.3, name="hub_p2")

# Side tables flanking sofa area
imp("sideTable.glb", pos=(-1.2, -3.5, 0), name="hub_stable1")
imp("sideTable.glb", pos=(1.2, -3.5, 0), name="hub_stable2")
st_z = top_z(imp("sideTable.glb", pos=(0,0,0), name="_tmp"))
# Clean up temp object
if bpy.data.objects.get("_tmp"):
    bpy.data.objects.remove(bpy.data.objects["_tmp"], do_unlink=True)
imp("plantSmall1.glb", pos=(-1.2, -3.5, 0.38*S), name="hub_tplant")
imp("pillow.glb", pos=(-1.8, -2, 0.35*S), name="hub_pillow")

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

# Zone accent lights
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

# P1 FIX: Wall lamps only on actual wall segments, reduced scale
# Horizontal partition walls exist at i = -5,-4,-3, 3,4,5 → x = -10,-8,-6, 6,8,10
for x in [-10, -8, 8, 10]:
    imp("lampWall.glb", pos=(x, 0.15, 0.9*S), rot_z=math.pi, sc=S*0.7, name=f"wl_h_{x}")
# Vertical partition walls exist at i = -5,-4,-3, 3,4,5 → y = -10,-8,-6, 6,8,10
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

out = os.path.join(PREVIEW_DIR, "step6-fix.png")
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
