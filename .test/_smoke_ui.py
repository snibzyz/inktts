"""Smoke test: instantiate App, render once, then auto-close."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_dark

a = app_dark.App()
# switch through every panel
for svc in app_dark.SERVICES:
    a._select(svc["key"])
    a.root.update_idletasks()
    a.root.update()

a.root.after(800, a.root.destroy)
a.root.mainloop()
print("UI smoke test ok")


