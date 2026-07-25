from pathlib import Path

ROOT = Path("D:/repos/chess-tactics")
SCRIPT = ROOT / "tools" / "blender" / "scenes" / "rook_v2.py"
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units" / "rook-v2" / "exports"
OUT_DIR.mkdir(parents=True, exist_ok=True)

namespace = {}
exec(SCRIPT.read_text(encoding="utf-8"), namespace)

bpy = namespace["bpy"]
clear_scene = namespace["clear_scene"]
setup_pixel_scene = namespace["setup_pixel_scene"]
make_rook = namespace["make_rook"]

clear_scene()
setup_pixel_scene()
make_rook(debug=False)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=str(OUT_DIR / "rook-v2.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
)

print(f"Exported {OUT_DIR / 'rook-v2.glb'}")
