#!/usr/bin/env python3
"""
Step 2: Walls (4-sided room) + 1 complete workstation + decoration.
Verify: walls stand on floor, workstation components aligned, window wall variant.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/test-step2-room.py
"""
import bpy
import os
import math

S = 2.0
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
os.makedirs(PREVIEW_DIR, exist_ok=True)

# ── Clean ──────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in bpy.data.meshes: bpy.data.meshes.remove(m)
for m in bpy.data.materials: bpy.data.materials.remove(m)

# ── Import helper (Z-grounded) ─────────────────────────────
def imp(filename, pos=(0,0,0), rot_z=0, sc=None, name=None):
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        print(f"  ⚠️  Missing: {filename}")
        return None

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    new_objs = list(set(bpy.data.objects) - before)
    if not new_objs:
        return None

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
        obj.location.z -= cz_min

    s = sc or S
    parent.scale = (s, s, s)
    parent.rotation_euler.z = rot_z
    parent.location = pos
    return parent


# ══════════════════════════════════════════════════════════
#  TEST: 5x5 room with walls + 1 workstation + plant
# ══════════════════════════════════════════════════════════
print("\n" + "="*60)
print("  Step 2: Room + Workstation")
print("="*60)

# Floor: 5x5 grid
t = S
for r in range(5):
    for c in range(5):
        x = (c - 2) * t
        y = (r - 2) * t
        imp("floorFull.glb", pos=(x, y, 0), name=f"f_{c}_{r}")

# Walls — south (y = -5*t/2 = -5)
for i in range(5):
    x = (i - 2) * t
    if i == 2:  # doorway in center
        imp("wallDoorway.glb", pos=(x, -4, 0), name=f"ws_{i}")
    elif i in (1, 3):  # windows on sides
        imp("wallWindow.glb", pos=(x, -4, 0), name=f"ww_s_{i}")
    else:
        imp("wall.glb", pos=(x, -4, 0), name=f"w_s_{i}")

# Walls — north
for i in range(5):
    x = (i - 2) * t
    if i in (1, 3):
        imp("wallWindow.glb", pos=(x, 4, 0), name=f"ww_n_{i}")
    else:
        imp("wall.glb", pos=(x, 4, 0), name=f"w_n_{i}")

# Walls — west
for i in range(5):
    y = (i - 2) * t
    imp("wall.glb", pos=(-4, y, 0), rot_z=math.pi/2, name=f"w_w_{i}")

# Walls — east
for i in range(5):
    y = (i - 2) * t
    if i in (1, 3):
        imp("wallWindow.glb", pos=(4, y, 0), rot_z=math.pi/2, name=f"ww_e_{i}")
    else:
        imp("wall.glb", pos=(4, y, 0), rot_z=math.pi/2, name=f"w_e_{i}")

# ── Workstation: desk + chair + monitor + keyboard + mouse ──
dh = 0.384 * S  # desk top height after scale

# Desk at (0, 0)
imp("desk.glb", pos=(0, 0, 0), name="ws_desk")

# Chair (in front of desk, user sits here)
imp("chairDesk.glb", pos=(0, -1.1, 0), rot_z=0, name="ws_chair")

# Monitor (back of desk, facing user)
imp("computerScreen.glb", pos=(0, 0.25, dh), rot_z=math.pi, name="ws_monitor")

# Keyboard (on desk, in front of monitor)
imp("computerKeyboard.glb", pos=(0, 0, dh), rot_z=0, name="ws_keyboard")

# Mouse (to the right of keyboard)
imp("computerMouse.glb", pos=(0.4, 0, dh), rot_z=0, name="ws_mouse")

# ── Decoration ──
imp("pottedPlant.glb", pos=(-3, 3, 0), name="plant1")
imp("bookcaseOpen.glb", pos=(3, 2.5, 0), name="bookcase")
imp("books.glb", pos=(3, 2.5, 0.88*S), name="books")
imp("lampRoundFloor.glb", pos=(-3, -2, 0), name="floorlamp")

# ── Lighting ──────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.data.color = (1.0, 0.97, 0.92)
sun.name = "Sun"

bpy.ops.object.light_add(type='SUN', location=(-5, -5, 8))
fill = bpy.context.active_object
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(70), 0, math.radians(150))
fill.data.color = (0.85, 0.82, 0.78)
fill.name = "Fill"

bpy.ops.object.light_add(type='AREA', location=(0, 0, 3.5))
al = bpy.context.active_object
al.data.energy = 40
al.data.size = 5
al.name = "AreaLight"

# ── World ──────────────────────────────────────────────────
world = bpy.data.worlds.new("Test")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.78, 0.82, 0.90, 1.0)
bg.inputs["Strength"].default_value = 0.3

# ── Camera ─────────────────────────────────────────────────
bpy.ops.object.camera_add(location=(14, -14, 12))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 16
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── Render ─────────────────────────────────────────────────
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1000
bpy.context.scene.render.resolution_y = 750

out = os.path.join(PREVIEW_DIR, "step2-room.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")
print("Check: walls form a room, workstation on floor, windows visible, bookcase/plant in corners.")
