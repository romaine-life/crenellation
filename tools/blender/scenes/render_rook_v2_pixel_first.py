from pathlib import Path

ROOT = Path("D:/repos/chess-tactics")
SCRIPT = ROOT / "tools" / "blender" / "scenes" / "rook_v2.py"

namespace = {"__ROOK_V2_PIXEL_RENDER__": True}
exec(SCRIPT.read_text(encoding="utf-8"), namespace)
