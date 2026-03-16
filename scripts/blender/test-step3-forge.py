#!/usr/bin/env python3
"""
Step 3: Forge zone (开发工位区) — 6 workstations + decorations.
Verify: multiple workstations don't overlap, face-to-face layout works.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/test-step3-forge.py
"""
import bpy
import os
import math

S = 2.0
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
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


def workstation(cx, cy, facing=0, idx=0):
    """Desk + chair + monitor + keyboard + mouse."""
    dh = 0.384 * S  # desk top Z

    imp("desk.glb", pos=(cx, cy, 0), rot_z=facing, name=f"ws{idx}_desk")

    # Chair: in front of desk (opposite facing direction)
    co = 0.55 * S
    imp("chairDesk.glb",
        pos=(cx - math.sin(facing)*co, cy + math.cos(facing)*co, 0),
        rot_z=facing + math.pi, name=f"ws{idx}_chair")

    # Monitor: back of desk
    mo = 0.25 * S
    imp("computerScreen.glb",
        pos=(cx + math.sin(facing)*mo, cy - math.cos(facing)*mo, dh),
        rot_z=facing + math.pi, name=f"ws{idx}_mon")

    # Keyboard + mouse
    imp("computerKeyboard.glb", pos=(cx, cy, dh), rot_z=facing, name=f"ws{idx}_kb")
    mx = cx + math.cos(facing) * 0.2 * S
    my = cy + math.sin(facing) * 0.2 * S
    imp("computerMouse.glb", pos=(mx, my, dh), rot_z=facing, name=f"ws{idx}_ms")


print("\n" + "="*60)
print("  Step 3: Forge Zone (6 workstations)")
print("="*60)

# Floor: 6x6 grid centered at (0, 0)
for r in range(6):
    for c in range(6):
        x = (c - 2.5) * S
        y = (r - 2.5) * S
        imp("floorFull.glb", pos=(x, y, 0), name=f"f_{c}_{r}")

# 6 workstations: 2 rows x 3, face-to-face (tighter spacing)
for row in range(2):
    for col in range(3):
        idx = row * 3 + col
        wx = (col - 1) * 2.0 * S   # 4m between desk columns
        wy = (row - 0.5) * 1.8 * S  # 3.6m between rows
        face = 0 if row == 0 else math.pi  # face each other
        workstation(wx, wy, facing=face, idx=idx)

# Decorations (within floor bounds)
imp("bookcaseOpen.glb", pos=(4, -4, 0), name="forge_shelf")
imp("books.glb", pos=(4, -4, 0.88*S), name="forge_books")
imp("pottedPlant.glb", pos=(-4, 4, 0), name="forge_plant")
imp("lampRoundFloor.glb", pos=(4, 3, 0), name="forge_flamp")
imp("plantSmall2.glb", pos=(-4, -4, 0), name="forge_plant2")

# ── Lighting ──
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

bpy.ops.object.light_add(type='AREA', location=(0, 0, 4))
al = bpy.context.active_object
al.data.energy = 60
al.data.size = 8

# ── World ──
world = bpy.data.worlds.new("Test")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.78, 0.82, 0.90, 1.0)
bg.inputs["Strength"].default_value = 0.3

# ── Camera ──
bpy.ops.object.camera_add(location=(18, -18, 16))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 22
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── Render ──
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1000
bpy.context.scene.render.resolution_y = 750

out = os.path.join(PREVIEW_DIR, "step3-forge.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")
print("Check: 6 workstations in 2x3 grid, face-to-face, no overlaps.")
