"""Real merge run via MergePanel — concat existing 401-405 m4a → 1 file."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app

a = app.App()
mp = a.panels["merge"]
src = app.APP_ROOT / "output" / "edge"
mp.src_var.set(str(src))
mp.prefix_var.set("ติดหนี้สามสิบล้าน ")
mp.start_var.set(401)
mp.end_var.set(405)
mp.group_var.set(5)
mp.ext_var.set("m4a")
mp._refresh_preview()

# Clean prev output
dst = src.with_name(src.name + "_merged")
out_file = dst / "ติดหนี้สามสิบล้าน 401-405.m4a"
if out_file.exists():
    out_file.unlink()

mp.start()

# Pump UI until completion (max 30s)
deadline = time.time() + 30
while time.time() < deadline:
    a.root.update_idletasks()
    a.root.update()
    if not mp.running:
        break
    time.sleep(0.05)
a.root.destroy()

print(f"Output exists: {out_file.exists()}")
if out_file.exists():
    print(f"Size: {out_file.stat().st_size:,} bytes")
print("Merge run ok" if out_file.exists() else "Merge run FAILED")
