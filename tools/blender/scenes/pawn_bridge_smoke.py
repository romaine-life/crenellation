import math

import bpy


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


def cylinder(name, radius, depth, z, material, vertices=48):
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

navy = mat("Chess navy", (0.01, 0.05, 0.10, 1))
steel = mat("Blue steel", (0.17, 0.25, 0.33, 1))
cyan = mat("Cyan slit", (0.10, 0.55, 0.85, 1))

cylinder("Pawn base", 1.0, 0.25, 0.125, navy)
cylinder("Pawn foot ring", 0.75, 0.18, 0.36, navy)
cylinder("Pawn body", 0.48, 1.05, 0.96, navy)
cylinder("Pawn collar", 0.52, 0.18, 1.56, steel)

bpy.ops.mesh.primitive_uv_sphere_add(
    segments=64,
    ring_count=32,
    radius=0.46,
    location=(0, 0, 2.0),
)
helm = bpy.context.object
helm.name = "Pawn helm dome"
helm.scale.z = 1.18
helm.data.materials.append(steel)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.44, 1.96))
slit = bpy.context.object
slit.name = "Narrow eye slit"
slit.dimensions = (0.38, 0.035, 0.045)
slit.data.materials.append(cyan)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.40, 1.69))
drop = bpy.context.object
drop.name = "Helm front drop"
drop.dimensions = (0.34, 0.06, 0.42)
drop.data.materials.append(steel)

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
