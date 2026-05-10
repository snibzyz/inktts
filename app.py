"""INKTTS — โปรแกรมแปลงข้อความเป็นเสียงภาษาไทย (Dark UI).

หน้าตา UI อิง INKIDEA / VS Code Dark+. รันได้ 2 วิธี:

  python app.py                        # ระหว่างพัฒนา
  pyinstaller INKTTS.spec --noconfirm  # build → dist/INKTTS.exe

สคริปต์ TTS ทั้ง 3 ตัว (Edge / Google / ResponsiveVoice) ถูกเรียกแบบ
in-process (รันในเธรดเดียวกับ GUI) ทำให้ .exe ไม่ต้องพึ่งล่าม Python
ภายนอก และฝัง ffmpeg เข้ามาในตัวด้วย.
"""
from __future__ import annotations

import glob
import importlib.util
import io
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
import warnings
from pathlib import Path

import customtkinter as ctk

# ─── Paths ────────────────────────────────────────────────────────────────────
# When frozen by PyInstaller, sys._MEIPASS holds the bundle dir; the user-visible
# app dir (where input/output/scripts live) is alongside the .exe.
def _app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


APP_ROOT = _app_root()
INPUT_DIR = APP_ROOT / "input"
OUTPUT_DIR = APP_ROOT / "output"
CACHE_DIR = APP_ROOT / "_cache"
SCRIPTS_DIR = APP_ROOT / "scripts"

# When frozen, scripts/ is bundled inside the .exe (sys._MEIPASS) and ffmpeg.exe
# next to it. Fall back to project layout in dev.
def _bundle_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", APP_ROOT))


def _bundled_scripts_dir() -> Path:
    return _bundle_dir() / "scripts"


def _bundled_ffmpeg() -> Path | None:
    """Return path to bundled ffmpeg.exe, or None if not bundled."""
    candidate = _bundle_dir() / "ffmpeg.exe"
    if candidate.exists():
        return candidate
    # Also support "ffmpeg" subfolder layout
    sub = _bundle_dir() / "ffmpeg" / "ffmpeg.exe"
    if sub.exists():
        return sub
    return None


# Make the bundled ffmpeg.exe discoverable on PATH for shutil.which() lookups
# inside the script modules. Prepending the bundle dir is safe — it just adds
# the location, doesn't override system installs.
_ff = _bundled_ffmpeg()
if _ff:
    os.environ["PATH"] = str(_ff.parent) + os.pathsep + os.environ.get("PATH", "")

# Add scripts/ (bundled or local) to sys.path so `from _lib import …` works
_scripts_path = str(_bundled_scripts_dir() if (_bundled_scripts_dir().exists()) else SCRIPTS_DIR)
if _scripts_path and _scripts_path not in sys.path:
    sys.path.insert(0, _scripts_path)


def _load_script_module(filename: str):
    """Import a script file by absolute path, sidestepping name collisions
    (e.g. `google` vs the google PyPI package)."""
    src = (Path(_scripts_path) / filename).resolve()
    name = f"_inktts_runner_{src.stem}"
    spec = importlib.util.spec_from_file_location(name, src)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {src}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# One TTS run at a time across the whole app — the worker mutates global state
# (sys.argv, sys.stdout, CWD), so concurrent runs would clobber each other.
_RUN_LOCK = threading.Lock()

# ─── Palette (VS Code Dark+ — same tokens as INKIDEA) ────────────────────────
C = {
    "bg":            "#1e1e1e",   # editor background
    "sidebar":       "#181818",   # activity bar / left rail
    "panel":         "#252526",   # raised cards
    "panel_hi":      "#2d2d2d",   # tab inactive
    "input":         "#313131",
    "hover":         "#2a2d2e",
    "selected":      "#37373d",
    "border":        "#2b2b2b",
    "border_input":  "#3c3c3c",
    "accent":        "#007acc",   # status bar
    "accent_btn":    "#0e639c",   # button bg
    "accent_btn_hi": "#1177bb",   # button hover
    "accent_focus":  "#007fd4",
    "text":          "#cccccc",
    "text_bright":   "#ffffff",
    "text_dim":      "#8c8c8c",
    "text_muted":    "#6e6e6e",
    "ok":            "#89d185",
    "warn":          "#cca700",
    "fail":          "#f48771",
    "track":         "#3a3a3a",
}

def _pick_font(installed: set[str]) -> str:
    """Choose the best available UI font per platform.

    Windows ships Tahoma — preferred (matches INKIDEA's --vscode-font-family).
    macOS doesn't ship Tahoma, falls back to SF Pro Text / Helvetica Neue.
    Linux usually has DejaVu Sans; we also try Tahoma if a user has it installed.
    """
    if sys.platform == "darwin":
        candidates = ("Tahoma", "SF Pro Text", ".SF NS Text", "Helvetica Neue", "Helvetica")
    elif sys.platform.startswith("win"):
        candidates = ("Tahoma", "Segoe UI")
    else:
        candidates = ("Tahoma", "DejaVu Sans", "Liberation Sans", "Noto Sans Thai")
    for c in candidates:
        if c in installed:
            return c
    return candidates[0]  # let Tk substitute if none match exactly


# Resolve font lazily — needs a Tk root for font.families(). The App constructor
# sets the real value before any widget is built. This module-level default lets
# imports succeed without a display.
FONT = "Tahoma"

# ─── Service definitions ─────────────────────────────────────────────────────
EDGE_PRESETS = [
    ("⚡ 1 ไฟล์เร็วสุด", 1, 48),
    ("👥 5 ไฟล์เสร็จพร้อมกัน", 5, 8),
    ("⭐ 10 ไฟล์เสร็จพร้อมกัน (แนะนำ)", 10, 2),
    ("👥 20 ไฟล์เสร็จพร้อมกัน", 20, 2),
    ("👥 50 ไฟล์เสร็จพร้อมกัน", 50, 1),
    ("🛡 ปลอดภัย (กัน throttle)", 4, 1),
]
GOOGLE_PRESETS = [
    ("⚡ 1 ไฟล์เร็วสุด", 1, 6),
    ("⭐ 10 ไฟล์เสร็จพร้อมกัน (แนะนำ)", 10, 2),
    ("👥 6 ไฟล์เสร็จพร้อมกัน", 6, 1),
    ("👥 8 ไฟล์เสร็จพร้อมกัน", 8, 1),
    ("🛡 ปลอดภัย", 4, 1),
]
RV_PRESETS = [
    ("⚡ 1 ไฟล์เร็วสุด", 1, 6),
    ("⭐ 8 ไฟล์เสร็จพร้อมกัน (แนะนำ)", 8, 1),
    ("👥 6 ไฟล์เสร็จพร้อมกัน", 6, 1),
    ("🛡 ปลอดภัย", 3, 1),
]

SERVICES = [
    {
        "key":      "edge",
        "icon":     "⭐",
        "name":     "Edge",
        "title":    "Microsoft Edge — เสียง Premwadee Neural",
        "subtitle": "เสียงคุณภาพสูง · ฟรี · ไม่ต้องใช้ API key",
        "script":   SCRIPTS_DIR / "edge.py",
        "output":   "output/edge",
        "max_total": 56,
        "presets":  EDGE_PRESETS,
        "default_preset": 2,
        "fields": [
            {"name": "voice", "kind": "combo", "label": "เสียงพากย์", "default": "th-TH-PremwadeeNeural",
             "options": ["th-TH-PremwadeeNeural", "th-TH-NiwatNeural"]},
            {"name": "rate", "kind": "entry", "label": "ความเร็ว", "default": "+30%"},
            {"name": "lines-per-chunk", "kind": "spinbox", "label": "บรรทัด/ส่วน", "default": 1,
             "from_": 1, "to": 50},
        ],
    },
    {
        "key":      "google",
        "icon":     "🌐",
        "name":     "Google",
        "title":    "Google Translate — เสียงภาษาไทย",
        "subtitle": "เสียงปกติ · ฟรี · ไม่ต้องใช้ API key · เสถียรที่สุด",
        "script":   SCRIPTS_DIR / "google.py",
        "output":   "output/google",
        "max_total": 8,
        "presets":  GOOGLE_PRESETS,
        "default_preset": 1,
        "fields": [
            {"name": "tempo", "kind": "scale", "label": "ความเร็วเสียง", "default": 1.3,
             "from_": 0.5, "to": 2.0},
            {"name": "chunk-chars", "kind": "spinbox", "label": "ตัวอักษร/ส่วน", "default": 120,
             "from_": 50, "to": 200},
            {"name": "jitter", "kind": "scale", "label": "หน่วงสุ่ม", "default": 0.1,
             "from_": 0.0, "to": 1.0},
        ],
    },
    {
        "key":      "rv",
        "icon":     "🎙",
        "name":     "ResponsiveVoice",
        "title":    "ResponsiveVoice — เลือกเพศได้",
        "subtitle": "เสียงปกติ · ฟรี · เลือกเพศชาย/หญิงได้",
        "script":   SCRIPTS_DIR / "responsivevoice.py",
        "output":   "output/responsivevoice",
        "max_total": 8,
        "presets":  RV_PRESETS,
        "default_preset": 1,
        "fields": [
            {"name": "gender", "kind": "combo", "label": "เพศของเสียง", "default": "female",
             "options": ["female", "male"]},
            {"name": "tempo", "kind": "scale", "label": "ความเร็วเสียง", "default": 1.3,
             "from_": 0.5, "to": 2.0},
            {"name": "chunk-chars", "kind": "spinbox", "label": "ตัวอักษร/ส่วน", "default": 100,
             "from_": 50, "to": 100},
        ],
    },
]


# ─── Helpers ─────────────────────────────────────────────────────────────────
def hairline(parent, color=None, height=1):
    """A 1px horizontal divider."""
    f = tk.Frame(parent, bg=color or C["border"], height=height, bd=0, highlightthickness=0)
    return f


def label(parent, text, *, font_size=13, weight="normal", fg=None, bg=None):
    return ctk.CTkLabel(
        parent, text=text,
        font=(FONT, font_size, weight),
        text_color=fg or C["text"],
        fg_color=bg if bg is not None else "transparent",
    )


# ─── FileRow — one row in progress list ──────────────────────────────────────
class FileRow:
    STATUS_TEXT = {
        "WORK": "…", "DONE": "✓", "FAIL": "✗", "FFMPEG_FAIL": "✗ ffmpeg",
        "SKIP": "skip", "EMPTY": "empty",
    }

    def __init__(self, parent, name: str, total: int):
        self.name = name
        self.total = max(1, total)
        self.start = time.time()
        self.end: float | None = None
        self.status = "WORK"

        self.row = ctk.CTkFrame(parent, fg_color=C["panel"], corner_radius=4, border_width=1,
                                border_color=C["border"])
        self.row.pack(fill="x", padx=6, pady=2)

        inner = ctk.CTkFrame(self.row, fg_color="transparent")
        inner.pack(fill="x", padx=10, pady=6)

        top = ctk.CTkFrame(inner, fg_color="transparent")
        top.pack(fill="x")
        self.name_lbl = label(top, self._fmt_name(name), font_size=12, weight="bold")
        self.name_lbl.pack(side="left")
        self.status_lbl = label(top, "0%", font_size=11, fg=C["text_dim"])
        self.status_lbl.pack(side="right")

        bot = ctk.CTkFrame(inner, fg_color="transparent")
        bot.pack(fill="x", pady=(4, 0))
        self.bar = ctk.CTkProgressBar(bot, height=6, corner_radius=3,
                                      progress_color=C["accent"], fg_color=C["track"],
                                      border_width=0)
        self.bar.set(0)
        self.bar.pack(side="left", fill="x", expand=True)
        self.count_lbl = label(bot, f"0/{self.total}", font_size=10, fg=C["text_muted"])
        self.count_lbl.pack(side="left", padx=(8, 0))
        self.elapsed_lbl = label(bot, "0.0s", font_size=10, fg=C["text_muted"])
        self.elapsed_lbl.pack(side="left", padx=(6, 0))

    def _fmt_name(self, name: str) -> str:
        return name if len(name) <= 50 else name[:47] + "…"

    def update(self, status: str, done: int):
        self.status = status
        frac = min(1.0, done / self.total)
        self.bar.set(frac)
        self.count_lbl.configure(text=f"{done}/{self.total}")
        if status == "DONE":
            if self.end is None:
                self.end = time.time()
            self.bar.configure(progress_color=C["ok"])
            self.status_lbl.configure(text="✓", text_color=C["ok"])
        elif status in ("FAIL", "FFMPEG_FAIL"):
            if self.end is None:
                self.end = time.time()
            self.bar.configure(progress_color=C["fail"])
            self.status_lbl.configure(text=self.STATUS_TEXT.get(status, status),
                                      text_color=C["fail"])
        elif status in ("SKIP", "EMPTY"):
            if self.end is None:
                self.end = time.time()
            self.status_lbl.configure(text=self.STATUS_TEXT[status], text_color=C["text_muted"])
        else:
            pct = int(frac * 100)
            self.status_lbl.configure(text=f"{pct}%", text_color=C["text_dim"])

    def tick_elapsed(self):
        end = self.end if self.end else time.time()
        self.elapsed_lbl.configure(text=f"{end - self.start:.1f}s")

    @property
    def is_finished(self) -> bool:
        return self.end is not None


# ─── ServicePanel — one panel per TTS backend ────────────────────────────────
class ServicePanel(ctk.CTkFrame):
    def __init__(self, parent, service: dict, on_status):
        super().__init__(parent, fg_color=C["bg"])
        self.service = service
        self.on_status = on_status  # callback(text, kind) for status bar
        self.running = False
        self.event_q: queue.Queue = queue.Queue()
        self.rows: dict[str, FileRow] = {}
        self.start_time: float | None = None
        self.field_vars: dict[str, tk.Variable] = {}
        self._tick_scheduled = False
        self.stop_event: threading.Event | None = None

        self._build()

    # ---------- build ----------
    def _build(self):
        # Title block
        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=24, pady=(20, 6))
        label(head, self.service["title"], font_size=18, weight="bold",
              fg=C["text_bright"]).pack(anchor="w")
        label(head, self.service["subtitle"], font_size=12,
              fg=C["text_dim"]).pack(anchor="w", pady=(2, 0))

        hairline(self).pack(fill="x", padx=24, pady=(10, 14))

        # Configuration card
        cfg = ctk.CTkFrame(self, fg_color=C["panel"], corner_radius=6, border_width=1,
                           border_color=C["border"])
        cfg.pack(fill="x", padx=24)
        cfgi = ctk.CTkFrame(cfg, fg_color="transparent")
        cfgi.pack(fill="x", padx=18, pady=16)
        cfgi.grid_columnconfigure(1, weight=1)

        label(cfgi, "ตั้งค่าการแปลง", font_size=13, weight="bold",
              fg=C["text_bright"]).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 10))

        r = 1
        # Input pattern
        label(cfgi, "โฟลเดอร์ไฟล์เข้า").grid(row=r, column=0, sticky="w", pady=4)
        self.pattern_var = tk.StringVar(value=str(INPUT_DIR / "*.txt"))
        ent = self._entry(cfgi, self.pattern_var)
        ent.grid(row=r, column=1, sticky="we", padx=(10, 8), pady=4)
        self.count_lbl = label(cfgi, "0 ไฟล์", font_size=11, fg=C["text_dim"])
        self.count_lbl.grid(row=r, column=2, sticky="w", pady=4)
        self.pattern_var.trace_add("write", lambda *_: self._refresh_count())

        r += 1
        label(cfgi, "จำนวนไฟล์ (0 = ทั้งหมด)").grid(row=r, column=0, sticky="w", pady=4)
        self.n_files_var = tk.IntVar(value=10)
        sp = self._spinbox(cfgi, self.n_files_var, 0, 10000)
        sp.grid(row=r, column=1, sticky="w", padx=(10, 0), pady=4)

        r += 1
        # Preset
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=10)
        r += 1
        label(cfgi, "พรีเซต").grid(row=r, column=0, sticky="w", pady=4)
        preset_labels = [p[0] for p in self.service["presets"]]
        self.preset_var = tk.StringVar(value=preset_labels[self.service["default_preset"]])
        self.preset_cb = ctk.CTkComboBox(
            cfgi, values=preset_labels, variable=self.preset_var,
            state="readonly", command=self._apply_preset,
            width=320, height=30,
            font=(FONT, 12),
            dropdown_font=(FONT, 12),
            fg_color=C["input"], border_color=C["border_input"], button_color=C["panel_hi"],
            button_hover_color=C["selected"], dropdown_fg_color=C["input"],
            dropdown_text_color=C["text"], text_color=C["text"],
            dropdown_hover_color=C["selected"],
        )
        self.preset_cb.grid(row=r, column=1, columnspan=2, sticky="w", padx=(10, 0), pady=4)

        r += 1
        # Batch slider
        cap = self.service["max_total"]
        label(cfgi, "จำนวนไฟล์ต่อรอบ").grid(row=r, column=0, sticky="w", pady=(8, 4))
        b_default = self.service["presets"][self.service["default_preset"]][1]
        self.batch_var = tk.IntVar(value=b_default)
        self.batch_slider = ctk.CTkSlider(
            cfgi, from_=1, to=cap, number_of_steps=cap - 1,
            command=lambda v: self._slider_changed(self.batch_var, self.batch_lbl, v),
            progress_color=C["accent"], fg_color=C["track"],
            button_color=C["text"], button_hover_color=C["text_bright"],
            height=14,
        )
        self.batch_slider.set(b_default)
        self.batch_slider.grid(row=r, column=1, sticky="we", padx=(10, 8), pady=(8, 4))
        self.batch_lbl = label(cfgi, str(b_default), font_size=12, weight="bold",
                               fg=C["text_bright"])
        self.batch_lbl.grid(row=r, column=2, sticky="w", pady=(8, 4))

        r += 1
        label(cfgi, "การเชื่อมต่อต่อไฟล์").grid(row=r, column=0, sticky="w", pady=4)
        c_default = self.service["presets"][self.service["default_preset"]][2]
        self.conn_var = tk.IntVar(value=c_default)
        self.conn_slider = ctk.CTkSlider(
            cfgi, from_=1, to=cap, number_of_steps=cap - 1,
            command=lambda v: self._slider_changed(self.conn_var, self.conn_lbl, v),
            progress_color=C["accent"], fg_color=C["track"],
            button_color=C["text"], button_hover_color=C["text_bright"],
            height=14,
        )
        self.conn_slider.set(c_default)
        self.conn_slider.grid(row=r, column=1, sticky="we", padx=(10, 8), pady=4)
        self.conn_lbl = label(cfgi, str(c_default), font_size=12, weight="bold",
                              fg=C["text_bright"])
        self.conn_lbl.grid(row=r, column=2, sticky="w", pady=4)

        r += 1
        self.total_lbl = label(cfgi, "", font_size=11, fg=C["text_dim"])
        self.total_lbl.grid(row=r, column=0, columnspan=4, sticky="w", pady=(4, 0))

        # Service-specific fields
        r += 1
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=10)
        for fdef in self.service["fields"]:
            r += 1
            label(cfgi, fdef["label"]).grid(row=r, column=0, sticky="w", pady=4)
            self._build_field(cfgi, fdef, r)

        # Run controls
        r += 1
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=12)
        r += 1
        ctrl = ctk.CTkFrame(cfgi, fg_color="transparent")
        ctrl.grid(row=r, column=0, columnspan=4, sticky="w")
        self.run_btn = ctk.CTkButton(
            ctrl, text="▶  เริ่มแปลงเสียง", command=self.start,
            width=170, height=34, corner_radius=4,
            font=(FONT, 12, "bold"),
            fg_color=C["accent_btn"], hover_color=C["accent_btn_hi"],
            text_color=C["text_bright"],
        )
        self.run_btn.pack(side="left", padx=(0, 8))
        self.stop_btn = ctk.CTkButton(
            ctrl, text="■  หยุด", command=self.stop, state="disabled",
            width=110, height=34, corner_radius=4,
            font=(FONT, 12),
            fg_color=C["panel_hi"], hover_color=C["selected"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        )
        self.stop_btn.pack(side="left", padx=(0, 8))
        self.open_btn = ctk.CTkButton(
            ctrl, text="📂 เปิดโฟลเดอร์ผลลัพธ์", command=self._open_output,
            width=190, height=34, corner_radius=4,
            font=(FONT, 12),
            fg_color="transparent", hover_color=C["panel_hi"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        )
        self.open_btn.pack(side="left")

        # Summary bar
        ctk.CTkFrame(self, fg_color="transparent", height=14).pack()
        sumbar = ctk.CTkFrame(self, fg_color=C["panel"], corner_radius=6, border_width=1,
                              border_color=C["border"])
        sumbar.pack(fill="x", padx=24)
        sumi = ctk.CTkFrame(sumbar, fg_color="transparent")
        sumi.pack(fill="x", padx=14, pady=10)
        self.sum_main = label(sumi, "พร้อมเริ่มงาน", font_size=13, weight="bold", fg=C["text_bright"])
        self.sum_main.pack(side="left")
        self.sum_avg = label(sumi, "", font_size=11, fg=C["text_dim"])
        self.sum_avg.pack(side="left", padx=18)
        self.sum_eta = label(sumi, "", font_size=11, fg=C["text_dim"])
        self.sum_eta.pack(side="left")
        self.sum_status = label(sumi, "", font_size=11, fg=C["text_dim"])
        self.sum_status.pack(side="right")

        # Progress card (scrollable)
        ctk.CTkFrame(self, fg_color="transparent", height=10).pack()
        progress_card = ctk.CTkFrame(self, fg_color=C["panel"], corner_radius=6, border_width=1,
                                     border_color=C["border"])
        progress_card.pack(fill="both", expand=True, padx=24, pady=(0, 16))

        ph = ctk.CTkFrame(progress_card, fg_color="transparent")
        ph.pack(fill="x", padx=14, pady=(10, 4))
        label(ph, "ความคืบหน้าแต่ละไฟล์", font_size=12, weight="bold",
              fg=C["text_bright"]).pack(side="left")

        self.scroll = ctk.CTkScrollableFrame(
            progress_card, fg_color=C["bg"], corner_radius=4, border_width=0,
            scrollbar_button_color=C["panel_hi"],
            scrollbar_button_hover_color=C["selected"],
        )
        self.scroll.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        self._refresh_count()
        self._update_total()

    def _entry(self, parent, var):
        return ctk.CTkEntry(
            parent, textvariable=var, height=30, corner_radius=4,
            font=(FONT, 12),
            fg_color=C["input"], border_color=C["border_input"], text_color=C["text"],
            placeholder_text_color=C["text_muted"],
        )

    def _spinbox(self, parent, var, lo, hi):
        # CustomTkinter has no spinbox — use IntVar entry + +/- buttons
        f = ctk.CTkFrame(parent, fg_color="transparent")
        ent = ctk.CTkEntry(f, textvariable=var, width=70, height=30, corner_radius=4,
                           font=(FONT, 12),
                           fg_color=C["input"], border_color=C["border_input"],
                           text_color=C["text"], justify="center")
        ent.pack(side="left")
        def step(d):
            try:
                v = int(var.get())
            except (ValueError, tk.TclError):
                v = lo
            v = max(lo, min(hi, v + d))
            var.set(v)
        ctk.CTkButton(f, text="−", width=24, height=30, corner_radius=4,
                      font=(FONT, 14, "bold"),
                      fg_color=C["panel_hi"], hover_color=C["selected"],
                      text_color=C["text"], border_width=1, border_color=C["border_input"],
                      command=lambda: step(-1)).pack(side="left", padx=(4, 0))
        ctk.CTkButton(f, text="+", width=24, height=30, corner_radius=4,
                      font=(FONT, 14, "bold"),
                      fg_color=C["panel_hi"], hover_color=C["selected"],
                      text_color=C["text"], border_width=1, border_color=C["border_input"],
                      command=lambda: step(1)).pack(side="left", padx=(4, 0))
        return f

    def _build_field(self, parent, fdef, r):
        if fdef["kind"] == "combo":
            v = tk.StringVar(value=str(fdef["default"]))
            cb = ctk.CTkComboBox(
                parent, values=fdef["options"], variable=v, state="readonly",
                width=260, height=30, font=(FONT, 12),
                dropdown_font=(FONT, 12),
                fg_color=C["input"], border_color=C["border_input"], button_color=C["panel_hi"],
                button_hover_color=C["selected"], dropdown_fg_color=C["input"],
                dropdown_text_color=C["text"], text_color=C["text"],
                dropdown_hover_color=C["selected"],
            )
            cb.grid(row=r, column=1, columnspan=2, sticky="w", padx=(10, 0), pady=4)
            self.field_vars[fdef["name"]] = v
        elif fdef["kind"] == "scale":
            v = tk.StringVar(value=f"{float(fdef['default']):.2f}")
            box = ctk.CTkFrame(parent, fg_color="transparent")
            box.grid(row=r, column=1, columnspan=2, sticky="we", padx=(10, 0), pady=4)
            sl = ctk.CTkSlider(
                box, from_=fdef["from_"], to=fdef["to"],
                command=lambda x: v.set(f"{float(x):.2f}"),
                progress_color=C["accent"], fg_color=C["track"],
                button_color=C["text"], button_hover_color=C["text_bright"],
                height=14,
            )
            sl.set(fdef["default"])
            sl.pack(side="left", fill="x", expand=True)
            label(box, "", font_size=12, weight="bold", fg=C["text_bright"]).pack(side="left",
                                                                                  padx=(8, 0))
            # bind variable to label text via observer
            lbl = box.winfo_children()[-1]
            v.trace_add("write", lambda *_: lbl.configure(text=v.get()))
            v.set(f"{float(fdef['default']):.2f}")
            self.field_vars[fdef["name"]] = v
        elif fdef["kind"] == "spinbox":
            v = tk.IntVar(value=int(fdef["default"]))
            sb = self._spinbox(parent, v, fdef["from_"], fdef["to"])
            sb.grid(row=r, column=1, sticky="w", padx=(10, 0), pady=4)
            # store as string when sent to CLI
            sv = tk.StringVar(value=str(int(fdef["default"])))
            v.trace_add("write", lambda *_: sv.set(str(int(v.get()))))
            self.field_vars[fdef["name"]] = sv
        else:
            v = tk.StringVar(value=str(fdef["default"]))
            self._entry(parent, v).grid(row=r, column=1, sticky="w", padx=(10, 0), pady=4)
            self.field_vars[fdef["name"]] = v

    # ---------- callbacks ----------
    def _slider_changed(self, var, lbl, v):
        i = int(round(float(v)))
        var.set(i)
        lbl.configure(text=str(i))
        self._update_total()

    def _refresh_count(self):
        try:
            n = len(glob.glob(self.pattern_var.get()))
            self.count_lbl.configure(text=f"{n} ไฟล์")
        except Exception:
            self.count_lbl.configure(text="?")

    def _apply_preset(self, _label=None):
        idx = self.preset_cb.cget("values").index(self.preset_var.get())
        _, b, c = self.service["presets"][idx]
        self.batch_slider.set(b)
        self.batch_var.set(b)
        self.batch_lbl.configure(text=str(b))
        self.conn_slider.set(c)
        self.conn_var.set(c)
        self.conn_lbl.configure(text=str(c))
        self._update_total()

    def _update_total(self):
        b = int(self.batch_var.get())
        c = int(self.conn_var.get())
        total = b * c
        cap = self.service["max_total"]
        if total <= cap:
            self.total_lbl.configure(
                text=f"การเชื่อมต่อรวม: {b} × {c} = {total}  (เพดาน {cap})",
                text_color=C["text_dim"])
        else:
            self.total_lbl.configure(
                text=f"⚠ {total} เกินเพดาน API ({cap}) — ลดจำนวนไฟล์ต่อรอบหรือการเชื่อมต่อต่อไฟล์",
                text_color=C["fail"])

    def _open_output(self):
        out = APP_ROOT / self.service["output"]
        out.mkdir(parents=True, exist_ok=True)
        if sys.platform.startswith("win"):
            os.startfile(out)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(out)])
        else:
            subprocess.Popen(["xdg-open", str(out)])

    # ---------- run / stop ----------
    def start(self):
        if self.running:
            return
        files = sorted(glob.glob(self.pattern_var.get()))
        try:
            n = int(self.n_files_var.get())
        except (ValueError, tk.TclError):
            n = 0
        if n > 0:
            files = files[:n]
        if not files:
            self.sum_status.configure(text="ไม่พบไฟล์ตามรูปแบบที่ระบุ", text_color=C["fail"])
            self.on_status("ไม่พบไฟล์ตามรูปแบบที่ระบุ", "fail")
            return

        for child in list(self.scroll.winfo_children()):
            child.destroy()
        self.rows.clear()

        b = int(self.batch_var.get())
        c = int(self.conn_var.get())
        cap = self.service["max_total"]
        # Cap is a soft warning, not a hard block — some services tolerate over-cap
        # via per-request rate limiting. Original UI behavior was to allow it.
        cap_warning = (b * c > cap)

        if not _RUN_LOCK.acquire(blocking=False):
            self.sum_status.configure(
                text="มีบริการอื่นกำลังทำงานอยู่ — รอให้เสร็จก่อน",
                text_color=C["warn"])
            self.on_status("มีบริการอื่นกำลังทำงานอยู่", "warn")
            return

        # Build CLI argv exactly as the script's argparse expects.
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        out_abs = str((APP_ROOT / self.service["output"]).resolve())
        argv = [self.service["script"].name, *files,
                "-o", out_abs,
                "--batch-size", str(b),
                "--connections-per-file", str(c),
                "--workdir", str((CACHE_DIR / self.service["key"]).resolve())]
        for name, var in self.field_vars.items():
            argv.extend([f"--{name}", str(var.get())])

        self.start_time = time.time()
        self.running = True
        self.stop_event = threading.Event()
        self.sum_main.configure(text=f"กำลังรัน {len(files)} ไฟล์…", text_color=C["text_bright"])
        if cap_warning:
            self.sum_status.configure(
                text=f"⚠ {b}×{c}={b*c} เกินเพดาน {cap} — เผื่อโดน rate-limit",
                text_color=C["warn"])
        else:
            self.sum_status.configure(text="", text_color=C["text_dim"])
        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.on_status(f"กำลังแปลง {self.service['name']} · {len(files)} ไฟล์", "run")

        threading.Thread(target=self._run_in_thread,
                         args=(self.service["script"].name, argv),
                         daemon=True).start()
        if not self._tick_scheduled:
            self._tick_scheduled = True
            self.after(100, self._tick)

    def stop(self):
        # Soft stop: signal the worker, but asyncio inside the worker doesn't
        # respond to signals from another thread cleanly. The Stop button just
        # disables future submissions; current chunks finish their HTTP fetch.
        if hasattr(self, "stop_event"):
            self.stop_event.set()
        self.event_q.put("PROG\t__stop__\tWORK\t0\t0")  # nudge the tick loop

    def _run_in_thread(self, script_filename: str, argv: list[str]):
        """Run a TTS script's main() in this thread, capturing its stdout into
        the event queue. Restores sys.argv / sys.stdout on exit."""
        old_argv = sys.argv[:]
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        old_cwd = os.getcwd()

        class _QWriter(io.TextIOBase):
            def __init__(self, q):
                self.q = q
                self.buf = ""
            def write(self, s):
                self.buf += s
                while "\n" in self.buf:
                    line, self.buf = self.buf.split("\n", 1)
                    if line:
                        self.q.put(line)
                return len(s)
            def flush(self):
                pass

        try:
            os.chdir(str(APP_ROOT))
            sys.argv = argv
            sys.stdout = _QWriter(self.event_q)
            sys.stderr = sys.stdout
            try:
                mod = _load_script_module(script_filename)
                mod.main()
            except SystemExit:
                pass
            except Exception as e:
                self.event_q.put(f"[error] {type(e).__name__}: {e}")
        finally:
            sys.argv = old_argv
            sys.stdout = old_stdout
            sys.stderr = old_stderr
            try:
                os.chdir(old_cwd)
            except Exception:
                pass
            _RUN_LOCK.release()
            self.event_q.put(None)

    def _tick(self):
        finished = False
        while True:
            try:
                msg = self.event_q.get_nowait()
            except queue.Empty:
                break
            if msg is None:
                finished = True
                break
            self._handle_line(msg)
        for row in self.rows.values():
            if not row.is_finished:
                row.tick_elapsed()
        self._refresh_summary()
        if finished:
            self._on_finish()
            self._tick_scheduled = False
            return
        self.after(200, self._tick)

    def _handle_line(self, line: str):
        if not line.startswith("PROG\t"):
            return
        parts = line.split("\t")
        if len(parts) < 5:
            return
        _, base, status, done, total = parts[:5]
        try:
            d, t = int(done), int(total)
        except ValueError:
            return
        if base not in self.rows:
            self.rows[base] = FileRow(self.scroll, base, t)
        self.rows[base].update(status, d)
        self.rows[base].tick_elapsed()

    def _refresh_summary(self):
        finished = [r for r in self.rows.values() if r.is_finished]
        ok = sum(1 for r in finished if r.status == "DONE")
        fail = sum(1 for r in finished if r.status in ("FAIL", "FFMPEG_FAIL"))
        active = len(self.rows) - len(finished)
        self.sum_main.configure(
            text=f"ทั้งหมด {len(self.rows)}    ✓ {ok}    ✗ {fail}    ⏳ {active}",
            text_color=C["text_bright"],
        )
        if finished:
            durs = [(r.end - r.start) for r in finished if r.end]
            avg = sum(durs) / len(durs) if durs else 0
            self.sum_avg.configure(text=f"เฉลี่ย {avg:.1f} วินาที/ไฟล์")
            if active and avg:
                eta = avg * active / max(1, int(self.batch_var.get()))
                self.sum_eta.configure(text=f"เหลืออีก ≈ {eta:.0f} วินาที")
            else:
                self.sum_eta.configure(text="")
        else:
            self.sum_avg.configure(text="")
            self.sum_eta.configure(text="")

    def _on_finish(self):
        elapsed = time.time() - self.start_time if self.start_time else 0
        ok = sum(1 for r in self.rows.values() if r.status == "DONE")
        fail = sum(1 for r in self.rows.values() if r.status in ("FAIL", "FFMPEG_FAIL"))
        kind = "ok" if fail == 0 else "fail"
        col = C["ok"] if kind == "ok" else C["fail"]
        msg = f"เสร็จใน {elapsed:.1f} วินาที ({elapsed/60:.1f} นาที)"
        self.sum_status.configure(text=msg, text_color=col)
        self.on_status(f"{self.service['name']}: สำเร็จ {ok} · ล้มเหลว {fail} · ใช้เวลา {elapsed:.1f} วินาที", kind)
        self.run_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        self.running = False


# ─── App ─────────────────────────────────────────────────────────────────────
class App:
    def __init__(self):
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.root = ctk.CTk(fg_color=C["bg"])
        self.root.title("INKTTS — แปลงข้อความเป็นเสียง")
        self.root.geometry("1200x820")
        self.root.minsize(1024, 680)

        # Resolve and apply the UI font globally — must run AFTER root exists
        # (font.families() needs a Tk app) and BEFORE any widget is created.
        global FONT
        import tkinter.font as tkfont
        installed = set(tkfont.families(self.root))
        FONT = _pick_font(installed)
        # Override CustomTkinter's theme default — covers any widget that
        # doesn't pass an explicit `font=` (e.g. internal sub-widgets)
        try:
            ctk.ThemeManager.theme["CTkFont"]["family"] = FONT
            ctk.ThemeManager.theme["CTkFont"]["size"] = 12
        except (AttributeError, KeyError):
            pass
        self._apply_font_globally(tkfont)
        # App icon (search both project root and PyInstaller bundle dir)
        for candidate in (APP_ROOT / "inktts.ico", _bundle_dir() / "inktts.ico"):
            if candidate.exists():
                try:
                    self.root.iconbitmap(default=str(candidate))
                except Exception:
                    pass
                break

        self.panels: dict[str, ServicePanel] = {}
        self.sidebar_btns: dict[str, ctk.CTkButton] = {}
        self.active_key: str | None = None

        # Layout grid: sidebar | content ; status bar full width at bottom
        self.root.grid_rowconfigure(0, weight=1)
        self.root.grid_rowconfigure(1, weight=0)
        self.root.grid_columnconfigure(0, weight=0)
        self.root.grid_columnconfigure(1, weight=1)

        self._build_sidebar()
        self._build_content_host()
        self._build_statusbar()

        self._select(SERVICES[0]["key"])

    def _apply_font_globally(self, tkfont):
        """Force Tahoma (or platform fallback) on every Tk widget — base font,
        named system fonts, and Combobox dropdown listbox. Without this Tk
        defaults to Segoe UI 9pt (Windows) or Lucida (mac), which jumps fonts
        between widgets and looks inconsistent."""
        # Base — picked up by every plain widget option that defaults to this
        self.root.option_add("*Font", (FONT, 11))
        # Combobox dropdown is a Listbox child — it ignores the base option
        self.root.option_add("*TCombobox*Listbox*Font", (FONT, 11))
        self.root.option_add("*Menu*Font", (FONT, 11))
        # Override Tk's named system fonts so any widget falling back inherits
        for name, size in (
            ("TkDefaultFont", 11), ("TkTextFont", 11), ("TkMenuFont", 11),
            ("TkHeadingFont", 11), ("TkCaptionFont", 12), ("TkSmallCaptionFont", 10),
            ("TkIconFont", 11), ("TkTooltipFont", 10), ("TkFixedFont", 11),
        ):
            try:
                tkfont.nametofont(name).configure(family=FONT, size=size)
            except tk.TclError:
                pass

    def _build_sidebar(self):
        side = ctk.CTkFrame(self.root, fg_color=C["sidebar"], corner_radius=0, width=200)
        side.grid(row=0, column=0, sticky="nsw")
        side.grid_propagate(False)

        # Header (app name)
        hdr = ctk.CTkFrame(side, fg_color="transparent")
        hdr.pack(fill="x", padx=14, pady=(16, 6))
        label(hdr, "INKTTS", font_size=15, weight="bold",
              fg=C["text_bright"]).pack(anchor="w")
        label(hdr, "แปลงข้อความเป็นเสียง", font_size=10,
              fg=C["text_muted"]).pack(anchor="w", pady=(0, 6))

        hairline(side, color="#2b2b2b").pack(fill="x", padx=10, pady=4)

        # Section label
        label(side, "  เลือกบริการ TTS", font_size=10, weight="bold",
              fg=C["text_muted"]).pack(anchor="w", padx=14, pady=(10, 4))

        # Service buttons
        for svc in SERVICES:
            btn = ctk.CTkButton(
                side,
                text=f"  {svc['icon']}   {svc['name']}",
                anchor="w",
                command=lambda k=svc["key"]: self._select(k),
                height=36, corner_radius=4,
                font=(FONT, 12, "bold"),
                fg_color="transparent",
                hover_color=C["hover"],
                text_color=C["text"],
            )
            btn.pack(fill="x", padx=8, pady=2)
            self.sidebar_btns[svc["key"]] = btn

        # Spacer + footer
        ctk.CTkFrame(side, fg_color="transparent").pack(fill="both", expand=True)
        hairline(side, color="#2b2b2b").pack(fill="x", padx=10, pady=4)
        foot = ctk.CTkFrame(side, fg_color="transparent")
        foot.pack(fill="x", padx=14, pady=10)
        label(foot, "ไฟล์เข้า  →  เสียงออก", font_size=10,
              fg=C["text_muted"]).pack(anchor="w")
        label(foot, "edge-tts · ffmpeg", font_size=10,
              fg=C["text_muted"]).pack(anchor="w")

    def _build_content_host(self):
        self.host = ctk.CTkFrame(self.root, fg_color=C["bg"], corner_radius=0)
        self.host.grid(row=0, column=1, sticky="nsew")
        self.host.grid_rowconfigure(0, weight=1)
        self.host.grid_columnconfigure(0, weight=1)

        # Build panels (only one shown via grid)
        for svc in SERVICES:
            panel = ServicePanel(self.host, svc, on_status=self._set_status)
            panel.grid(row=0, column=0, sticky="nsew")
            self.panels[svc["key"]] = panel

    def _build_statusbar(self):
        self.statusbar = ctk.CTkFrame(self.root, fg_color=C["accent"], corner_radius=0,
                                      height=24)
        self.statusbar.grid(row=1, column=0, columnspan=2, sticky="ew")
        self.statusbar.grid_propagate(False)
        self.status_lbl = label(self.statusbar, "● พร้อมใช้งาน", font_size=11,
                                fg=C["text_bright"], bg=C["accent"])
        self.status_lbl.pack(side="left", padx=12)
        self.status_right = label(self.statusbar, f"{APP_ROOT}",
                                  font_size=11, fg=C["text_bright"], bg=C["accent"])
        self.status_right.pack(side="right", padx=12)

    def _select(self, key: str):
        for k, btn in self.sidebar_btns.items():
            active = (k == key)
            btn.configure(
                fg_color=C["selected"] if active else "transparent",
                hover_color=C["selected"] if active else C["hover"],
                text_color=C["text_bright"] if active else C["text"],
            )
        self.panels[key].tkraise()
        self.active_key = key

    def _set_status(self, text: str, kind: str = "info"):
        # Recolor entire status bar based on kind
        bg = {
            "ok":   "#16825d",
            "fail": "#a1260d",
            "warn": "#cca700",
            "run":  C["accent"],
            "info": C["accent"],
        }.get(kind, C["accent"])
        self.statusbar.configure(fg_color=bg)
        self.status_lbl.configure(fg_color=bg, text=f"● {text}")
        self.status_right.configure(fg_color=bg)

    def run(self):
        self.root.mainloop()


def _maybe_autorun_test(app: "App"):
    """Hidden self-test mode: when launched as `INKTTS.exe --self-test SERVICE
    PATTERN`, programmatically click Run on the given service, wait for
    completion, write a result file, and quit. Used to validate the .exe build.
    """
    if "--self-test" not in sys.argv:
        return
    try:
        i = sys.argv.index("--self-test")
        svc_key = sys.argv[i + 1]
        pattern = sys.argv[i + 2]
        result_path = sys.argv[i + 3]
    except (IndexError, ValueError):
        return

    panel = app.panels[svc_key]
    panel.pattern_var.set(pattern)
    panel.n_files_var.set(0)
    panel._refresh_count()

    log_lines: list[str] = []
    orig_handle = panel._handle_line
    def spy(line: str):
        log_lines.append(line)
        orig_handle(line)
    panel._handle_line = spy

    deadline = [time.time() + 90]

    def kick_off():
        panel.start()
        app.root.after(500, _check)

    def _check():
        timed_out = time.time() > deadline[0]
        if panel.running and not timed_out:
            app.root.after(500, _check)
            return
        ok = sum(1 for r in panel.rows.values() if r.status == "DONE")
        fail = sum(1 for r in panel.rows.values() if r.status in ("FAIL", "FFMPEG_FAIL"))
        Path(result_path).write_text(
            f"ok={ok} fail={fail} rows={len(panel.rows)} "
            f"running={panel.running} timed_out={timed_out}\n"
            + "\n".join(log_lines[-200:]),
            encoding="utf-8")
        app.root.after(100, app.root.destroy)

    app.root.after(500, kick_off)


def main():
    app = App()
    _maybe_autorun_test(app)
    app.run()


if __name__ == "__main__":
    main()
