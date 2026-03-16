#!/usr/bin/env python3
"""
Step 1: Floor (3x3 tiles) + 1 desk + 1 chair.
Verify imp() Z-axis fix — nothing should float.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/test-step1-floor-desk.py
"""
import bpy
import os
import math

# ── Config ────────────────────────────────────────────────
S = 2.0  # scale: Kenney 1 unit → 2m real
ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
PREVIEW_DIR = "/tmp/office-build"
os.makedirs(PREVIEW_DIR, exist_ok=True)

# ── Clean ──────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in bpy.data.meshes: bpy.data.meshes.remove(m)
for m in bpy.data.materials: bpy.data.materials.remove(m)

# ── Import helper (FIXED: Z-axis grounding) ───────────────
def imp(filename, pos=(0,0,0), rot_z=0, sc=None, name=None):
    """Import GLB, center XY, ground Z (bottom at z=0), then place at pos."""
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        print(f"  ⚠️  Missing: {filename}")
        return None

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    new_objs = list(set(bpy.data.objects) - before)
    if not new_objs:
        return None

    # Collect all mesh vertices in world space
    coords = []
    for obj in new_objs:
        if obj.type == 'MESH':
            for v in obj.data.vertices:
                co = obj.matrix_world @ v.co
                coords.append(co)

    if coords:
        cx = (min(c.x for c in coords) + max(c.x for c in coords)) / 2
        cy = (min(c.y for c in coords) + max(c.y for c in coords)) / 2
        cz_min = min(c.z for c in coords)  # bottom of model
    else:
        cx = cy = cz_min = 0

    # Create parent empty at footprint center, grounded
    parent = bpy.data.objects.new(name or filename.replace('.glb',''), None)
    bpy.context.collection.objects.link(parent)

    # Offset children so model is XY-centered and Z-grounded at parent origin
    for obj in new_objs:
        obj.parent = parent
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= cz_min  # KEY FIX: ground the model

    s = sc or S
    parent.scale = (s, s, s)
    parent.rotation_euler.z = rot_z
    parent.location = pos
    return parent


# ══════════════════════════════════════════════════════════
#  TEST: 3x3 floor + 1 desk + 1 chair
# ══════════════════════════════════════════════════════════
print("\n" + "="*60)
print("  Step 1: Floor + Desk + Chair")
print("="*60)

# Floor: 3x3 grid centered at origin
t = S  # tile size after scale = 2m
for r in range(3):
    for c in range(3):
        x = (c - 1) * t
        y = (r - 1) * t
        imp("floorFull.glb", pos=(x, y, 0), name=f"floor_{c}_{r}")

# Desk at center
imp("desk.glb", pos=(0, 0, 0), name="test_desk")

# Chair behind desk (facing desk)
imp("chairDesk.glb", pos=(0, -1.2, 0), rot_z=0, name="test_chair")

# Monitor on desk top (desk height = 0.384 * S ≈ 0.77m)
dh = 0.384 * S
imp("computerScreen.glb", pos=(0, 0.2, dh), rot_z=math.pi, name="test_monitor")

# ── Lighting ──────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
sun = bpy.context.active_object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-30))
sun.name = "Sun"

bpy.ops.object.light_add(type='AREA', location=(0, 0, 4))
al = bpy.context.active_object
al.data.energy = 50
al.data.size = 4
al.name = "AreaLight"

# ── World ──────────────────────────────────────────────────
world = bpy.data.worlds.new("Test")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.78, 0.82, 0.90, 1.0)
bg.inputs["Strength"].default_value = 0.3

# ── Camera (isometric-ish) ────────────────────────────────
bpy.ops.object.camera_add(location=(8, -8, 8))
cam = bpy.context.active_object
cam.name = "IsoCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 10
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── Render ─────────────────────────────────────────────────
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 800
bpy.context.scene.render.resolution_y = 600

out = os.path.join(PREVIEW_DIR, "step1-floor-desk.png")
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"\n✅ Preview: {out}")
print("Check: desk/chair/monitor should sit ON the floor, not float.")
