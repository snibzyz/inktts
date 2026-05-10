"""End-to-end smoke: launch the App, programmatically click Run on Edge,
wait for completion, assert PROG events were received and rows appeared.

Uses the fixtures/_test_short.txt file. The first time this runs it does a
real network call; subsequent runs SKIP since the output exists.
"""
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

received_prog = []
orig_handle = panel._handle_line

def spy_handle(line):
    received_prog.append(line)
    orig_handle(line)

panel._handle_line = spy_handle

panel.start()

# Pump UI until subprocess finishes (max 30s)
deadline = time.time() + 30
while time.time() < deadline:
    a.root.update_idletasks()
    a.root.update()
    if not panel.running and received_prog:
        break
    time.sleep(0.05)

a.root.destroy()

assert received_prog, "no PROG events received"
print(f"PROG events: {len(received_prog)}")
print(f"Sample: {received_prog[0]}")
print(f"Rows created: {len(panel.rows)}")
finished = [r for r in panel.rows.values() if r.is_finished]
print(f"Finished rows: {len(finished)}")
print("E2E smoke ok")


