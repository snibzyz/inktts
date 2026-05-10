"""Print computed caps for each service vs max preset total."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app

for s in app.SERVICES:
    max_preset = max(b * c for _, b, c in s["presets"])
    print(f"{s['name']:20}  cap={s['max_total']:3}  max_preset={max_preset:3}  {'OK' if s['max_total'] >= max_preset else 'WARN'}")
