import math

import bpy


def mat(name, color):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


def cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

stone = mat("Rook blue stone", (0.02, 0.08, 0.14, 1))
stone_light = mat("Rook cyan bevel", (0.08, 0.30, 0.48, 1))
wood = mat("Rook dark wood gate", (0.22, 0.11, 0.05, 1))

cube("Square base", (0, 0, 0.12), (1.6, 1.6, 0.24), stone)
cube("Square tower", (0, 0, 0.92), (1.12, 1.12, 1.45), stone)
cube("Top platform", (0, 0, 1.72), (1.36, 1.36, 0.22), stone_light)

# Crenelated corners.
for x in (-0.48, 0.48):
    for y in (-0.48, 0.48):
        cube("Stone corner battlement", (x, y, 1.98), (0.32, 0.32, 0.34), stone_light)

# Raised rear wall and wide front gate.
cube("Raised rear wall", (0, 0.58, 2.05), (1.12, 0.18, 0.48), stone_light)
cube("Wide wooden gate on facing side", (0, -0.61, 1.92), (0.82, 0.16, 0.42), wood)

bpy.ops.object.light_add(type="AREA", location=(0, -4, 6))
light = bpy.context.object
light.name = "Softbox"
light.data.energy = 520
light.data.size = 5

bpy.ops.object.camera_add(
    location=(3, -5, 4),
    rotation=(math.radians(60), 0, math.radians(34)),
)
camera = bpy.context.object
bpy.context.scene.camera = camera
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.0

bpy.context.scene.render.resolution_x = 512
bpy.context.scene.render.resolution_y = 512
bpy.context.scene.render.film_transparent = True
