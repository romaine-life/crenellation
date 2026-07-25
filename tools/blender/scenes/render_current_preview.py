from pathlib import Path

import bpy


ROOT = Path("D:/repos/chess-tactics")
OUT_DIR = ROOT / "docs" / "art" / "unit-concepts" / "blender-units"
OUT_DIR.mkdir(parents=True, exist_ok=True)

bpy.context.scene.render.filepath = str(OUT_DIR / "unit-set-procedural-preview.png")
bpy.ops.render.render(write_still=True)
print(f"Wrote {OUT_DIR / 'unit-set-procedural-preview.png'}")
