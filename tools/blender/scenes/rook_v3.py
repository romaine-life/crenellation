import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path("D:/repos/chess-tactics")
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units" / "rook-v4-calibrated"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BOARD_CAMERA_TARGET = Vector((0, 0, 0.83))
BOARD_CAMERA_DISTANCE = 5.0
BOARD_CAMERA_ELEVATION_DEGREES = 44.1

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
STONE_DARK = None
STONE_LIGHT = None
CAP = None
EDGE = None
WOOD = None
WOOD_DARK = None
DEBUG = None
TILE_TOP = None
TILE_EDGE = None


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


def block(name, location, scale, material=None, bevel_amount=0.012):
    return cube(name, location, scale, material or STONE, bevel_amount)


def setup_board_camera(camera, ortho_scale):
    elevation = math.radians(BOARD_CAMERA_ELEVATION_DEGREES)
    horizontal = math.cos(elevation) * BOARD_CAMERA_DISTANCE
    component = horizontal / math.sqrt(2)
    camera.location = (
        BOARD_CAMERA_TARGET.x + component,
        BOARD_CAMERA_TARGET.y - component,
        BOARD_CAMERA_TARGET.z + math.sin(elevation) * BOARD_CAMERA_DISTANCE,
    )
    direction = BOARD_CAMERA_TARGET - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale


def make_tile_reference():
    # A square reference plane on the unit board basis. With the calibrated
    # camera it renders as the same diamond angle as the canonical game tile.
    pieces = []
    pieces.append(block("calibration tile top", (0, 0, -0.02), (1.28, 1.28, 0.02), TILE_TOP, 0.0))
    pieces.append(block("calibration north edge", (0, 0.64, 0.005), (1.28, 0.028, 0.02), TILE_EDGE, 0.0))
    pieces.append(block("calibration south edge", (0, -0.64, 0.005), (1.28, 0.028, 0.02), TILE_EDGE, 0.0))
    pieces.append(block("calibration east edge", (0.64, 0, 0.005), (0.028, 1.28, 0.02), TILE_EDGE, 0.0))
    pieces.append(block("calibration west edge", (-0.64, 0, 0.005), (0.028, 1.28, 0.02), TILE_EDGE, 0.0))
    group = bpy.data.objects.new("tile_orientation_reference", None)
    bpy.context.collection.objects.link(group)
    for obj in pieces:
        obj.parent = group
    return group


def make_rook(debug=False):
    pieces = []

    # V3 target: less chess-column, more miniature fortress. Keep the front gate
    # as the orientation signature, but make the whole piece read as stone.
    pieces.append(block("wide rough foundation slab", (0, 0, 0.07), (1.28, 1.28, 0.14), STONE_DARK, 0.020))
    pieces.append(block("offset base course", (0, 0, 0.22), (1.12, 1.12, 0.18), STONE, 0.018))
    pieces.append(block("upper squared base course", (0, 0, 0.40), (0.96, 0.96, 0.16), STONE_LIGHT, 0.014))
    pieces.append(block("heavy square tower body", (0, 0, 0.94), (0.86, 0.86, 0.98), STONE, 0.012))

    # Block seams: shallow physical marks so the castle remains built from stone
    # after downsampling or non-pixel rendering.
    for z in (0.62, 0.88, 1.14):
        pieces.append(block("front stone course shadow", (0, -0.438, z), (0.78, 0.012, 0.026), EDGE, 0.001))
        pieces.append(block("right stone course shadow", (0.438, 0, z), (0.012, 0.78, 0.026), EDGE, 0.001))
        pieces.append(block("left stone course shadow", (-0.438, 0, z), (0.012, 0.78, 0.022), EDGE, 0.001))
    for x in (-0.22, 0.04, 0.27):
        pieces.append(block("front vertical stone joint", (x, -0.444, 0.94), (0.014, 0.012, 0.22), EDGE, 0.001))
    for y in (-0.25, 0.02, 0.28):
        pieces.append(block("right vertical stone joint", (0.444, y, 0.98), (0.012, 0.014, 0.20), EDGE, 0.001))

    # Irregular chips and lighter stones. These are restrained so they don't turn
    # the silhouette noisy at board scale.
    for name, loc, scale, material in (
        ("front left chipped stone", (-0.31, -0.452, 0.73), (0.10, 0.014, 0.08), STONE_LIGHT),
        ("front dark missing chip", (0.22, -0.455, 1.05), (0.12, 0.015, 0.10), STONE_DARK),
        ("right light repair stone", (0.455, -0.18, 0.82), (0.014, 0.12, 0.09), STONE_LIGHT),
        ("right dark chip", (0.458, 0.26, 1.18), (0.014, 0.10, 0.10), STONE_DARK),
        ("left small nick", (-0.455, 0.14, 0.58), (0.014, 0.10, 0.07), STONE_DARK),
    ):
        pieces.append(block(name, loc, scale, material, 0.002))

    # Top platform: squarer and more like a walkable castle roof.
    pieces.append(block("massive top wall ring", (0, 0, 1.42), (1.10, 1.10, 0.18), STONE_LIGHT, 0.014))
    pieces.append(block("sunken stone courtyard", (0, 0, 1.535), (0.74, 0.74, 0.040), STONE, 0.004))
    for offset in (-0.19, 0.0, 0.19):
        pieces.append(block("courtyard north south grout", (offset, 0, 1.565), (0.012, 0.72, 0.016), EDGE, 0.001))
        pieces.append(block("courtyard east west grout", (0, offset, 1.567), (0.72, 0.012, 0.016), EDGE, 0.001))

    # Crenellations: fewer, wider, more fortress-like blocks with visible gaps.
    for dx in (-0.42, 0.42):
        for dy in (-0.42, 0.42):
            pieces.append(block("tower corner battlement", (dx, dy, 1.73), (0.27, 0.27, 0.38), CAP, 0.010))
    pieces.append(block("left wall walk", (-0.46, 0, 1.60), (0.12, 0.64, 0.18), CAP, 0.006))
    pieces.append(block("right wall walk", (0.46, 0, 1.60), (0.12, 0.64, 0.18), CAP, 0.006))
    pieces.append(block("rear raised wall walk", (0, 0.46, 1.65), (0.72, 0.12, 0.27), CAP, 0.006))
    pieces.append(block("rear high left merlon", (-0.21, 0.46, 1.87), (0.23, 0.13, 0.32), CAP, 0.008))
    pieces.append(block("rear high right merlon", (0.21, 0.46, 1.87), (0.23, 0.13, 0.32), CAP, 0.008))

    # A wider, heavier gate built into the front top wall.
    pieces.append(block("front gate left stone pier", (-0.42, -0.47, 1.54), (0.10, 0.13, 0.32), CAP, 0.004))
    pieces.append(block("front gate right stone pier", (0.42, -0.47, 1.54), (0.10, 0.13, 0.32), CAP, 0.004))
    pieces.append(block("gate dark inset void", (0, -0.485, 1.52), (0.78, 0.028, 0.46), EDGE, 0.001))
    pieces.append(block("wide wooden gate face", (0, -0.506, 1.52), (0.70, 0.030, 0.42), WOOD, 0.002))
    for dx in (-0.28, -0.14, 0, 0.14, 0.28):
        pieces.append(block("wide gate plank seam", (dx, -0.525, 1.52), (0.012, 0.012, 0.40), WOOD_DARK, 0.001))
    pieces.append(block("heavy gate iron top strap", (0, -0.532, 1.62), (0.72, 0.012, 0.038), EDGE, 0.001))
    pieces.append(block("heavy gate iron lower strap", (0, -0.532, 1.45), (0.72, 0.012, 0.034), EDGE, 0.001))

    if debug:
        pieces.append(cube("DEBUG facing marker", (0, -0.72, 1.92), (0.72, 0.045, 0.075), DEBUG, 0.006))
        pieces.append(cube("DEBUG arrow stem", (0, -0.82, 1.92), (0.09, 0.20, 0.06), DEBUG, 0.006))

    group = bpy.data.objects.new("rook_v2", None)
    bpy.context.collection.objects.link(group)
    for obj in pieces:
        obj.parent = group
    return group


def setup_scene():
    global STONE, STONE_DARK, STONE_LIGHT, CAP, EDGE, WOOD, WOOD_DARK, DEBUG
    STONE = mat("rook v3 cold blue stone", (0.030, 0.085, 0.125, 1), 0.96)
    STONE_DARK = mat("rook v3 deep cracked stone", (0.010, 0.030, 0.050, 1), 0.98)
    STONE_LIGHT = mat("rook v3 worn edge stone", (0.115, 0.205, 0.255, 1), 0.92)
    CAP = mat("rook v3 battlement stone", (0.150, 0.260, 0.315, 1), 0.94)
    EDGE = mat("rook v3 near black mortar", (0.003, 0.010, 0.018, 1), 1.0)
    WOOD = mat("rook v3 dark oaken gate", (0.205, 0.095, 0.040, 1), 0.88)
    WOOD_DARK = mat("rook v3 gate groove", (0.070, 0.032, 0.018, 1), 0.92)
    DEBUG = mat("debug facing red", (1.0, 0.04, 0.02, 1))

    bpy.ops.object.light_add(type="AREA", location=(-2.8, -4.2, 5.8))
    light = bpy.context.object
    light.name = "rook v3 cool key"
    light.data.energy = 760
    light.data.size = 4.2

    bpy.ops.object.light_add(type="POINT", location=(2.8, 2.8, 2.4))
    rim = bpy.context.object
    rim.name = "rook v3 cyan rim"
    rim.data.energy = 70
    rim.data.color = (0.35, 0.78, 1.0)

    bpy.ops.object.camera_add(rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.name = "rook direction camera"
    bpy.context.scene.camera = camera
    setup_board_camera(camera, 2.74)

    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.eevee.taa_render_samples = 64


def setup_pixel_scene():
    global STONE, STONE_DARK, STONE_LIGHT, CAP, EDGE, WOOD, WOOD_DARK, DEBUG, TILE_TOP, TILE_EDGE
    STONE = flat_mat("pixel rook v3 deep stone", (0.020, 0.080, 0.115, 1))
    STONE_DARK = flat_mat("pixel rook v3 dark stone", (0.006, 0.025, 0.040, 1))
    STONE_LIGHT = flat_mat("pixel rook v3 worn stone", (0.150, 0.245, 0.285, 1))
    CAP = flat_mat("pixel rook v3 cap stone", (0.230, 0.330, 0.360, 1))
    EDGE = flat_mat("pixel rook v3 black mortar", (0.003, 0.011, 0.016, 1))
    WOOD = flat_mat("pixel rook v3 wooden gate", (0.230, 0.110, 0.048, 1))
    WOOD_DARK = flat_mat("pixel rook v3 gate dark groove", (0.065, 0.030, 0.016, 1))
    DEBUG = flat_mat("pixel debug facing red", (1.0, 0.04, 0.02, 1))
    TILE_TOP = flat_mat("calibration translucent grass top", (0.17, 0.38, 0.12, 0.32))
    TILE_EDGE = flat_mat("calibration cyan tile edge", (0.20, 0.82, 1.0, 0.86))

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

    bpy.ops.object.camera_add(rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.name = "pixel direction camera"
    bpy.context.scene.camera = camera
    setup_board_camera(camera, 2.56)

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
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "rook-v4-calibrated.blend"))

    clear_scene()
    setup_scene()
    make_rook(debug=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "rook-v4-calibrated-debug.blend"))

    clear_scene()
    setup_pixel_scene()
    make_tile_reference()
    make_rook(debug=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "rook-v4-calibration.blend"))


if globals().get("__ROOK_V2_RENDER__", False):
    render_set(debug=False)
    render_set(debug=True)
elif globals().get("__ROOK_V2_PIXEL_RENDER__", False):
    render_pixel_set(debug=False)
    render_pixel_set(debug=True)
else:
    build_preview_scene()
