"""Smoke: verify MergePanel renders + sidebar contains 'merge' entry."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app

a = app.App()
# Switch through every panel including merge
for k in list(a.panels.keys()):
    a._select(k)
    a.root.update_idletasks()
    a.root.update()

assert "merge" in a.panels, "merge panel missing"
mp = a.panels["merge"]
assert hasattr(mp, "src_var") and hasattr(mp, "preview_lbl"), "merge panel not built"

# Auto-detect smoke — point at output/edge if exists
src = app.APP_ROOT / "output" / "edge"
if src.exists():
    mp.src_var.set(str(src))
    mp._auto_detect()
    print("Detected:", mp.detected_lbl.cget("text"))

a.root.after(500, a.root.destroy)
a.root.mainloop()
print("Merge panel smoke ok")
