import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path("D:/repos/chess-tactics")
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units" / "rook-v2"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DIRECTIONS = {
    "north": 180,
    "north-east": 135,
    "east": 90,
    "south-east": 45,
    "south": 0,
    "south-west": -45,
    "west": -90,
    "north-west": -135,
}


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


def flat_mat(name, color):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    shader = nodes.new(type="ShaderNodeBsdfDiffuse")
    shader.inputs["Color"].default_value = color
    shader.inputs["Roughness"].default_value = 1.0
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


STONE = None
CAP = None
EDGE = None
WOOD = None
DEBUG = None


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def bevel(obj, amount=0.035, segments=2):
    mod = obj.modifiers.new("soft bevel", "BEVEL")
    mod.width = amount
    mod.segments = segments
    mod.affect = "EDGES"
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def cube(name, location, scale, material, bevel_amount=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    assign(obj, material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(obj, bevel_amount, 2)
    return obj


def make_rook(debug=False):
    pieces = []

    # Accepted concept target: stout square castle tower, broad base, integrated
    # wooden gate on the front parapet, visible floor tiles, and heavy corners.
    pieces.append(cube("broad bottom plinth", (0, 0, 0.07), (1.12, 1.12, 0.14), STONE, 0.035))
    pieces.append(cube("stepped lower plinth", (0, 0, 0.22), (0.98, 0.98, 0.16), CAP, 0.032))
    pieces.append(cube("upper base course", (0, 0, 0.38), (0.82, 0.82, 0.15), STONE, 0.026))
    pieces.append(cube("square tower shaft", (0, 0, 0.91), (0.76, 0.76, 0.92), STONE, 0.024))

    # Stone block courses on the front/side faces. They are geometry because the
    # pixel-first render needs readable marks before any paintover.
    pieces.append(cube("front lower course seam", (0, -0.386, 0.70), (0.72, 0.014, 0.024), EDGE, 0.001))
    pieces.append(cube("right lower course seam", (0.386, 0, 0.70), (0.014, 0.72, 0.024), EDGE, 0.001))
    pieces.append(cube("front center block seam", (0.005, -0.390, 0.92), (0.016, 0.018, 0.38), EDGE, 0.001))
    pieces.append(cube("right center block seam", (0.390, 0.005, 0.92), (0.018, 0.016, 0.38), EDGE, 0.001))

    # Top platform and floor.
    pieces.append(cube("top stone slab", (0, 0, 1.41), (1.00, 1.00, 0.17), CAP, 0.024))
    pieces.append(cube("sunken tiled floor", (0, 0, 1.515), (0.68, 0.68, 0.045), STONE, 0.010))
    for offset in (-0.115, 0.115):
        pieces.append(cube("top floor north south grout", (offset, 0, 1.545), (0.018, 0.66, 0.018), EDGE, 0.001))
        pieces.append(cube("top floor east west grout", (0, offset, 1.547), (0.66, 0.018, 0.018), EDGE, 0.001))

    # Heavy corner towers and parapets. Rear wall is intentionally taller so the
    # rook has an orientation signature even without the front gate visible.
    for dx in (-0.41, 0.41):
        for dy in (-0.41, 0.41):
            pieces.append(cube("chunky corner merlon", (dx, dy, 1.72), (0.22, 0.22, 0.38), CAP, 0.018))
    for x in (-0.16, 0.16):
        pieces.append(cube("rear center merlon", (x, 0.43, 1.76), (0.21, 0.14, 0.35), CAP, 0.014))
    pieces.append(cube("left parapet rail", (-0.43, 0, 1.61), (0.12, 0.66, 0.18), CAP, 0.012))
    pieces.append(cube("right parapet rail", (0.43, 0, 1.61), (0.12, 0.66, 0.18), CAP, 0.012))
    pieces.append(cube("rear parapet rail", (0, 0.43, 1.61), (0.70, 0.12, 0.18), CAP, 0.012))

    # Inset wooden gate: flush with the front parapet instead of hanging out as a
    # sign. Stone posts frame it like the accepted concept.
    pieces.append(cube("front parapet left post", (-0.36, -0.43, 1.58), (0.13, 0.12, 0.24), CAP, 0.010))
    pieces.append(cube("front parapet right post", (0.36, -0.43, 1.58), (0.13, 0.12, 0.24), CAP, 0.010))
    pieces.append(cube("front gate backing shadow", (0, -0.436, 1.535), (0.60, 0.024, 0.44), EDGE, 0.002))
    pieces.append(cube("inset wooden gate", (0, -0.452, 1.535), (0.54, 0.028, 0.40), WOOD, 0.004))
    for dx in (-0.20, -0.10, 0, 0.10, 0.20):
        pieces.append(cube("vertical gate plank seam", (dx, -0.470, 1.535), (0.010, 0.012, 0.38), EDGE, 0.001))
    pieces.append(cube("gate iron upper band", (0, -0.474, 1.61), (0.56, 0.010, 0.030), EDGE, 0.001))
    pieces.append(cube("gate iron lower band", (0, -0.474, 1.47), (0.56, 0.010, 0.026), EDGE, 0.001))

    if debug:
        pieces.append(cube("DEBUG facing marker", (0, -0.72, 1.92), (0.72, 0.045, 0.075), DEBUG, 0.006))
        pieces.append(cube("DEBUG arrow stem", (0, -0.82, 1.92), (0.09, 0.20, 0.06), DEBUG, 0.006))

    group = bpy.data.objects.new("rook_v2", None)
    bpy.context.collection.objects.link(group)
    for obj in pieces:
        obj.parent = group
    return group


def setup_scene():
    global STONE, CAP, EDGE, WOOD, DEBUG
    STONE = mat("rook deep blue stone", (0.018, 0.060, 0.100, 1))
    CAP = mat("rook muted blue top stone", (0.105, 0.210, 0.295, 1))
    EDGE = mat("near black blue detail", (0.005, 0.015, 0.025, 1))
    WOOD = mat("dark wooden gate", (0.185, 0.085, 0.035, 1))
    DEBUG = mat("debug facing red", (1.0, 0.04, 0.02, 1))

    bpy.ops.object.light_add(type="AREA", location=(0, -4, 5.4))
    light = bpy.context.object
    light.name = "rook softbox"
    light.data.energy = 620
    light.data.size = 5

    bpy.ops.object.camera_add(location=(2.5, -4.4, 3.3), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.name = "rook direction camera"
    bpy.context.scene.camera = camera
    direction = Vector((0, 0, 0.83)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.55

    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.eevee.taa_render_samples = 64


def setup_pixel_scene():
    global STONE, CAP, EDGE, WOOD, DEBUG
    STONE = flat_mat("pixel rook deep stone", (0.015, 0.070, 0.105, 1))
    CAP = flat_mat("pixel rook cap stone", (0.210, 0.305, 0.335, 1))
    EDGE = flat_mat("pixel near black detail", (0.003, 0.011, 0.016, 1))
    WOOD = flat_mat("pixel dark wooden gate", (0.215, 0.105, 0.045, 1))
    DEBUG = flat_mat("pixel debug facing red", (1.0, 0.04, 0.02, 1))

    bpy.ops.object.light_add(type="SUN", location=(-2.5, -4.0, 7.0))
    sun = bpy.context.object
    sun.name = "pixel hard key"
    sun.rotation_euler = (math.radians(42), 0, math.radians(-32))
    sun.data.energy = 1.45
    sun.data.use_shadow = False

    bpy.ops.object.light_add(type="AREA", location=(-2.4, -3.8, 4.0))
    fill = bpy.context.object
    fill.name = "pixel soft fill"
    fill.data.energy = 90
    fill.data.size = 5.0
    fill.data.use_shadow = False

    bpy.ops.object.camera_add(location=(2.5, -4.4, 3.3), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.name = "pixel direction camera"
    bpy.context.scene.camera = camera
    direction = Vector((0, 0, 0.83)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.36

    scene = bpy.context.scene
    scene.render.resolution_x = 160
    scene.render.resolution_y = 160
    scene.render.film_transparent = True
    scene.render.filter_size = 0.01
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"

    eevee = getattr(scene, "eevee", None)
    if eevee:
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = 8
        if hasattr(eevee, "use_gtao"):
            eevee.use_gtao = False


def render_set(debug=False):
    variant_dir = OUT_DIR / ("debug" if debug else "clean")
    variant_dir.mkdir(parents=True, exist_ok=True)
    for direction_name, angle in DIRECTIONS.items():
        clear_scene()
        setup_scene()
        rook = make_rook(debug=debug)
        rook.rotation_euler[2] = math.radians(angle)
        bpy.context.scene.render.filepath = str(variant_dir / f"{direction_name}.png")
        bpy.ops.render.render(write_still=True)


def render_pixel_set(debug=False):
    variant_dir = OUT_DIR / "pixel-first" / ("debug" if debug else "clean")
    variant_dir.mkdir(parents=True, exist_ok=True)
    for direction_name, angle in DIRECTIONS.items():
        clear_scene()
        setup_pixel_scene()
        rook = make_rook(debug=debug)
        rook.rotation_euler[2] = math.radians(angle)
        bpy.context.scene.render.filepath = str(variant_dir / f"{direction_name}.png")
        bpy.ops.render.render(write_still=True)


def build_preview_scene():
    clear_scene()
    setup_scene()
    make_rook(debug=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "rook-v2.blend"))

    clear_scene()
    setup_scene()
    make_rook(debug=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "rook-v2-debug.blend"))


if globals().get("__ROOK_V2_RENDER__", False):
    render_set(debug=False)
    render_set(debug=True)
elif globals().get("__ROOK_V2_PIXEL_RENDER__", False):
    render_pixel_set(debug=False)
    render_pixel_set(debug=True)
else:
    build_preview_scene()
