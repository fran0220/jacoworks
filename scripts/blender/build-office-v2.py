#!/usr/bin/env python3
"""Build office scene — incremental gates. Gate 1: Floor + outer walls + corners."""
import bpy, os, math

S = 2.0
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "webchat/public/observatory/office.glb")
os.makedirs(PREVIEW_DIR, exist_ok=True)

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


def workstation(cx, cy, facing=0, idx=0):
    desk = imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")
    dh = top_z(desk) + 0.01
    co = 0.45 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")
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
print("  Office Build — Gate 1: Floor + Outer Walls + Corners")
print("="*60)

# ── GATE 1: Floor ─────────────────────────────────────────
print("\n📐 Floor...")
tile_floor(0, 0, 12, 12)

# ── GATE 1: Outer Walls ──────────────────────────────────
print("\n🧱 Outer walls...")
H = 6
L = -H * S + S / 2

OUTER_WIN = {1,2,4,5,7,8,10}

wall_row(L, -H*S, 12, 'x', windows=OUTER_WIN)
wall_row(L, H*S, 12, 'x', windows=OUTER_WIN)
wall_row(-H*S, L, 12, 'y', windows=OUTER_WIN)
wall_row(H*S, L, 12, 'y', windows=OUTER_WIN - {5,6}, doors={5,6})

# Entrance door frames (east wall doors at positions 5,6) — makes openings look intentional
imp("doorwayFront.glb", pos=(H*S, L + 5*S, 0), rot_z=math.pi/2, name="entrance_door1")
imp("doorwayFront.glb", pos=(H*S, L + 6*S, 0), rot_z=math.pi/2, name="entrance_door2")

# ── GATE 1: Corners ──────────────────────────────────────
print("\n🔲 Corners...")
imp("wallCorner.glb", pos=(-H*S, -H*S, 0), rot_z=0, name="corner_sw")
imp("wallCorner.glb", pos=(H*S, -H*S, 0), rot_z=math.pi/2, name="corner_se")
imp("wallCorner.glb", pos=(-H*S, H*S, 0), rot_z=-math.pi/2, name="corner_nw")
imp("wallCorner.glb", pos=(H*S, H*S, 0), rot_z=math.pi, name="corner_ne")

# ── GATE 2: Partitions ─────────────────────────────────────
print("\n🚪 Partitions...")

# Horizontal partition (y=0 line): walls at [-5,-4,-3, 3,4,5], doors at -2 and 2
partition_row(0, 0, [-5,-4,-3, 3,4,5], axis='x')
imp("wallDoorway.glb", pos=(-2*S, 0, 0), name="door_h_w")
imp("wallDoorway.glb", pos=(2*S, 0, 0), name="door_h_e")

# Vertical partition (x=0 line): walls at [-5,-4,-3, 3,4,5], doors at -2 and 2
partition_row(0, 0, [-5,-4,-3, 3,4,5], axis='y')
imp("wallDoorway.glb", pos=(0, -2*S, 0), rot_z=math.pi/2, name="door_v_s")
imp("wallDoorway.glb", pos=(0, 2*S, 0), rot_z=math.pi/2, name="door_v_n")

# ── GATE 3: Forge — 开发工位区 (−6, −6) ──────────────────
print("\n🔨 Forge (dev workspace)...")
fx, fy = -6, -6

# Signature rug
imp("rugRectangle.glb", pos=(fx, fy, 0.01), sc=S*2.0, name="forge_rug")

# 6 workstations (3 cols × 2 rows)
for row in range(2):
    for col in range(3):
        idx = row * 3 + col
        wx = fx + (col - 1) * 3.2
        wy = fy + (row - 0.5) * 3.0
        face = 0 if row == 0 else math.pi
        workstation(wx, wy, facing=face, idx=idx)

# Task board (against partition wall)
imp("bookcaseClosedWide.glb", pos=(fx, fy+4.5, 0), rot_z=math.pi, sc=S*1.3, name="forge_taskboard")

# Bookshelves
imp("bookcaseOpen.glb", pos=(fx-4.0, fy-4.0, 0), name="forge_shelf")
forge_shelf_obj = imp("books.glb", pos=(fx-4.0, fy-4.0, 0.88*S), name="forge_books")

# Props
imp("coatRackStanding.glb", pos=(fx-4.2, fy+3.5, 0), name="forge_coat")
imp("trashcan.glb", pos=(fx+4.0, fy-4.0, 0), name="forge_trash")
imp("pottedPlant.glb", pos=(fx-4.2, fy-2, 0), name="forge_plant1")
imp("pottedPlant.glb", pos=(fx+4.2, fy+3.5, 0), name="forge_plant2")
imp("lampRoundFloor.glb", pos=(fx+4.2, fy-4.0, 0), name="forge_flamp")
imp("cardboardBoxClosed.glb", pos=(fx-3.8, fy-4.5, 0), name="forge_box1")
imp("cardboardBoxOpen.glb", pos=(fx-4.3, fy-4.3, 0), name="forge_box2")
imp("bookcaseOpenLow.glb", pos=(fx+4.2, fy-2.0, 0), name="forge_lowshelf")

# Desk plants (on low shelf top)
forge_ls = [o for o in bpy.data.objects if o.name == "forge_lowshelf"]
if forge_ls:
    ls_z = top_z(forge_ls[0]) + 0.01
    imp("plantSmall1.glb", pos=(fx+4.2, fy-2.0, ls_z), name="forge_dplant1")

# ── GATE 4a: Tower — 创意会议室 (−6, 6) ──────────────────
print("\n🏢 Tower (creative meeting room)...")
tx, ty = -6, 6

# Distinctive layered rugs: large rectangle base + round accent
imp("rugRectangle.glb", pos=(tx, ty, 0.005), sc=S*2.8, name="tower_rug_base")
imp("rugRound.glb", pos=(tx, ty-1.5, 0.01), sc=S*1.5, name="tower_rug_accent")

# U-shaped design sofa arrangement facing presentation wall (east partition)
imp("loungeDesignSofa.glb", pos=(tx-2, ty, 0), rot_z=math.pi/2, name="tower_dsofa_w")
imp("loungeDesignSofa.glb", pos=(tx+2, ty, 0), rot_z=-math.pi/2, name="tower_dsofa_e")
imp("loungeDesignSofaCorner.glb", pos=(tx, ty-2.5, 0), rot_z=0, name="tower_dsofa_s")
imp("loungeDesignChair.glb", pos=(tx-2, ty+2.5, 0), rot_z=-math.pi/4, name="tower_dchair1")
imp("loungeDesignChair.glb", pos=(tx+2, ty+2.5, 0), rot_z=math.pi/4, name="tower_dchair2")

# Glass coffee table in the center of the U
tower_ctable = imp("tableCoffeeGlass.glb", pos=(tx, ty, 0), name="tower_ctable")
tct_z = top_z(tower_ctable) + 0.01 if tower_ctable else 0.2*S
imp("laptop.glb", pos=(tx-0.5, ty, tct_z), rot_z=math.pi/2, name="tower_lap_1")
imp("laptop.glb", pos=(tx+0.5, ty, tct_z), rot_z=-math.pi/2, name="tower_lap_2")

# Presentation wall: large TV + TV cabinet (east, near partition)
imp("cabinetTelevision.glb", pos=(tx+4.0, ty, 0), rot_z=-math.pi/2, name="tower_tvcab")
imp("televisionModern.glb", pos=(tx+4.2, ty, 1.0), sc=S*1.8, rot_z=-math.pi/2, name="tower_tv")

# Whiteboard bookcase + speaker on side table (presentation setup)
imp("bookcaseClosedWide.glb", pos=(tx-2.5, ty+3.8, 0), sc=S*1.3, name="tower_board")
tower_stable = imp("sideTable.glb", pos=(tx+4.2, ty-2.5, 0), name="tower_stable")
if tower_stable:
    ts_z = top_z(tower_stable) + 0.01
    imp("speakerSmall.glb", pos=(tx+4.2, ty-2.5, ts_z), name="tower_speaker")

# Accent lighting: floor lamp behind sofa
imp("lampSquareFloor.glb", pos=(tx-4.0, ty-2, 0), name="tower_flamp")

# Greenery: 3 plants + 1 small plant on bookcase
imp("pottedPlant.glb", pos=(tx+4.2, ty+4.0, 0), name="tower_p1")
imp("pottedPlant.glb", pos=(tx-4.2, ty-1, 0), name="tower_p2")
imp("pottedPlant.glb", pos=(tx-4.2, ty+4.0, 0), sc=S*1.2, name="tower_p3")
imp("coatRackStanding.glb", pos=(tx+4.2, ty-3.8, 0), name="tower_coat")

# Pillows on design sofas for creative feel
imp("pillowBlue.glb", pos=(tx-2, ty-0.5, 0.35*S), name="tower_pillow1")
imp("pillow.glb", pos=(tx+2, ty+0.5, 0.35*S), name="tower_pillow2")

# ── Tower: Extra creative differentiation (unique to this zone) ──
# Standalone whiteboard/easel area (small round table + books as "portfolio")
tower_port = imp("tableRound.glb", pos=(tx-3.5, ty+1.5, 0), sc=S*0.8, name="tower_portfolio_tbl")
if tower_port:
    tp_z = top_z(tower_port) + 0.01
    imp("books.glb", pos=(tx-3.5, ty+1.5, tp_z), name="tower_portfolio")
# Extra design chairs in reading nook (make tower feel like a "creative lounge" not "break room")
imp("chairModernCushion.glb", pos=(tx-3.5, ty-2.0, 0), rot_z=math.pi/3, name="tower_modern_ch1")
imp("chairModernCushion.glb", pos=(tx+3.5, ty+3.0, 0), rot_z=-math.pi/3, name="tower_modern_ch2")
# Second TV for dual-screen brainstorm setup
imp("televisionVintage.glb", pos=(tx-4.0, ty+1.5, 0), rot_z=math.pi/2, name="tower_vintagetv")

# ── GATE 4b: Court — 评审室 (6, 6) ───────────────────────
print("\n⚖️ Court (review room)...")
crx, cry = 6, 6

# Distinctive rug: formal square base
imp("rugSquare.glb", pos=(crx, cry, 0.01), sc=S*2.5, name="court_rug")

# Long formal table arrangement — 3 tables in a row (tribunal style)
court_t1 = imp("tableCross.glb", pos=(crx-2.4, cry+1, 0), sc=S*1.3, name="court_t1")
imp("tableCross.glb", pos=(crx, cry+1, 0), sc=S*1.3, name="court_t2")
imp("tableCross.glb", pos=(crx+2.4, cry+1, 0), sc=S*1.3, name="court_t3")

# Reviewer chairs behind tribunal table (facing south toward audience)
for i in range(3):
    ox = (i - 1) * 2.4
    imp("chairModernFrameCushion.glb", pos=(crx+ox, cry+2.5, 0), rot_z=math.pi, name=f"court_judge_{i}")

# Audience/observer chairs facing tribunal (2 rows)
for row in range(2):
    for i in range(4):
        ox = (i - 1.5) * 2.0
        imp("chairRounded.glb", pos=(crx+ox, cry-2-row*1.8, 0), rot_z=0, name=f"court_audience_{row}_{i}")

# Large presentation screen: televisionModern on cabinetTelevisionDoors
imp("cabinetTelevisionDoors.glb", pos=(crx, cry+4.0, 0), rot_z=math.pi, name="court_tvcab")
imp("televisionModern.glb", pos=(crx, cry+4.2, 0.8), sc=S*2.0, rot_z=math.pi, name="court_screen")

# Tabletop items on tribunal table
ct1_z = top_z(court_t1) + 0.01 if court_t1 else 0.37*S*1.3
imp("laptop.glb", pos=(crx-2.4, cry+1, ct1_z), rot_z=math.pi, name="court_lap1")
imp("laptop.glb", pos=(crx, cry+1, ct1_z), rot_z=math.pi, name="court_lap2")
imp("laptop.glb", pos=(crx+2.4, cry+1, ct1_z), rot_z=math.pi, name="court_lap3")

# Side furniture: bookcase with law books
imp("bookcaseClosedDoors.glb", pos=(crx+4.0, cry+3.5, 0), rot_z=-math.pi/2, name="court_bookcase")
court_bc = [o for o in bpy.data.objects if o.name == "court_bookcase"]
if court_bc:
    cbc_z = top_z(court_bc[0]) + 0.01
    imp("books.glb", pos=(crx+4.0, cry+3.5, cbc_z), name="court_books")

# Observer benches against south wall
imp("benchCushion.glb", pos=(crx-3.5, cry-4.5, 0), name="court_bench1")
imp("benchCushion.glb", pos=(crx+3.5, cry-4.5, 0), name="court_bench2")

# Accent: floor lamps + plants
imp("lampSquareFloor.glb", pos=(crx-4.0, cry+3.5, 0), name="court_lamp1")
imp("lampRoundFloor.glb", pos=(crx+4.0, cry-4.5, 0), name="court_lamp2")
imp("pottedPlant.glb", pos=(crx-4.2, cry+4.0, 0), name="court_plant1")
imp("pottedPlant.glb", pos=(crx+4.2, cry-4.0, 0), sc=S*1.2, name="court_plant2")
imp("trashcan.glb", pos=(crx+3.0, cry+2, 0), name="court_trash")

# ── GATE 4c: Lounge — 茶歇区 (6, −6) ────────────────────
print("\n☕ Lounge (break room)...")
lx, ly = 6, -6

imp("rugRounded.glb", pos=(lx, ly, 0.005), sc=S*2.0, name="lg_rug_outer")
imp("rugRound.glb", pos=(lx, ly, 0.01), sc=S*1.5, name="lg_rug")

imp("loungeSofa.glb", pos=(lx-2, ly-1, 0), rot_z=math.pi/2, name="lg_sofa1")
imp("loungeSofa.glb", pos=(lx+2, ly-1, 0), rot_z=-math.pi/2, name="lg_sofa2")
imp("loungeChairRelax.glb", pos=(lx, ly+2, 0), rot_z=math.pi, name="lg_chair")
imp("tableCoffeeGlass.glb", pos=(lx, ly, 0), name="lg_ctable")

# Kitchen corner
lg_counter = imp("sideTableDrawers.glb", pos=(lx+3.8, ly+2, 0), name="lg_counter")
cnt_z = top_z(lg_counter) + 0.01 if lg_counter else 0.38*S
imp("kitchenCoffeeMachine.glb", pos=(lx+3.8, ly+2, cnt_z), name="lg_coffee")
imp("kitchenFridgeSmall.glb", pos=(lx+4.0, ly+4.0, 0), name="lg_fridge")
lg_counter2 = imp("sideTableDrawers.glb", pos=(lx+3.8, ly+3.2, 0), name="lg_counter2")
cnt2_z = top_z(lg_counter2) + 0.01 if lg_counter2 else 0.38*S
imp("kitchenMicrowave.glb", pos=(lx+3.8, ly+3.2, cnt2_z), name="lg_micro")
imp("toaster.glb", pos=(lx+3.4, ly+2, cnt_z), name="lg_toaster")
imp("kitchenBlender.glb", pos=(lx+3.4, ly+3.2, cnt2_z), name="lg_blender")

for i in range(3):
    imp("stoolBar.glb", pos=(lx+2.5, ly+1.5+i*1.2, 0),
        rot_z=-math.pi/2, name=f"lg_stool_{i}")

imp("pottedPlant.glb", pos=(lx-4.2, ly-4.0, 0), name="lg_plant1")
imp("pottedPlant.glb", pos=(lx+4.0, ly-4.0, 0), name="lg_plant2")
imp("lampRoundFloor.glb", pos=(lx-4.2, ly-3, 0), name="lg_floorlamp")
imp("pillow.glb", pos=(lx-1.5, ly-1, 0.35*S), name="lg_pillow1")
imp("pillowBlueLong.glb", pos=(lx+1.5, ly-1, 0.35*S), name="lg_pillow2")
imp("radio.glb", pos=(lx, ly+2, 0.38*S), name="lg_radio")
imp("rugDoormat.glb", pos=(lx+3.2, ly+3.0, 0.01), name="lg_kmat")
imp("loungeSofaOttoman.glb", pos=(lx-1.5, ly+1.5, 0), name="lg_ottoman")
lg_ct = [o for o in bpy.data.objects if o.name == "lg_counter"]
if lg_ct:
    lct_z = top_z(lg_ct[0]) + 0.01
    imp("plantSmall2.glb", pos=(lx+3.4, ly+1, lct_z), name="lg_splant")

# ── GATE 4d: Hub — 大厅 (0, 0) ────────────────────────────
print("\n🏛 Hub (lobby)...")

# Layered rugs: large round base + square accent for reception desk
imp("rugRound.glb", pos=(0, -1.5, 0.005), sc=S*2.5, name="hub_rug_big")
imp("rugSquare.glb", pos=(0, 1.2, 0.01), sc=S*1.2, name="hub_deskrug")

# Reception desk (L-shaped deskCorner pair) + paneling backdrop
hub_desk = imp("deskCorner.glb", pos=(-0.8, 1.5, 0), name="hub_desk1")
imp("deskCorner.glb", pos=(0.8, 1.5, 0), rot_z=math.pi/2, name="hub_desk2")
hd_z = top_z(hub_desk) + 0.01 if hub_desk else 0.38*S
imp("computerScreen.glb", pos=(-0.4, 2, hd_z), rot_z=math.pi, name="hub_mon1")
imp("computerScreen.glb", pos=(0.6, 2, hd_z), rot_z=math.pi, name="hub_mon2")
imp("computerKeyboard.glb", pos=(0, 1.5, hd_z), name="hub_kb")
imp("chairDesk.glb", pos=(0, 0.3, 0), rot_z=math.pi, name="hub_chair")

# Paneling backdrop wall (signature element behind reception)
imp("paneling.glb", pos=(-1.2, 3.2, 0), sc=S*1.5, name="hub_panel1")
imp("paneling.glb", pos=(0, 3.2, 0), sc=S*1.5, name="hub_panel2")
imp("paneling.glb", pos=(1.2, 3.2, 0), sc=S*1.5, name="hub_panel3")

# Low shelf behind paneling with books + display
imp("bookcaseOpenLow.glb", pos=(-1.5, 3.0, 0), name="hub_shelf1")
imp("bookcaseOpenLow.glb", pos=(1.5, 3.0, 0), name="hub_shelf2")
hub_sh1 = [o for o in bpy.data.objects if o.name == "hub_shelf1"]
hub_sh2 = [o for o in bpy.data.objects if o.name == "hub_shelf2"]
if hub_sh1:
    hsh_z = top_z(hub_sh1[0]) + 0.01
    imp("books.glb", pos=(-1.5, 3.0, hsh_z), name="hub_shelf_books1")
if hub_sh2:
    hsh2_z = top_z(hub_sh2[0]) + 0.01
    imp("plantSmall3.glb", pos=(1.5, 3.0, hsh2_z), name="hub_shelf_plant")

# Waiting area: sofas + coffee table (angled inward)
imp("loungeSofa.glb", pos=(-2.5, -2, 0), rot_z=math.pi/4, name="hub_sofa1")
imp("loungeSofa.glb", pos=(2.5, -2, 0), rot_z=-math.pi/4, name="hub_sofa2")
imp("tableCoffeeGlassSquare.glb", pos=(0, -2.5, 0), name="hub_ctable")

# Feature: large plants flanking reception (hero visual)
imp("pottedPlant.glb", pos=(-3.5, 3.5, 0), sc=S*1.5, name="hub_p1")
imp("pottedPlant.glb", pos=(3.5, 3.5, 0), sc=S*1.5, name="hub_p2")
imp("pottedPlant.glb", pos=(-3.0, -3.5, 0), name="hub_p3")
imp("pottedPlant.glb", pos=(3.0, -3.5, 0), name="hub_p4")

# Side tables with small plants
imp("sideTable.glb", pos=(-1.2, -3.5, 0), name="hub_stable1")
imp("sideTable.glb", pos=(1.2, -3.5, 0), name="hub_stable2")
hub_st1 = [o for o in bpy.data.objects if o.name == "hub_stable1"]
hub_st2 = [o for o in bpy.data.objects if o.name == "hub_stable2"]
if hub_st1:
    imp("plantSmall1.glb", pos=(-1.2, -3.5, top_z(hub_st1[0])+0.01), name="hub_tplant")
if hub_st2:
    imp("plantSmall2.glb", pos=(1.2, -3.5, top_z(hub_st2[0])+0.01), name="hub_tplant2")

# Accent items
imp("pillow.glb", pos=(-1.8, -2, 0.35*S), name="hub_pillow")
imp("bear.glb", pos=(2.4, 2.2, 0), sc=S*1.3, name="hub_bear")
imp("rugDoormat.glb", pos=(0, -0.5, 0.01), name="hub_entrymat")

# Vintage TV as "info display" near entry
imp("televisionVintage.glb", pos=(-3.5, -0.5, 0), rot_z=math.pi/4, name="hub_infotv")

# ── Hub: Extra reception identity elements ──
# Large floor lamp flanking reception (beacon visual)
imp("lampSquareFloor.glb", pos=(-3.5, 2.0, 0), name="hub_recep_lamp_l")
imp("lampSquareFloor.glb", pos=(3.5, 2.0, 0), name="hub_recep_lamp_r")
# Welcome bench near entry
imp("benchCushionLow.glb", pos=(-2.5, -4.2, 0), rot_z=0, name="hub_welcome_bench")
# Extra side display with visitor info
hub_vd = imp("sideTableDrawers.glb", pos=(3.5, -3.5, 0), name="hub_visitor_desk")
if hub_vd:
    hvd_z = top_z(hub_vd) + 0.01
    imp("laptop.glb", pos=(3.5, -3.5, hvd_z), name="hub_visitor_lap")

# ── GATE 5: Corridors + Decoration + Ceiling Fans ─────────
print("\n🌿 Corridors & decorations...")

# Extra greenery throughout (review: 绿植不足)
imp("pottedPlant.glb", pos=(-9.5, 9.5, 0), sc=S*1.2, name="extra_p_nw")
imp("pottedPlant.glb", pos=(9.5, 9.5, 0), sc=S*1.2, name="extra_p_ne")
imp("pottedPlant.glb", pos=(-9.5, -9.5, 0), sc=S*1.2, name="extra_p_sw")
imp("pottedPlant.glb", pos=(9.5, -9.5, 0), sc=S*1.2, name="extra_p_se")
imp("plantSmall3.glb", pos=(-3.5, 0.3, 0), name="extra_ps_w")
imp("plantSmall2.glb", pos=(3.5, 0.3, 0), name="extra_ps_e")
imp("plantSmall1.glb", pos=(0.3, -3.5, 0), name="extra_ps_s")
imp("plantSmall3.glb", pos=(0.3, 3.5, 0), name="extra_ps_n")

# North corridor
imp("benchCushionLow.glb", pos=(0, 10.2, 0), rot_z=math.pi, name="corr_n_bench")
imp("pottedPlant.glb", pos=(-2.8, 10.2, 0), name="corr_n_p1")
imp("pottedPlant.glb", pos=(2.8, 10.2, 0), name="corr_n_p2")
imp("rugRectangle.glb", pos=(0, 9, 0.01), sc=S*0.8, rot_z=math.pi/2, name="corr_n_rug")
imp("lampWall.glb", pos=(-8, 0.15, 0.9*S), rot_z=math.pi, sc=S*0.7, name="wl_h_n1")
imp("lampWall.glb", pos=(8, 0.15, 0.9*S), rot_z=math.pi, sc=S*0.7, name="wl_h_n2")

# South corridor
imp("benchCushionLow.glb", pos=(0, -10.2, 0), name="corr_s_bench")
imp("pottedPlant.glb", pos=(-2.8, -10.2, 0), name="corr_s_p1")
imp("pottedPlant.glb", pos=(2.8, -10.2, 0), name="corr_s_p2")
imp("rugRectangle.glb", pos=(0, -9, 0.01), sc=S*0.8, rot_z=math.pi/2, name="corr_s_rug")
imp("lampWall.glb", pos=(-10, -0.15, 0.9*S), sc=S*0.7, name="wl_h_s1")
imp("lampWall.glb", pos=(10, -0.15, 0.9*S), sc=S*0.7, name="wl_h_s2")

# West corridor
imp("bench.glb", pos=(-10.2, 0, 0), rot_z=math.pi/2, name="corr_w_bench")
imp("pottedPlant.glb", pos=(-10.2, 3.0, 0), name="corr_w_p1")
imp("pottedPlant.glb", pos=(-10.2, -3.0, 0), name="corr_w_p2")
imp("rugRectangle.glb", pos=(-9, 0, 0.01), sc=S*0.8, name="corr_w_rug")
imp("lampWall.glb", pos=(0.15, -8, 0.9*S), rot_z=-math.pi/2, sc=S*0.7, name="wl_v_w1")
imp("lampWall.glb", pos=(0.15, 8, 0.9*S), rot_z=-math.pi/2, sc=S*0.7, name="wl_v_w2")

# East corridor (entrance side — most prominent)
imp("coatRackStanding.glb", pos=(10.2, 4.5, 0), name="corr_e_coat1")
imp("coatRackStanding.glb", pos=(10.2, -4.5, 0), name="corr_e_coat2")
imp("pottedPlant.glb", pos=(10.2, 2.5, 0), name="corr_e_p1")
imp("pottedPlant.glb", pos=(10.2, -2.5, 0), name="corr_e_p2")
imp("rugRectangle.glb", pos=(9, 0, 0.01), sc=S*1.0, name="corr_e_rug")
imp("rugDoormat.glb", pos=(10.8, 0, 0.01), sc=S*1.2, name="corr_e_mat")
imp("lampWall.glb", pos=(-0.15, -10, 0.9*S), rot_z=math.pi/2, sc=S*0.7, name="wl_v_e1")
imp("lampWall.glb", pos=(-0.15, 10, 0.9*S), rot_z=math.pi/2, sc=S*0.7, name="wl_v_e2")
# Paneling "signage" flanking the entrance doorway
imp("paneling.glb", pos=(10.5, 1.5, 0), sc=S*1.0, rot_z=-math.pi/2, name="corr_e_sign1")
imp("paneling.glb", pos=(10.5, -1.5, 0), sc=S*1.0, rot_z=-math.pi/2, name="corr_e_sign2")

# Ceiling fans (one per zone)
print("\n🌀 Ceiling fans...")
for (cfn, cfx, cfy) in [
    ("cf_hub", 0, 0),
    ("cf_forge", -6, -6),
    ("cf_tower", -6, 6),
    ("cf_court", 6, 6),
    ("cf_lounge", 6, -6),
]:
    imp("ceilingFan.glb", pos=(cfx, cfy, CEILING_Z), sc=S*0.85, name=cfn)

# === INSERTION POINT ===

# ══════════════════════════════════════════════════════════
# ── GATE 7: Massive Zone Identity Overhaul ────────────────
# ══════════════════════════════════════════════════════════
print("\n🎨 Zone identity overhaul...")

# ─── HUB: Transform into unmistakable reception/lobby ─────
# Double-height bookcase wall behind reception as brand wall
imp("bookcaseClosed.glb", pos=(-3.5, 3.5, 0), sc=S*1.3, name="hub_tallcase_l")
imp("bookcaseClosed.glb", pos=(3.5, 3.5, 0), sc=S*1.3, name="hub_tallcase_r")
# Large reception counter (kitchenBar repurposed)
imp("kitchenBar.glb", pos=(-1.5, 1.0, 0), name="hub_counter1")
imp("kitchenBar.glb", pos=(0, 1.0, 0), name="hub_counter1b")
imp("kitchenBarEnd.glb", pos=(1.5, 1.0, 0), name="hub_counter2")
# Distinctive large rug anchoring reception
imp("rugRectangle.glb", pos=(0, 0, 0.003), sc=S*2.2, name="hub_main_rug")
# Wall-mounted TV as lobby info display (opposite side from vintage TV)
imp("cabinetTelevision.glb", pos=(3.5, -0.5, 0), rot_z=-math.pi/2, name="hub_tvcab")
imp("televisionModern.glb", pos=(3.7, -0.5, 0.6), sc=S*1.3, rot_z=-math.pi/2, name="hub_info_tv")
# Extra waiting chairs (different style for variety)
imp("chairCushion.glb", pos=(-3.5, -2.5, 0), rot_z=math.pi/4, name="hub_wait_ch1")
imp("chairCushion.glb", pos=(3.5, -2.5, 0), rot_z=-math.pi/4, name="hub_wait_ch2")
# Magazine table in waiting area
hub_magt = imp("tableCoffee.glb", pos=(-2.5, -3.5, 0), name="hub_magtable")
if hub_magt:
    hmt_z = top_z(hub_magt) + 0.01
    imp("books.glb", pos=(-2.5, -3.5, hmt_z), name="hub_magazines")
# Side display table with books
imp("sideTable.glb", pos=(3.2, 0.5, 0), name="hub_display")
hub_disp = [o for o in bpy.data.objects if o.name == "hub_display"]
if hub_disp:
    hd_z2 = top_z(hub_disp[0]) + 0.01
    imp("plantSmall1.glb", pos=(3.2, 0.5, hd_z2), name="hub_disp_plant")
# Coat rack for visitor coats
imp("coatRack.glb", pos=(-3.8, -0.5, 0), name="hub_coatrack")
# Floor lamp for ambient warmth
imp("lampRoundFloor.glb", pos=(-3.5, -1.0, 0), name="hub_flamp")

# ─── FORGE: Amplify dev team atmosphere ───────────────────
# Whiteboard wall (wide bookcase) — team planning board
imp("bookcaseClosedWide.glb", pos=(-6+4.2, -6-4.0, 0), rot_z=math.pi/2, sc=S*1.2, name="forge_whiteboard")
# Server rack / monitoring station (stacked cabinets + screens)
imp("sideTableDrawers.glb", pos=(-6-4.2, -6+1.5, 0), name="forge_cabinet")
forge_cab = [o for o in bpy.data.objects if o.name == "forge_cabinet"]
if forge_cab:
    fcab_z = top_z(forge_cab[0]) + 0.01
    imp("laptop.glb", pos=(-6-4.2, -6+1.5, fcab_z), rot_z=math.pi/2, name="forge_lap_extra")
imp("sideTableDrawers.glb", pos=(-6-4.2, -6+3.0, 0), name="forge_cabinet2")
forge_cab2 = [o for o in bpy.data.objects if o.name == "forge_cabinet2"]
if forge_cab2:
    fcab2_z = top_z(forge_cab2[0]) + 0.01
    imp("computerScreen.glb", pos=(-6-4.2, -6+3.0, fcab2_z), rot_z=math.pi/2, name="forge_mon_extra")
# Shipping/delivery boxes (startup feel)
imp("cardboardBoxClosed.glb", pos=(-6+3.5, -6+4.5, 0), name="forge_box3")
imp("cardboardBoxOpen.glb", pos=(-6+4.0, -6+4.5, 0), name="forge_box4")
imp("cardboardBoxClosed.glb", pos=(-6+4.5, -6+4.5, 0), sc=S*0.8, name="forge_box5")
# Standing meeting table for daily standup
imp("tableRound.glb", pos=(-6+3.5, -6-2.5, 0), sc=S*0.9, name="forge_standup")
forge_su = [o for o in bpy.data.objects if o.name == "forge_standup"]
if forge_su:
    fsu_z = top_z(forge_su[0]) + 0.01
    imp("laptop.glb", pos=(-6+3.5, -6-2.5, fsu_z), name="forge_su_laptop")
# Entrance mat
imp("rugDoormat.glb", pos=(-6, -1.5, 0.01), name="forge_entrance_mat")
# Second floor lamp (corner warmth)
imp("lampSquareFloor.glb", pos=(-6-4.0, -6-3.5, 0), name="forge_flamp2")

# ─── TOWER: Unmistakable creative studio/brainstorm ───────
# Accent design chair + reading corner
imp("loungeDesignChair.glb", pos=(-6-3.5, 6+3, 0), rot_z=math.pi/3, name="tower_accent_ch")
# Nightstand with table lamp (reading corner)
imp("sideTableDrawers.glb", pos=(-6+3.5, 6+3.5, 0), name="tower_nightstand")
tower_ns = [o for o in bpy.data.objects if o.name == "tower_nightstand"]
if tower_ns:
    tns_z = top_z(tower_ns[0]) + 0.01
    imp("lampRoundTable.glb", pos=(-6+3.5, 6+3.5, tns_z), name="tower_tablelamp")
# Layered rug for texture depth
imp("rugRounded.glb", pos=(-6, 6, 0.003), sc=S*2.0, name="tower_rug_rounded")
# Idea wall — triple paneling with plants (inspiration board)
imp("paneling.glb", pos=(-6-4.2, 6-1.5, 0), sc=S*1.2, rot_z=math.pi/2, name="tower_idea1")
imp("paneling.glb", pos=(-6-4.2, 6+0.5, 0), sc=S*1.2, rot_z=math.pi/2, name="tower_idea2")
imp("paneling.glb", pos=(-6-4.2, 6+2.5, 0), sc=S*1.2, rot_z=math.pi/2, name="tower_idea3")
# Extra creative seating (loungeChair for sketching)
imp("loungeChair.glb", pos=(-6-3, 6-3, 0), rot_z=math.pi/4, name="tower_sketch_ch")
# Small table for sketch materials
tower_skt = imp("sideTable.glb", pos=(-6-2.5, 6-3.5, 0), name="tower_sketch_tbl")
if tower_skt:
    tsk_z = top_z(tower_skt) + 0.01
    imp("books.glb", pos=(-6-2.5, 6-3.5, tsk_z), name="tower_sketchbooks")
# Second floor lamp opposite side
imp("lampRoundFloor.glb", pos=(-6+4.0, 6-3.5, 0), name="tower_flamp2")

# ─── COURT: Formal authority and hierarchy ────────────────
# Double paneling as "rules/compliance board"
imp("paneling.glb", pos=(6-4.0, 6+4.0, 0), sc=S*1.2, name="court_panel1")
imp("paneling.glb", pos=(6-3.0, 6+4.0, 0), sc=S*1.2, name="court_panel2")
imp("paneling.glb", pos=(6-2.0, 6+4.0, 0), sc=S*1.2, name="court_panel3")
# Speaker podium (presentation station)
imp("speaker.glb", pos=(6-4.0, 6-1.5, 0), name="court_speaker_floor")
# Entrance mat + head chair
imp("rugDoormat.glb", pos=(6, 1.5, 0.01), name="court_entrance_mat")
imp("chairModernFrameCushion.glb", pos=(6, 6+3.5, 0), rot_z=math.pi, name="court_head_chair")
# Credenza / side cabinet for documents
imp("bookcaseClosedWide.glb", pos=(6+4.2, 6, 0), rot_z=-math.pi/2, name="court_credenza")
court_cred = [o for o in bpy.data.objects if o.name == "court_credenza"]
if court_cred:
    ccred_z = top_z(court_cred[0]) + 0.01
    imp("books.glb", pos=(6+4.2, 6, ccred_z), name="court_cred_books")
# Water cooler stand (sideTable + plantSmall as pitcher substitute)
imp("sideTable.glb", pos=(6+4.0, 6-2.5, 0), name="court_water")
court_water = [o for o in bpy.data.objects if o.name == "court_water"]
if court_water:
    cw_z = top_z(court_water[0]) + 0.01
    imp("plantSmall3.glb", pos=(6+4.0, 6-2.5, cw_z), name="court_water_plant")
# Extra observer bench for back wall (symmetry)
imp("benchCushion.glb", pos=(6, 6-4.5, 0), name="court_bench_center")
# Second paneling on east wall as "motto board"
imp("paneling.glb", pos=(6+4.2, 6+3, 0), sc=S*1.0, rot_z=-math.pi/2, name="court_motto")

# ─── LOUNGE: Complete kitchen corner + cozy nook ──────────
# Extended bar area
imp("kitchenBar.glb", pos=(6+2.2, -6+3.5, 0), rot_z=-math.pi/2, name="lg_bar")
imp("kitchenBarEnd.glb", pos=(6+2.2, -6+4.5, 0), rot_z=-math.pi/2, name="lg_barend")
imp("stoolBarSquare.glb", pos=(6+1.0, -6+3.5, 0), rot_z=math.pi/2, name="lg_bstool1")
imp("stoolBarSquare.glb", pos=(6+1.0, -6+4.5, 0), rot_z=math.pi/2, name="lg_bstool2")
# Kitchen upper cabinets (wall-mounted visual)
imp("kitchenCabinetUpper.glb", pos=(6+4.2, -6+2.5, 0.8*S), rot_z=-math.pi/2, name="lg_upper_cab1")
imp("kitchenCabinetUpperDouble.glb", pos=(6+4.2, -6+4.0, 0.8*S), rot_z=-math.pi/2, name="lg_upper_cab2")
# Large fridge (upgrade from small)
imp("kitchenFridgeLarge.glb", pos=(6+4.2, -6+4.8, 0), rot_z=-math.pi/2, name="lg_fridge_big")
# Sink counter
imp("kitchenSink.glb", pos=(6+3.5, -6+1.0, 0), rot_z=-math.pi/2, name="lg_sink")
# Extra cozy: rounded rug + extra pillow
imp("rugRounded.glb", pos=(6, -6, 0.003), sc=S*1.8, name="lg_rug_rounded")
imp("pillowLong.glb", pos=(6-2, -6-1.5, 0.35*S), name="lg_pillow3")
# Vintage TV as entertainment in lounge
imp("televisionAntenna.glb", pos=(6-3.5, -6+4.0, 0), name="lg_retro_tv")
# Board games / books on coffee table
lg_ct_obj = [o for o in bpy.data.objects if o.name == "lg_ctable"]
if lg_ct_obj:
    lct_z2 = top_z(lg_ct_obj[0]) + 0.01
    imp("books.glb", pos=(6, -6, lct_z2), name="lg_games")
# Extra lamp for cozy atmosphere
imp("lampSquareTable.glb", pos=(6-4.0, -6+3, 0.38*S), name="lg_tablelamp")

# ─── CORRIDOR RHYTHM: Visual markers + wayfinding ────────
print("\n🛤 Corridor rhythm...")

# Corridor greenery — dense planting at regular intervals
for i, (gx, gy, gn) in enumerate([
    (-6, 10.5, "cg_n1"), (-3, 10.5, "cg_n2"), (3, 10.5, "cg_n3"), (6, 10.5, "cg_n4"),
    (-6, -10.5, "cg_s1"), (-3, -10.5, "cg_s2"), (3, -10.5, "cg_s3"), (6, -10.5, "cg_s4"),
    (-10.5, -6, "cg_w1"), (-10.5, -3, "cg_w2"), (-10.5, 3, "cg_w3"), (-10.5, 6, "cg_w4"),
    (10.5, -6, "cg_e1"), (10.5, -3, "cg_e2"), (10.5, 3, "cg_e3"), (10.5, 6, "cg_e4"),
    (-10.5, 0, "cg_w_mid"), (10.5, 0, "cg_e_mid"),
]):
    plant_type = ["pottedPlant.glb", "plantSmall1.glb", "plantSmall2.glb", "plantSmall3.glb"][i % 4]
    plant_sc = S*1.1 if "potted" in plant_type else None
    imp(plant_type, pos=(gx, gy, 0), sc=plant_sc, name=gn)

# Wall art paneling (rhythm)
imp("paneling.glb", pos=(-10.5, 5, 0), sc=S*0.8, rot_z=math.pi/2, name="corr_w_art1")
imp("paneling.glb", pos=(-10.5, -5, 0), sc=S*0.8, rot_z=math.pi/2, name="corr_w_art2")
imp("paneling.glb", pos=(0, 10.5, 0), sc=S*0.8, name="corr_n_art1")
imp("paneling.glb", pos=(0, -10.5, 0), sc=S*0.8, name="corr_s_art1")
imp("paneling.glb", pos=(-3, 10.5, 0), sc=S*0.7, name="corr_n_art2")
imp("paneling.glb", pos=(3, -10.5, 0), sc=S*0.7, name="corr_s_art2")

# Side tables with lamps at corridor intersections (visual rhythm)
for (stx, sty, stn) in [(-5, 10, "corr_n_st"), (5, -10, "corr_s_st"), (-10, 0, "corr_w_st"), (10, 3, "corr_e_st")]:
    st_obj = imp("sideTable.glb", pos=(stx, sty, 0), name=stn)
    if st_obj:
        st_z = top_z(st_obj) + 0.01
        imp("plantSmall1.glb", pos=(stx, sty, st_z), name=f"{stn}_plant")

# ─── MASSIVE GREENERY BOOST ──────────────────────────────
print("\n🌿 Extra greenery everywhere...")

# Large corner plants (one per corner, large scale for visual anchor)
imp("pottedPlant.glb", pos=(-9.5, 9.5, 0), sc=S*1.4, name="corner_plant_nw")
imp("pottedPlant.glb", pos=(9.5, 9.5, 0), sc=S*1.4, name="corner_plant_ne")
imp("pottedPlant.glb", pos=(-9.5, -9.5, 0), sc=S*1.4, name="corner_plant_sw")
imp("pottedPlant.glb", pos=(9.5, -9.5, 0), sc=S*1.4, name="corner_plant_se")

# Partition junction plants (where partitions meet outer walls)
imp("pottedPlant.glb", pos=(0, 10.2, 0), sc=S*1.2, name="part_plant_n")
imp("pottedPlant.glb", pos=(0, -10.2, 0), sc=S*1.2, name="part_plant_s")
imp("pottedPlant.glb", pos=(-10.2, 0, 0), sc=S*1.2, name="part_plant_w")
imp("pottedPlant.glb", pos=(10.2, 0, 0), sc=S*1.2, name="part_plant_e")

# Mid-corridor plants (between zones)
imp("plantSmall3.glb", pos=(-3, 0.5, 0), name="mid_plant_w")
imp("plantSmall2.glb", pos=(3, 0.5, 0), name="mid_plant_e")
imp("plantSmall1.glb", pos=(0.5, -3, 0), name="mid_plant_s")
imp("plantSmall3.glb", pos=(0.5, 3, 0), name="mid_plant_n")

# Extra zone-edge plants (visible from corridors)
imp("pottedPlant.glb", pos=(-2, 5, 0), sc=S*1.0, name="zedge_plant_tower")
imp("pottedPlant.glb", pos=(-2, -5, 0), sc=S*1.0, name="zedge_plant_forge")
imp("pottedPlant.glb", pos=(2, 5, 0), sc=S*1.0, name="zedge_plant_court")
imp("pottedPlant.glb", pos=(2, -5, 0), sc=S*1.0, name="zedge_plant_lounge")

# ── GATE 6: Zone Area Lights ──────────────────────────────
print("\n💡 Lights...")
# Main sun — slightly softened to reduce harsh "floating" shadows
bpy.ops.object.light_add(type='SUN', location=(8, 8, 15))
sun = bpy.context.active_object
sun.data.energy = 2.5
sun.data.angle = math.radians(3)  # softer shadow edge
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.data.color = (1.0, 0.97, 0.92)
sun.name = "Sun"

# Fill light — stronger to reduce shadow contrast
bpy.ops.object.light_add(type='SUN', location=(-8, -8, 12))
fill = bpy.context.active_object
fill.data.energy = 1.8
fill.rotation_euler = (math.radians(70), 0, math.radians(150))
fill.data.color = (0.88, 0.85, 0.80)
fill.name = "Fill"

# Secondary fill from opposite angle — eliminates harsh under-object shadows
bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
fill2 = bpy.context.active_object
fill2.data.energy = 0.8
fill2.rotation_euler = (math.radians(85), 0, 0)
fill2.data.color = (0.9, 0.9, 0.95)
fill2.name = "Fill2"

# Zone area lights with boosted energy — strong color coding per zone
for (zn, zx, zy, zcol, zenergy) in [
    ("hub", 0, 0, (0.9, 0.95, 1.0), 120),
    ("tower", -6, 6, (0.5, 0.6, 1.0), 150),
    ("forge", -6, -6, (1.0, 0.8, 0.5), 150),
    ("court", 6, 6, (0.4, 1.0, 0.55), 150),
    ("lounge", 6, -6, (1.0, 0.88, 0.65), 150),
]:
    bpy.ops.object.light_add(type='AREA', location=(zx, zy, 1.29*S - 0.1))
    al = bpy.context.active_object
    al.data.energy = zenergy
    al.data.size = 8
    al.data.color = zcol
    al.name = f"al_{zn}"

# ── WORLD ─────────────────────────────────────────────────
world = bpy.data.worlds.new("Office")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.80, 0.84, 0.92, 1.0)
bg.inputs["Strength"].default_value = 0.35

# ── CAMERA + RENDER ───────────────────────────────────────
print("\n📷 Camera...")
bpy.ops.object.camera_add(location=(28, -28, 26))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 34
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

print("\n🎨 Rendering...")
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 2400
bpy.context.scene.render.resolution_y = 1500

# EEVEE shadow settings — softer shadows to reduce "floating" visual artifacts
bpy.context.scene.eevee.shadow_ray_count = 3
bpy.context.scene.eevee.shadow_step_count = 8
bpy.context.scene.eevee.use_shadow_jitter_viewport = True

out = os.path.join(PREVIEW_DIR, "v2-final.png")
out_close = os.path.join(PREVIEW_DIR, "v2-final-close.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")

# Close-up of Court area (6, 6)
cam.location = (6+14, 6-14, 14)
cam.data.ortho_scale = 18
bpy.context.scene.render.filepath = out_close
bpy.ops.render.render(write_still=True)
print(f"  ✅ Close-up: {out_close}")

# Close-up of Tower area (-6, 6)
out_tower = os.path.join(PREVIEW_DIR, "v2-tower.png")
cam.location = (-6+14, 6-14, 14)
cam.data.ortho_scale = 18
bpy.context.scene.render.filepath = out_tower
bpy.ops.render.render(write_still=True)
print(f"  ✅ Tower close-up: {out_tower}")

# Close-up of Hub area (0, 0)
out_hub = os.path.join(PREVIEW_DIR, "v2-hub.png")
cam.location = (0+14, 0-14, 14)
cam.data.ortho_scale = 16
bpy.context.scene.render.filepath = out_hub
bpy.ops.render.render(write_still=True)
print(f"  ✅ Hub close-up: {out_hub}")

# Close-up of Forge area (-6, -6)
out_forge = os.path.join(PREVIEW_DIR, "v2-forge.png")
cam.location = (-6+14, -6-14, 14)
cam.data.ortho_scale = 18
bpy.context.scene.render.filepath = out_forge
bpy.ops.render.render(write_still=True)
print(f"  ✅ Forge close-up: {out_forge}")

# Close-up of Lounge area (6, -6)
out_lounge = os.path.join(PREVIEW_DIR, "v2-lounge.png")
cam.location = (6+14, -6-14, 14)
cam.data.ortho_scale = 18
bpy.context.scene.render.filepath = out_lounge
bpy.ops.render.render(write_still=True)
print(f"  ✅ Lounge close-up: {out_lounge}")

# Restore full view
cam.location = (28, -28, 26)
cam.data.ortho_scale = 34

# ── DEBUG ──
print("  🔍 Debug: Tower + Court check done")

# ── DIAGNOSTICS ───────────────────────────────────────────
print("\n" + "="*60)
print("  DIAGNOSTICS: Object placement audit")
print("="*60)

FLOOR_Z = 0.0
TOLERANCE = 0.02
BOUNDARY = 12.6  # corners extend 0.55m beyond wall line, OK
issues = []

for obj in bpy.data.objects:
    if obj.type == 'EMPTY' and obj.children:
        all_coords = []
        for child in [obj] + list(obj.children_recursive):
            if child.type == 'MESH':
                for v in child.data.vertices:
                    all_coords.append(child.matrix_world @ v.co)
        if not all_coords:
            continue
        z_min = min(c.z for c in all_coords)
        x_min = min(c.x for c in all_coords)
        x_max = max(c.x for c in all_coords)
        y_min = min(c.y for c in all_coords)
        y_max = max(c.y for c in all_coords)
        name = obj.name

        if "f_" not in name and z_min > FLOOR_Z + TOLERANCE:
            is_tabletop = any(k in name.lower() for k in ['mon', 'kb', 'ms', 'lamp', 'coffee', 'micro', 'toaster', 'blender', 'books', 'splant', 'radio', 'spk', 'tplant', 'dplant', 'pillow', 'lap_', 'lap1', 'lap2', 'lap3', 'lap_extra', 'speaker', '_tv', 'wl_', 'cf_', 'pillowblue', 'pillowlong', 'court_screen', 'disp_plant', 'shelf_plant', 'tablelamp', 'magazines', 'sketchbooks', 'cred_books', 'water_plant', 'lg_games', 'upper_cab', 'info_tv', 'hub_info', 'su_laptop', 'mon_extra', '_st_plant', 'portfolio', 'visitor_lap'])
            if is_tabletop:
                print(f"  📎 {name:30s} z_min={z_min:.3f} (tabletop OK)")
            else:
                issues.append(f"🔴 FLOAT: {name} z_min={z_min:.3f}")

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

print(f"\n🎉 Build complete!")

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
