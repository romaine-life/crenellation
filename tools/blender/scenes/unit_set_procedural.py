import math
from pathlib import Path

import bpy
from mathutils import Vector


try:
    ROOT = Path(__file__).resolve().parents[2]
except NameError:
    ROOT = Path("D:/repos/chess-tactics")
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def mat(name, color, roughness=0.82):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return material


NAVY = None
STEEL = None
CYAN = None
WOOD = None
LEATHER = None
DARK = None


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def shade(obj, smooth=True):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if smooth:
        bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def bevel(obj, amount=0.04, segments=2):
    mod = obj.modifiers.new("soft bevel", "BEVEL")
    mod.width = amount
    mod.segments = segments
    mod.affect = "EDGES"
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def cyl(name, radius, depth, z, material, vertices=64, loc=(0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=(loc[0], loc[1], z),
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    bevel(obj, 0.025 if vertices >= 32 else 0.015, 2)
    return shade(obj, smooth)


def cube(name, location, scale, material, bevel_amount=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    assign(obj, material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(obj, bevel_amount, 1)
    return obj


def sphere(name, radius, location, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=64,
        ring_count=32,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, material)
    return shade(obj, True)


def cone(name, radius1, radius2, depth, z, material, vertices=64, loc=(0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=(loc[0], loc[1], z),
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    bevel(obj, 0.02, 2)
    return shade(obj, True)


def group_objects(prefix, objects):
    empty = bpy.data.objects.new(prefix, None)
    bpy.context.collection.objects.link(empty)
    for obj in objects:
        obj.parent = empty
    return empty


def pawn(x):
    objs = []
    objs.append(cyl("pawn_base", 0.55, 0.16, 0.08, NAVY, loc=(x, 0)))
    objs.append(cyl("pawn_foot", 0.42, 0.12, 0.24, NAVY, loc=(x, 0)))
    objs.append(cone("pawn_body", 0.31, 0.20, 0.62, 0.62, NAVY, loc=(x, 0)))
    objs.append(cyl("pawn_collar", 0.34, 0.12, 0.99, STEEL, loc=(x, 0)))
    objs.append(sphere("pawn_helm_dome", 0.32, (x, 0, 1.34), STEEL, scale=(0.92, 0.92, 1.15)))
    objs.append(cube("pawn_helm_front_drop", (x, -0.27, 1.15), (0.26, 0.055, 0.34), STEEL, 0.018))
    objs.append(cube("pawn_eye_slit", (x, -0.305, 1.34), (0.22, 0.025, 0.035), CYAN, 0.006))
    return group_objects("pawn", objs)


def rook(x):
    objs = []
    objs.append(cube("rook_base", (x, 0, 0.09), (0.88, 0.88, 0.18), NAVY, 0.025))
    objs.append(cube("rook_body", (x, 0, 0.62), (0.62, 0.62, 0.92), NAVY, 0.03))
    objs.append(cube("rook_platform", (x, 0, 1.15), (0.78, 0.78, 0.16), STEEL, 0.02))
    for dx in (-0.27, 0.27):
        for dy in (-0.27, 0.27):
            objs.append(cube("rook_corner", (x + dx, dy, 1.34), (0.18, 0.18, 0.28), STEEL, 0.015))
    objs.append(cube("rook_rear_wall", (x, 0.36, 1.38), (0.62, 0.11, 0.34), STEEL, 0.015))
    objs.append(cube("rook_front_gate", (x, -0.385, 1.28), (0.48, 0.08, 0.30), WOOD, 0.012))
    return group_objects("rook", objs)


def knight(x):
    objs = []
    objs.append(cyl("knight_base", 0.52, 0.16, 0.08, NAVY, loc=(x, 0)))
    objs.append(cyl("knight_foot", 0.38, 0.13, 0.25, NAVY, loc=(x, 0)))
    objs.append(cone("knight_neck", 0.26, 0.17, 0.95, 0.76, NAVY, loc=(x, 0)))
    objs.append(sphere("knight_head_mass", 0.28, (x, -0.05, 1.33), NAVY, scale=(0.72, 1.10, 1.25)))
    objs[-1].rotation_euler[0] = math.radians(-10)
    objs.append(cube("knight_muzzle", (x, -0.30, 1.24), (0.20, 0.22, 0.16), NAVY, 0.04))
    objs.append(cube("knight_brow", (x, -0.18, 1.48), (0.34, 0.05, 0.07), STEEL, 0.012))
    objs.append(cube("knight_leather_strap", (x, -0.285, 1.29), (0.24, 0.035, 0.24), LEATHER, 0.008))
    objs.append(cube("knight_mane", (x, 0.14, 1.22), (0.10, 0.12, 0.58), STEEL, 0.018))
    return group_objects("knight", objs)


def bishop(x):
    objs = []
    objs.append(cyl("bishop_base", 0.50, 0.16, 0.08, NAVY, loc=(x, 0)))
    objs.append(cyl("bishop_foot", 0.36, 0.12, 0.25, NAVY, loc=(x, 0)))
    objs.append(cone("bishop_body", 0.25, 0.17, 0.90, 0.76, NAVY, loc=(x, 0)))
    objs.append(cyl("bishop_collar", 0.28, 0.10, 1.26, NAVY, loc=(x, 0)))
    objs.append(sphere("bishop_mitre", 0.28, (x, 0, 1.56), STEEL, scale=(0.78, 0.78, 1.28)))
    slash = cube("bishop_diagonal_cut", (x, -0.245, 1.62), (0.40, 0.035, 0.055), CYAN, 0.006)
    slash.rotation_euler[1] = math.radians(0)
    slash.rotation_euler[2] = math.radians(-32)
    objs.append(slash)
    return group_objects("bishop", objs)


def queen(x):
    objs = []
    objs.append(cyl("queen_base", 0.50, 0.16, 0.08, NAVY, loc=(x, 0)))
    objs.append(cyl("queen_foot", 0.36, 0.12, 0.25, NAVY, loc=(x, 0)))
    objs.append(cone("queen_body", 0.25, 0.16, 0.88, 0.76, NAVY, loc=(x, 0)))
    objs.append(cyl("queen_collar", 0.29, 0.10, 1.25, NAVY, loc=(x, 0)))
    objs.append(sphere("queen_head", 0.24, (x, 0, 1.52), NAVY, scale=(0.9, 0.9, 0.95)))
    objs.append(cyl("queen_tiara_band", 0.30, 0.06, 1.66, STEEL, vertices=48, loc=(x, 0)))
    peak_positions = [(0, -0.29, 1.82, 0.12), (-0.19, -0.24, 1.76, 0.09), (0.19, -0.24, 1.76, 0.09)]
    for dx, dy, z, radius in peak_positions:
        objs.append(sphere("queen_tiara_peak", radius, (x + dx, dy, z), STEEL, scale=(0.75, 0.75, 1.18)))
    objs.append(cube("queen_tiara_arch_left", (x - 0.10, -0.275, 1.70), (0.18, 0.035, 0.05), STEEL, 0.006))
    objs[-1].rotation_euler[2] = math.radians(18)
    objs.append(cube("queen_tiara_arch_right", (x + 0.10, -0.275, 1.70), (0.18, 0.035, 0.05), STEEL, 0.006))
    objs[-1].rotation_euler[2] = math.radians(-18)
    return group_objects("queen", objs)


def king(x):
    objs = []
    objs.append(cyl("king_base", 0.52, 0.16, 0.08, NAVY, loc=(x, 0)))
    objs.append(cyl("king_foot", 0.37, 0.12, 0.25, NAVY, loc=(x, 0)))
    objs.append(cone("king_body", 0.25, 0.16, 1.02, 0.83, NAVY, loc=(x, 0)))
    objs.append(cyl("king_collar", 0.30, 0.11, 1.40, NAVY, loc=(x, 0)))
    objs.append(sphere("king_head", 0.22, (x, 0, 1.64), STEEL, scale=(0.90, 0.90, 0.90)))
    objs.append(cube("king_cross_vertical", (x, -0.01, 1.95), (0.055, 0.055, 0.30), STEEL, 0.008))
    objs.append(cube("king_cross_horizontal", (x, -0.01, 2.00), (0.24, 0.055, 0.055), STEEL, 0.008))
    return group_objects("king", objs)


def setup_camera():
    bpy.ops.object.light_add(type="AREA", location=(0, -5, 7))
    light = bpy.context.object
    light.name = "Large softbox"
    light.data.energy = 650
    light.data.size = 6

    bpy.ops.object.camera_add(
        location=(0.0, -8.2, 4.8),
        rotation=(0, 0, 0),
    )
    camera = bpy.context.object
    camera.name = "Unit isometric camera"
    bpy.context.scene.camera = camera
    direction = Vector((0, 0, 0.95)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 8.8

    bpy.context.scene.render.resolution_x = 1600
    bpy.context.scene.render.resolution_y = 700
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = str(OUT_DIR / "unit-set-procedural-preview.png")


def main():
    global NAVY, STEEL, CYAN, WOOD, LEATHER, DARK
    clear_scene()
    NAVY = mat("Deep navy chess material", (0.015, 0.055, 0.095, 1))
    STEEL = mat("Muted blue steel", (0.12, 0.22, 0.32, 1))
    CYAN = mat("Cyan blue highlight", (0.08, 0.50, 0.75, 1))
    WOOD = mat("Dark wood", (0.18, 0.09, 0.035, 1))
    LEATHER = mat("Dark leather", (0.13, 0.07, 0.035, 1))
    DARK = mat("Near black", (0.006, 0.010, 0.015, 1))

    spacing = 1.35
    pieces = [pawn, rook, knight, bishop, queen, king]
    start = -spacing * (len(pieces) - 1) / 2
    for index, factory in enumerate(pieces):
        factory(start + index * spacing)

    setup_camera()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "unit-set-procedural.blend"))


if globals().get("__RUN_PROCEDURAL_SET__", True):
    main()
