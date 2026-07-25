import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path("D:/repos/chess-tactics")
MODEL_SCRIPT = ROOT / "tools" / "blender" / "scenes" / "unit_set_procedural.py"
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units" / "directions"
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


namespace = {"__RUN_PROCEDURAL_SET__": False}
exec(MODEL_SCRIPT.read_text(encoding="utf-8"), namespace)

clear_scene = namespace["clear_scene"]
mat = namespace["mat"]
piece_factories = {
    "pawn": namespace["pawn"],
    "rook": namespace["rook"],
    "knight": namespace["knight"],
    "bishop": namespace["bishop"],
    "queen": namespace["queen"],
    "king": namespace["king"],
}


def init_materials():
    namespace["NAVY"] = mat("Deep navy chess material", (0.015, 0.055, 0.095, 1))
    namespace["STEEL"] = mat("Muted blue steel", (0.12, 0.22, 0.32, 1))
    namespace["CYAN"] = mat("Cyan blue highlight", (0.08, 0.50, 0.75, 1))
    namespace["WOOD"] = mat("Dark wood", (0.18, 0.09, 0.035, 1))
    namespace["LEATHER"] = mat("Dark leather", (0.13, 0.07, 0.035, 1))
    namespace["DARK"] = mat("Near black", (0.006, 0.010, 0.015, 1))


def setup_camera():
    bpy.ops.object.light_add(type="AREA", location=(0, -4, 5.5))
    light = bpy.context.object
    light.name = "Direction softbox"
    light.data.energy = 520
    light.data.size = 5

    bpy.ops.object.camera_add(location=(2.6, -4.4, 3.4), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.name = "Direction render camera"
    bpy.context.scene.camera = camera
    direction = Vector((0, 0, 0.9)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.9

    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.eevee.taa_render_samples = 64


def render_piece(piece, factory):
    piece_dir = OUT_DIR / piece
    piece_dir.mkdir(parents=True, exist_ok=True)

    for direction_name, angle in DIRECTIONS.items():
        clear_scene()
        init_materials()
        group = factory(0)
        group.rotation_euler[2] = math.radians(angle)
        setup_camera()
        bpy.context.scene.render.filepath = str(piece_dir / f"{direction_name}.png")
        bpy.ops.render.render(write_still=True)


for piece, factory in piece_factories.items():
    render_piece(piece, factory)

print(f"Wrote procedural direction renders to {OUT_DIR}")
