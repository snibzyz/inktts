"""End-to-end real run smoke test: in-process Edge TTS on _test_short.txt."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_dark

a = app_dark.App()
panel = a.panels["edge"]
panel.pattern_var.set(str(Path(__file__).resolve().parent / "fixtures" / "_test_short.txt"))
panel.n_files_var.set(0)
panel._refresh_count()

panel.start()

# Pump UI until subprocess finishes (max 60s)
deadline = time.time() + 60
while time.time() < deadline:
    a.root.update_idletasks()
    a.root.update()
    if not panel.running and panel.rows:
        break
    time.sleep(0.05)

a.root.destroy()

print("Rows:", {n: r.status for n, r in panel.rows.items()})
out = app_dark.APP_ROOT / "output" / "edge" / "_test_short.m4a"
print(f"Output exists: {out.exists()}, size: {out.stat().st_size if out.exists() else 'N/A'}")
print("E2E real run ok" if out.exists() else "E2E real run FAILED")


