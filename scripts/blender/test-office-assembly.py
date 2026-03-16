#!/usr/bin/env python3
"""Phase 1 验证: 导入 Kenney 家具模型，组装一个开发工位，渲染 + 导出 GLB。"""
import bpy
import os
import math

ASSET_DIR = "/tmp/kenney-furniture/Models/GLTF format"
OUTPUT_DIR = "/tmp/office-test"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Clean slate ──
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
# Remove default collection items
for c in bpy.data.collections:
    for o in c.objects:
        bpy.data.objects.remove(o)

def import_glb(filename, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), name=None):
    """Import a GLB file and position it."""
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        print(f"⚠️  Missing: {filename}")
        return None

    # Track objects before import
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    after = set(bpy.data.objects)
    new_objects = after - before

    if not new_objects:
        print(f"⚠️  No objects imported from {filename}")
        return None

    # Create empty parent and parent all new objects to it
    parent = bpy.data.objects.new(name or filename.replace('.glb', ''), None)
    bpy.context.collection.objects.link(parent)
    parent.location = location
    parent.rotation_euler = rotation
    parent.scale = scale

    for obj in new_objects:
        obj.parent = parent

    print(f"  ✅ {filename} → {len(new_objects)} objects")
    return parent


# ══════════════════════════════════════════════════════════════
# Build a small office scene: 2 workstations + break corner
# ══════════════════════════════════════════════════════════════

print("\n=== Building test office scene ===\n")

# ── Floor (4x4 grid of floor tiles) ──
print("--- Floor & Walls ---")
for x in range(4):
    for y in range(4):
        import_glb("floorFull.glb", location=(x * 2, y * 2, 0), name=f"floor_{x}_{y}")

# ── Walls ──
for i in range(4):
    import_glb("wall.glb", location=(i * 2, 8, 0), name=f"wall_n_{i}")
for i in range(4):
    import_glb("wall.glb", location=(-1, i * 2, 0), rotation=(0, 0, math.pi/2), name=f"wall_w_{i}")

# ── Doorway ──
import_glb("doorway.glb", location=(3 * 2, 8, 0), name="doorway_main")

# ── Workstation 1 ──
print("\n--- Workstation 1 ---")
import_glb("desk.glb", location=(1, 2, 0), name="ws1_desk")
import_glb("chairDesk.glb", location=(1, 0.8, 0), rotation=(0, 0, math.pi), name="ws1_chair")
import_glb("computerScreen.glb", location=(1, 2.4, 0.73), name="ws1_monitor")
import_glb("computerKeyboard.glb", location=(1, 1.8, 0.73), name="ws1_keyboard")
import_glb("computerMouse.glb", location=(1.4, 1.8, 0.73), name="ws1_mouse")

# ── Workstation 2 ──
print("\n--- Workstation 2 ---")
import_glb("deskCorner.glb", location=(4, 2, 0), name="ws2_desk")
import_glb("chairDesk.glb", location=(4, 0.8, 0), rotation=(0, 0, math.pi), name="ws2_chair")
import_glb("laptop.glb", location=(4, 2.2, 0.73), name="ws2_laptop")

# ── Break corner ──
print("\n--- Break Corner ---")
import_glb("loungeSofa.glb", location=(1, 6, 0), name="sofa")
import_glb("tableCoffeeGlass.glb", location=(3, 6, 0), name="coffee_table")
import_glb("pottedPlant.glb", location=(5.5, 6.5, 0), name="plant1")
import_glb("plantSmall1.glb", location=(3, 6.5, 0.4), name="plant_table")
import_glb("kitchenCoffeeMachine.glb", location=(5.5, 5, 0.73), name="coffee_machine")

# ── Bookshelf ──
print("\n--- Bookshelf ---")
import_glb("bookcaseOpen.glb", location=(6, 2, 0), name="bookcase")
import_glb("books.glb", location=(6, 2, 0.8), name="books")

# ── Lighting ──
print("\n--- Lighting ---")
import_glb("lampSquareCeiling.glb", location=(2, 3, 2.8), name="ceiling_lamp1")
import_glb("lampSquareCeiling.glb", location=(5, 3, 2.8), name="ceiling_lamp2")

# Add actual lights for rendering
bpy.ops.object.light_add(type='AREA', location=(3, 4, 3.5))
area = bpy.context.active_object
area.data.energy = 80
area.data.size = 6
area.name = "MainAreaLight"

# Warm fill light
bpy.ops.object.light_add(type='POINT', location=(1, 6, 2))
fill = bpy.context.active_object
fill.data.energy = 30
fill.data.color = (1.0, 0.9, 0.8)
fill.name = "FillLight"

# ── Camera (isometric-style) ──
print("\n--- Camera ---")
bpy.ops.object.camera_add(location=(12, -4, 8))
cam = bpy.context.active_object
cam.name = "IsometricCam"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 12
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam

# ── World background ──
world = bpy.data.worlds.new("OfficeWorld")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.85, 0.88, 0.92, 1.0)
bg.inputs["Strength"].default_value = 0.3

# ── Render settings ──
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 1200
bpy.context.scene.render.resolution_y = 800
bpy.context.scene.render.film_transparent = False

# ── Render preview ──
print("\n=== Rendering preview ===")
bpy.context.scene.render.filepath = os.path.join(OUTPUT_DIR, "office-preview.png")
bpy.ops.render.render(write_still=True)
print(f"✅ Preview: {OUTPUT_DIR}/office-preview.png")

# ── Export GLB ──
print("\n=== Exporting GLB ===")
glb_path = os.path.join(OUTPUT_DIR, "office-test.glb")
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_materials='EXPORT',
)
size_kb = os.path.getsize(glb_path) / 1024
print(f"✅ GLB: {glb_path} ({size_kb:.1f} KB)")

print("\n🎉 Phase 1 验证完成!")
