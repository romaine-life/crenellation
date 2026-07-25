import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-smoke"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


def add_cylinder(name, radius, depth, z, material, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=(0, 0, z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

navy = make_material("Chess navy blue", (0.02, 0.08, 0.14, 1))
cyan = make_material("Cyan marker", (0.1, 0.55, 0.85, 1))

add_cylinder("Base", 1.0, 0.25, 0.125, navy)
add_cylinder("Body", 0.55, 1.2, 0.85, navy)
add_cylinder("Neck", 0.35, 0.28, 1.58, navy)

bpy.ops.mesh.primitive_uv_sphere_add(
    segments=48,
    ring_count=24,
    radius=0.48,
    location=(0, 0, 2.0),
)
head = bpy.context.object
head.name = "Pawn head"
head.scale.z = 1.08
head.data.materials.append(navy)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.47, 2.02))
slit = bpy.context.object
slit.name = "Front slit marker"
slit.dimensions = (0.42, 0.035, 0.055)
slit.data.materials.append(cyan)

bpy.ops.object.light_add(type="AREA", location=(0, -4, 6))
light = bpy.context.object
light.name = "Softbox"
light.data.energy = 450
light.data.size = 5

bpy.ops.object.camera_add(
    location=(3, -5, 4),
    rotation=(math.radians(60), 0, math.radians(34)),
)
camera = bpy.context.object
bpy.context.scene.camera = camera
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.2

bpy.context.scene.render.resolution_x = 512
bpy.context.scene.render.resolution_y = 512
bpy.context.scene.render.film_transparent = True
bpy.context.scene.render.filepath = str(OUT_DIR / "pawn-smoke.png")
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "unit-smoke.blend"))
bpy.ops.render.render(write_still=True)

print(f"Wrote {OUT_DIR / 'unit-smoke.blend'}")
print(f"Wrote {OUT_DIR / 'pawn-smoke.png'}")
