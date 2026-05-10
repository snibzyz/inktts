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
from tkinter import filedialog

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
    ("⚡ ไฟล์เดียว — เร็วสุด", 1, 48),
    ("👥 ไม่กี่ไฟล์ (5 ไฟล์)", 5, 8),
    ("⭐ แนะนำ — เร็วและคุ้ม (10 ไฟล์)", 10, 2),
    ("🚀 ไฟล์เยอะ (20 ไฟล์)", 20, 2),
    ("🚀 ไฟล์เยอะมาก (50 ไฟล์)", 50, 1),
    ("🛡 ช้าแต่ปลอดภัย (กันโดน rate-limit)", 4, 1),
]
GOOGLE_PRESETS = [
    ("⚡ ไฟล์เดียว — เร็วสุด", 1, 6),
    ("⭐ แนะนำ — เร็วและคุ้ม (10 ไฟล์)", 10, 2),
    ("👥 ไม่กี่ไฟล์ (6 ไฟล์)", 6, 1),
    ("👥 ไม่กี่ไฟล์ (8 ไฟล์)", 8, 1),
    ("🛡 ช้าแต่ปลอดภัย", 4, 1),
]
RV_PRESETS = [
    ("⚡ ไฟล์เดียว — เร็วสุด", 1, 6),
    ("⭐ แนะนำ (8 ไฟล์)", 8, 1),
    ("👥 ไม่กี่ไฟล์ (6 ไฟล์)", 6, 1),
    ("🛡 ช้าแต่ปลอดภัย", 3, 1),
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
        # cap = max preset total (auto-grows if presets add a heavier combo)
        "max_total": max(b * c for _, b, c in EDGE_PRESETS),
        "presets":  EDGE_PRESETS,
        "default_preset": 2,
        "fields": [
            {"name": "voice", "kind": "combo", "label": "เสียงพากย์", "default": "th-TH-PremwadeeNeural",
             "options": ["th-TH-PremwadeeNeural", "th-TH-NiwatNeural"],
             "option_labels": ["คุณป้อม (เสียงผู้หญิง)", "คุณนิวัฒน์ (เสียงผู้ชาย)"]},
            {"name": "rate", "kind": "entry", "label": "ความเร็วเสียง (เช่น +30%)", "default": "+30%"},
            {"name": "lines-per-chunk", "kind": "spinbox", "label": "บรรทัด/ส่วนของเสียง", "default": 1,
             "from_": 1, "to": 50, "advanced": True},
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
        "max_total": max(b * c for _, b, c in GOOGLE_PRESETS),
        "presets":  GOOGLE_PRESETS,
        "default_preset": 1,
        "fields": [
            {"name": "tempo", "kind": "scale", "label": "ความเร็วเสียง", "default": 1.3,
             "from_": 0.5, "to": 2.0},
            {"name": "chunk-chars", "kind": "spinbox", "label": "ตัวอักษร/ส่วน",
             "default": 120, "from_": 50, "to": 200, "advanced": True},
            {"name": "jitter", "kind": "scale", "label": "หน่วงสุ่ม (กันโดน rate-limit)",
             "default": 0.1, "from_": 0.0, "to": 1.0, "advanced": True},
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
        "max_total": max(b * c for _, b, c in RV_PRESETS),
        "presets":  RV_PRESETS,
        "default_preset": 1,
        "fields": [
            {"name": "gender", "kind": "combo", "label": "เพศของเสียง", "default": "female",
             "options": ["female", "male"],
             "option_labels": ["เสียงผู้หญิง", "เสียงผู้ชาย"]},
            {"name": "tempo", "kind": "scale", "label": "ความเร็วเสียง", "default": 1.3,
             "from_": 0.5, "to": 2.0},
            {"name": "chunk-chars", "kind": "spinbox", "label": "ตัวอักษร/ส่วน",
             "default": 100, "from_": 50, "to": 100, "advanced": True},
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
        # AdaptiveLimiter feedback — updated by LIMIT events from the script
        self.current_limit: int | None = None
        self.initial_limit: int | None = None

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
        # ── Input section: browse buttons + auto-detected file count ────────
        # pattern_var holds either a glob (folder mode) or a sentinel string
        # (file-list mode). selected_files (when set) bypasses glob entirely.
        self.pattern_var = tk.StringVar(value=str(INPUT_DIR / "*.txt"))
        self.selected_files: list[str] | None = None

        label(cfgi, "ไฟล์ที่จะแปลง", font_size=12, weight="bold",
              fg=C["text_bright"]).grid(row=r, column=0, sticky="w", pady=(0, 4))

        r += 1
        browse_row = ctk.CTkFrame(cfgi, fg_color="transparent")
        browse_row.grid(row=r, column=0, columnspan=4, sticky="we", pady=4)
        ctk.CTkButton(
            browse_row, text="📁 เลือกโฟลเดอร์", command=self._browse_folder,
            width=160, height=32, corner_radius=4,
            font=(FONT, 12, "bold"),
            fg_color=C["panel_hi"], hover_color=C["selected"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        ).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            browse_row, text="📄 เลือกไฟล์ (เลือกได้หลายไฟล์)", command=self._browse_files,
            width=240, height=32, corner_radius=4,
            font=(FONT, 12),
            fg_color=C["panel_hi"], hover_color=C["selected"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        ).pack(side="left")

        r += 1
        # Selected target — readable summary, click to edit raw pattern
        self.input_summary = label(cfgi, "", font_size=11, fg=C["text_dim"])
        self.input_summary.grid(row=r, column=0, columnspan=4, sticky="w", pady=(2, 4))

        r += 1
        # Limit — friendly checkbox + spinbox combo
        limit_row = ctk.CTkFrame(cfgi, fg_color="transparent")
        limit_row.grid(row=r, column=0, columnspan=4, sticky="w", pady=4)
        self.limit_all_var = tk.BooleanVar(value=False)
        self.n_files_var = tk.IntVar(value=10)
        chk = ctk.CTkCheckBox(
            limit_row, text="แปลงทุกไฟล์", variable=self.limit_all_var,
            command=self._toggle_limit_all,
            font=(FONT, 12),
            fg_color=C["accent_btn"], hover_color=C["accent_btn_hi"],
            border_color=C["border_input"], text_color=C["text"],
        )
        chk.pack(side="left", padx=(0, 12))
        self._limit_lbl = label(limit_row, "หรือเลือกแค่", font_size=11, fg=C["text_dim"])
        self._limit_lbl.pack(side="left", padx=(0, 6))
        self._limit_spin = self._spinbox(limit_row, self.n_files_var, 1, 10000)
        self._limit_spin.pack(side="left")
        label(limit_row, "ไฟล์แรก", font_size=11, fg=C["text_dim"]).pack(side="left", padx=(6, 0))

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

        # Basic service-specific fields (voice / gender / tempo / rate)
        # Placed inline; advanced fields (chunk-chars, jitter, lines-per-chunk)
        # go to the collapsible "ตั้งค่าขั้นสูง" section below.
        r += 1
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=10)
        cap = self.service["max_total"]
        b_default = self.service["presets"][self.service["default_preset"]][1]
        c_default = self.service["presets"][self.service["default_preset"]][2]
        self.batch_var = tk.IntVar(value=b_default)
        self.conn_var = tk.IntVar(value=c_default)

        for fdef in self.service["fields"]:
            if fdef.get("advanced"):
                continue
            r += 1
            label(cfgi, fdef["label"]).grid(row=r, column=0, sticky="w", pady=4)
            self._build_field(cfgi, fdef, r)

        # Advanced section — collapsible (default hidden). Holds the
        # technical knobs most non-tech users shouldn't need to touch:
        # batch size, connections-per-file, total-conn indicator, and
        # per-service advanced fields (chunk-chars, jitter, lines-per-chunk).
        r += 1
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=12)
        r += 1
        self.adv_open = tk.BooleanVar(value=False)
        self.adv_toggle_btn = ctk.CTkButton(
            cfgi, text="▸  ตั้งค่าขั้นสูง (สำหรับผู้ใช้ที่ต้องการปรับ)",
            command=self._toggle_advanced,
            anchor="w",
            height=28, corner_radius=4,
            font=(FONT, 11),
            fg_color="transparent", hover_color=C["panel_hi"],
            text_color=C["text_dim"], border_width=0,
        )
        self.adv_toggle_btn.grid(row=r, column=0, columnspan=4, sticky="w", pady=(0, 4))

        r += 1
        # Inner frame holds advanced widgets; we hide/show by grid_remove/grid
        self.adv_frame = ctk.CTkFrame(cfgi, fg_color="transparent")
        self.adv_frame.grid(row=r, column=0, columnspan=4, sticky="we", pady=(0, 4))
        self.adv_frame.grid_columnconfigure(1, weight=1)
        self.adv_frame.grid_remove()  # hidden by default

        ar = 0
        label(self.adv_frame, "จำนวนไฟล์ต่อรอบ").grid(row=ar, column=0, sticky="w", pady=4)
        self.batch_slider = ctk.CTkSlider(
            self.adv_frame, from_=1, to=cap, number_of_steps=cap - 1,
            command=lambda v: self._slider_changed(self.batch_var, self.batch_lbl, v),
            progress_color=C["accent"], fg_color=C["track"],
            button_color=C["text"], button_hover_color=C["text_bright"],
            height=14,
        )
        self.batch_slider.set(b_default)
        self.batch_slider.grid(row=ar, column=1, sticky="we", padx=(10, 8), pady=4)
        self.batch_lbl = label(self.adv_frame, str(b_default), font_size=12, weight="bold",
                               fg=C["text_bright"])
        self.batch_lbl.grid(row=ar, column=2, sticky="w", pady=4)

        ar += 1
        label(self.adv_frame, "การเชื่อมต่อต่อไฟล์").grid(row=ar, column=0, sticky="w", pady=4)
        self.conn_slider = ctk.CTkSlider(
            self.adv_frame, from_=1, to=cap, number_of_steps=cap - 1,
            command=lambda v: self._slider_changed(self.conn_var, self.conn_lbl, v),
            progress_color=C["accent"], fg_color=C["track"],
            button_color=C["text"], button_hover_color=C["text_bright"],
            height=14,
        )
        self.conn_slider.set(c_default)
        self.conn_slider.grid(row=ar, column=1, sticky="we", padx=(10, 8), pady=4)
        self.conn_lbl = label(self.adv_frame, str(c_default), font_size=12, weight="bold",
                              fg=C["text_bright"])
        self.conn_lbl.grid(row=ar, column=2, sticky="w", pady=4)

        ar += 1
        self.total_lbl = label(self.adv_frame, "", font_size=11, fg=C["text_dim"])
        self.total_lbl.grid(row=ar, column=0, columnspan=4, sticky="w", pady=(2, 6))

        # Advanced service-specific fields
        for fdef in self.service["fields"]:
            if not fdef.get("advanced"):
                continue
            ar += 1
            label(self.adv_frame, fdef["label"]).grid(row=ar, column=0, sticky="w", pady=4)
            self._build_field(self.adv_frame, fdef, ar)
        # Re-use grid weights so sliders expand
        self.adv_frame.grid_columnconfigure(1, weight=1)
        self.adv_frame.grid_columnconfigure(2, weight=0)

        # Run controls
        r += 1
        hairline(cfgi).grid(row=r, column=0, columnspan=4, sticky="we", pady=12)
        # Output destination — non-tech users want to know where the .m4a files go
        r += 1
        out_path = (APP_ROOT / self.service["output"]).resolve()
        label(
            cfgi,
            f"🎵 ไฟล์เสียงจะอยู่ที่:  {out_path}",
            font_size=11, fg=C["text_dim"],
        ).grid(row=r, column=0, columnspan=4, sticky="w", pady=(0, 8))
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
        # Auto-throttle indicator — shrinks visibly when AdaptiveLimiter
        # halves on consecutive failures, grows back on success streak.
        self.adapt_lbl = label(sumi, "", font_size=11, fg=C["text_dim"])
        self.adapt_lbl.pack(side="left", padx=(18, 0))
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
            # If option_labels is provided, the dropdown shows friendly labels
            # (e.g. "คุณป้อม (เสียงผู้หญิง)") but field_vars[name] holds the
            # underlying CLI value (e.g. "th-TH-PremwadeeNeural").
            options = fdef["options"]
            display = fdef.get("option_labels") or options
            default_idx = options.index(fdef["default"]) if fdef["default"] in options else 0
            display_var = tk.StringVar(value=display[default_idx])
            value_var = tk.StringVar(value=fdef["default"])

            def on_pick(label_picked, _opts=options, _disp=display, _vv=value_var):
                try:
                    _vv.set(_opts[_disp.index(label_picked)])
                except ValueError:
                    _vv.set(label_picked)

            display_var.trace_add("write", lambda *_, vd=display_var: on_pick(vd.get()))

            cb = ctk.CTkComboBox(
                parent, values=display, variable=display_var, state="readonly",
                width=260, height=30, font=(FONT, 12),
                dropdown_font=(FONT, 12),
                fg_color=C["input"], border_color=C["border_input"], button_color=C["panel_hi"],
                button_hover_color=C["selected"], dropdown_fg_color=C["input"],
                dropdown_text_color=C["text"], text_color=C["text"],
                dropdown_hover_color=C["selected"],
            )
            cb.grid(row=r, column=1, columnspan=2, sticky="w", padx=(10, 0), pady=4)
            self.field_vars[fdef["name"]] = value_var
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

    def _resolve_input_files(self) -> list[str]:
        """Return the list of files start() will process — selected_files
        (Browse Files mode) takes precedence over the glob pattern."""
        if self.selected_files:
            return [f for f in self.selected_files if os.path.exists(f)]
        try:
            return sorted(glob.glob(self.pattern_var.get()))
        except Exception:
            return []

    def _refresh_count(self):
        files = self._resolve_input_files()
        n = len(files)
        if self.selected_files is not None:
            # File-list mode — show a sample of names for clarity
            names = [os.path.basename(f) for f in files[:3]]
            tail = ", …" if n > 3 else ""
            summary = (f"📄 {n} ไฟล์ที่เลือก: {', '.join(names)}{tail}"
                       if n else "⚠ ไฟล์ที่เลือกไว้หายไปแล้ว — เลือกใหม่อีกครั้ง")
            color = C["text_dim"] if n else C["fail"]
        elif n:
            folder = os.path.dirname(self.pattern_var.get()) or "."
            summary = f"📁 พบ {n} ไฟล์ใน {folder}"
            color = C["text_dim"]
        else:
            summary = (f"⚠ ไม่พบไฟล์ .txt ใน {self.pattern_var.get()} "
                       f"— กดปุ่มเลือกข้างบน")
            color = C["warn"]
        self.input_summary.configure(text=summary, text_color=color)

    def _browse_folder(self):
        initial = str(INPUT_DIR if INPUT_DIR.exists() else APP_ROOT)
        folder = filedialog.askdirectory(
            initialdir=initial,
            title="เลือกโฟลเดอร์ที่มีไฟล์ .txt ที่จะแปลงเสียง",
        )
        if not folder:
            return
        self.selected_files = None
        self.pattern_var.set(str(Path(folder) / "*.txt"))
        self._refresh_count()

    def _browse_files(self):
        initial = str(INPUT_DIR if INPUT_DIR.exists() else APP_ROOT)
        files = filedialog.askopenfilenames(
            initialdir=initial,
            title="เลือกไฟล์ .txt (กด Ctrl/Shift เพื่อเลือกหลายไฟล์)",
            filetypes=[("ไฟล์ข้อความ (.txt)", "*.txt"), ("ทุกไฟล์", "*.*")],
        )
        if not files:
            return
        self.selected_files = list(files)
        # Show a friendly placeholder in pattern_var so the entry isn't blank,
        # but the actual processing path is selected_files.
        self.pattern_var.set(f"({len(files)} ไฟล์ที่เลือก)")
        self._refresh_count()

    def _toggle_limit_all(self):
        on = self.limit_all_var.get()
        # Dim the spinbox when "แปลงทุกไฟล์" is checked
        for child in self._limit_spin.winfo_children():
            try:
                child.configure(state="disabled" if on else "normal")
            except tk.TclError:
                pass
        self._limit_lbl.configure(text_color=C["text_muted"] if on else C["text_dim"])

    def _toggle_advanced(self):
        """Show/hide the advanced settings frame and rotate the toggle arrow."""
        opening = not self.adv_open.get()
        self.adv_open.set(opening)
        if opening:
            self.adv_frame.grid()
            self.adv_toggle_btn.configure(
                text="▾  ตั้งค่าขั้นสูง (คลิกเพื่อซ่อน)",
                text_color=C["text"],
            )
        else:
            self.adv_frame.grid_remove()
            self.adv_toggle_btn.configure(
                text="▸  ตั้งค่าขั้นสูง (สำหรับผู้ใช้ที่ต้องการปรับ)",
                text_color=C["text_dim"],
            )

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
        files = self._resolve_input_files()
        # "แปลงทุกไฟล์" = no limit; otherwise honor the spinbox count
        if not self.limit_all_var.get():
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
        self.current_limit = None
        self.initial_limit = None
        self.adapt_lbl.configure(text="", text_color=C["text_dim"])
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
        if line.startswith("LIMIT\t"):
            self._handle_limit_line(line)
            return
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

    def _handle_limit_line(self, line: str):
        # Format: LIMIT\t{label}\t{shrink|grow}\t{old}\t{new}\t{initial}
        parts = line.split("\t")
        if len(parts) < 6:
            return
        try:
            _, _label, kind, _old, new, initial = parts[:6]
            new_n = int(new)
            init_n = int(initial)
        except ValueError:
            return
        self.current_limit = new_n
        self.initial_limit = init_n
        if kind == "shrink":
            self.adapt_lbl.configure(
                text=f"⚠ auto-throttle: {new_n}/{init_n}",
                text_color=C["warn"],
            )
            self.on_status(f"โดน rate-limit — ปรับลงเป็น {new_n}/{init_n}", "warn")
        elif kind == "grow":
            color = C["ok"] if new_n >= init_n else C["text_dim"]
            label_text = "✓ คืนเพดานเต็ม" if new_n >= init_n else f"↑ ค่อย ๆ เพิ่มกลับ: {new_n}/{init_n}"
            self.adapt_lbl.configure(text=label_text, text_color=color)

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


# ─── MergePanel — รวมไฟล์ .m4a เป็นกลุ่มย่อย ────────────────────────────────
import re

NUMBERED_RE = re.compile(r"^(.*?)(\d+)$")


def detect_prefix_range(folder: Path, ext: str = "m4a"):
    """Scan folder for files like '<prefix><number>.<ext>' and infer the
    common prefix + numeric range. Returns (prefix, start, end, count) or
    (None, None, None, 0) if no consistent pattern is found.
    """
    if not folder.exists() or not folder.is_dir():
        return (None, None, None, 0)
    nums_by_prefix: dict[str, list[int]] = {}
    for p in folder.glob(f"*.{ext}"):
        stem = p.stem
        m = NUMBERED_RE.match(stem)
        if not m:
            continue
        prefix, num_str = m.group(1), m.group(2)
        try:
            n = int(num_str)
        except ValueError:
            continue
        nums_by_prefix.setdefault(prefix, []).append(n)
    if not nums_by_prefix:
        return (None, None, None, 0)
    # Pick the prefix with the most matching files
    prefix, nums = max(nums_by_prefix.items(), key=lambda kv: len(kv[1]))
    nums.sort()
    return (prefix, nums[0], nums[-1], len(nums))


class MergePanel(ctk.CTkFrame):
    """Group-merge .m4a files via ffmpeg concat (no re-encode = fast).

    Common workflow: user generated chapters 401-600 individually; wants
    grouped audiobook files (401-410.m4a, 411-420.m4a, …). This panel
    auto-detects the numbered pattern in a source folder and runs
    scripts/merge_groups.py in-process.
    """

    def __init__(self, parent, on_status):
        super().__init__(parent, fg_color=C["bg"])
        self.on_status = on_status
        self.running = False
        self.event_q: queue.Queue = queue.Queue()
        self.start_time: float | None = None
        self._tick_scheduled = False
        self._build()

    def _build(self):
        # Title
        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=24, pady=(20, 6))
        label(head, "🔀 รวมไฟล์เสียงเป็นกลุ่มย่อย", font_size=18, weight="bold",
              fg=C["text_bright"]).pack(anchor="w")
        label(head, "เช่น มีตอน 401-600 → รวมเป็นไฟล์ 401-410, 411-420, … (ไฟล์ละ 10 ตอน)",
              font_size=12, fg=C["text_dim"]).pack(anchor="w", pady=(2, 0))
        hairline(self).pack(fill="x", padx=24, pady=(10, 14))

        # Configuration card
        cfg = ctk.CTkFrame(self, fg_color=C["panel"], corner_radius=6, border_width=1,
                           border_color=C["border"])
        cfg.pack(fill="x", padx=24)
        f = ctk.CTkFrame(cfg, fg_color="transparent")
        f.pack(fill="x", padx=18, pady=16)
        f.grid_columnconfigure(1, weight=1)

        label(f, "ตั้งค่าการรวม", font_size=13, weight="bold",
              fg=C["text_bright"]).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 10))

        r = 1
        # Source folder
        label(f, "โฟลเดอร์ต้นทาง (ไฟล์ .m4a)", font_size=12, weight="bold",
              fg=C["text_bright"]).grid(row=r, column=0, sticky="w", pady=4)
        r += 1
        src_row = ctk.CTkFrame(f, fg_color="transparent")
        src_row.grid(row=r, column=0, columnspan=4, sticky="we", pady=4)
        self.src_var = tk.StringVar(value=str(APP_ROOT / "output" / "edge"))
        ctk.CTkButton(
            src_row, text="📁 เลือกโฟลเดอร์", command=self._browse_src,
            width=160, height=32, corner_radius=4,
            font=(FONT, 12, "bold"),
            fg_color=C["panel_hi"], hover_color=C["selected"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        ).pack(side="left", padx=(0, 8))
        self.src_lbl = label(src_row, self.src_var.get(), font_size=11, fg=C["text_dim"])
        self.src_lbl.pack(side="left")

        r += 1
        self.detected_lbl = label(f, "", font_size=11, fg=C["text_dim"])
        self.detected_lbl.grid(row=r, column=0, columnspan=4, sticky="w", pady=(2, 6))

        r += 1
        hairline(f).grid(row=r, column=0, columnspan=4, sticky="we", pady=10)

        # Prefix
        r += 1
        label(f, "คำนำหน้าชื่อไฟล์").grid(row=r, column=0, sticky="w", pady=4)
        self.prefix_var = tk.StringVar(value="")
        e = ctk.CTkEntry(
            f, textvariable=self.prefix_var, height=30, corner_radius=4,
            font=(FONT, 12),
            fg_color=C["input"], border_color=C["border_input"], text_color=C["text"],
            placeholder_text="เช่น  ติดหนี้สามสิบล้าน  (เว้นวรรคก่อนเลขตอน)",
            placeholder_text_color=C["text_muted"],
        )
        e.grid(row=r, column=1, columnspan=3, sticky="we", padx=(10, 0), pady=4)

        # Range
        r += 1
        label(f, "ตั้งแต่ตอน — ถึงตอน").grid(row=r, column=0, sticky="w", pady=4)
        rng_row = ctk.CTkFrame(f, fg_color="transparent")
        rng_row.grid(row=r, column=1, columnspan=3, sticky="w", padx=(10, 0), pady=4)
        self.start_var = tk.IntVar(value=1)
        self.end_var = tk.IntVar(value=10)
        for var, label_text in ((self.start_var, "ถึง"), (self.end_var, "")):
            sb = self._spinbox(rng_row, var, 0, 999999)
            sb.pack(side="left", padx=(0, 8))
            if label_text:
                label(rng_row, label_text, font_size=12, fg=C["text_dim"]).pack(side="left",
                                                                                padx=(0, 8))

        # Group size
        r += 1
        label(f, "จัดกลุ่มละ (ตอน)").grid(row=r, column=0, sticky="w", pady=4)
        self.group_var = tk.IntVar(value=10)
        self._spinbox(f, self.group_var, 1, 1000).grid(row=r, column=1, sticky="w",
                                                       padx=(10, 0), pady=4)

        # Extension
        r += 1
        label(f, "นามสกุล").grid(row=r, column=0, sticky="w", pady=4)
        self.ext_var = tk.StringVar(value="m4a")
        ctk.CTkComboBox(
            f, values=["m4a", "mp3"], variable=self.ext_var, state="readonly",
            width=120, height=30, font=(FONT, 12), dropdown_font=(FONT, 12),
            fg_color=C["input"], border_color=C["border_input"], button_color=C["panel_hi"],
            button_hover_color=C["selected"], dropdown_fg_color=C["input"],
            dropdown_text_color=C["text"], text_color=C["text"],
            dropdown_hover_color=C["selected"],
        ).grid(row=r, column=1, sticky="w", padx=(10, 0), pady=4)

        # Preview
        r += 1
        hairline(f).grid(row=r, column=0, columnspan=4, sticky="we", pady=10)
        r += 1
        self.preview_lbl = label(f, "", font_size=11, fg=C["text_dim"])
        self.preview_lbl.grid(row=r, column=0, columnspan=4, sticky="w", pady=(0, 4))

        # Output destination — derived: <src>_merged
        r += 1
        self.dst_lbl = label(f, "", font_size=11, fg=C["text_dim"])
        self.dst_lbl.grid(row=r, column=0, columnspan=4, sticky="w", pady=(0, 8))

        # Run controls
        r += 1
        hairline(f).grid(row=r, column=0, columnspan=4, sticky="we", pady=12)
        r += 1
        ctrl = ctk.CTkFrame(f, fg_color="transparent")
        ctrl.grid(row=r, column=0, columnspan=4, sticky="w")
        self.run_btn = ctk.CTkButton(
            ctrl, text="▶  เริ่มรวม", command=self.start,
            width=140, height=34, corner_radius=4,
            font=(FONT, 12, "bold"),
            fg_color=C["accent_btn"], hover_color=C["accent_btn_hi"],
            text_color=C["text_bright"],
        )
        self.run_btn.pack(side="left", padx=(0, 8))
        self.open_btn = ctk.CTkButton(
            ctrl, text="📂 เปิดโฟลเดอร์ผลลัพธ์", command=self._open_output,
            width=190, height=34, corner_radius=4,
            font=(FONT, 12),
            fg_color="transparent", hover_color=C["panel_hi"],
            text_color=C["text"], border_width=1, border_color=C["border_input"],
        )
        self.open_btn.pack(side="left")

        # Log area
        ctk.CTkFrame(self, fg_color="transparent", height=12).pack()
        log_card = ctk.CTkFrame(self, fg_color=C["panel"], corner_radius=6, border_width=1,
                                border_color=C["border"])
        log_card.pack(fill="both", expand=True, padx=24, pady=(0, 16))
        ph = ctk.CTkFrame(log_card, fg_color="transparent")
        ph.pack(fill="x", padx=14, pady=(10, 4))
        label(ph, "บันทึกการรวม", font_size=12, weight="bold",
              fg=C["text_bright"]).pack(side="left")
        self.log_box = tk.Text(
            log_card, height=10, bg=C["bg"], fg=C["text"], insertbackground=C["text"],
            relief="flat", borderwidth=0, font=(FONT, 11), wrap="none",
        )
        self.log_box.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # Wire change tracking → update preview + dst
        for v in (self.src_var, self.prefix_var, self.start_var, self.end_var,
                  self.group_var, self.ext_var):
            v.trace_add("write", lambda *_: self._refresh_preview())
        self._refresh_preview()

    def _entry(self, parent, var):
        # alias for consistency with ServicePanel pattern
        return ctk.CTkEntry(
            parent, textvariable=var, height=30, corner_radius=4,
            font=(FONT, 12),
            fg_color=C["input"], border_color=C["border_input"], text_color=C["text"],
        )

    def _spinbox(self, parent, var, lo, hi):
        f = ctk.CTkFrame(parent, fg_color="transparent")
        ent = ctk.CTkEntry(f, textvariable=var, width=80, height=30, corner_radius=4,
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

    def _browse_src(self):
        initial = str(APP_ROOT / "output" if (APP_ROOT / "output").exists() else APP_ROOT)
        folder = filedialog.askdirectory(initialdir=initial,
                                         title="เลือกโฟลเดอร์ที่มีไฟล์ .m4a/.mp3")
        if not folder:
            return
        self.src_var.set(folder)
        self.src_lbl.configure(text=folder)
        self._auto_detect()

    def _auto_detect(self):
        src = Path(self.src_var.get())
        ext = self.ext_var.get() or "m4a"
        prefix, start, end, count = detect_prefix_range(src, ext)
        if prefix is None:
            self.detected_lbl.configure(
                text=f"⚠ ไม่พบไฟล์รูปแบบ '<ชื่อ><เลข>.{ext}' ในโฟลเดอร์นี้",
                text_color=C["warn"])
            return
        self.detected_lbl.configure(
            text=f"✓ พบ '{prefix.strip()}' ตอน {start}-{end} ({count} ไฟล์)",
            text_color=C["ok"])
        self.prefix_var.set(prefix)
        self.start_var.set(start)
        self.end_var.set(end)

    def _refresh_preview(self):
        try:
            s = int(self.start_var.get())
            e = int(self.end_var.get())
            g = int(self.group_var.get())
        except (ValueError, tk.TclError):
            self.preview_lbl.configure(text="")
            return
        if g <= 0 or s > e:
            self.preview_lbl.configure(text="")
            return
        groups = []
        i = s
        while i <= e:
            j = min(i + g - 1, e)
            groups.append((i, j))
            i = j + 1
        prefix = self.prefix_var.get()
        ext = self.ext_var.get() or "m4a"
        sample = [f"{prefix}{a}-{b}.{ext}" for a, b in groups[:3]]
        more = f"  …และอีก {len(groups) - 3} กลุ่ม" if len(groups) > 3 else ""
        self.preview_lbl.configure(
            text=f"จะได้ {len(groups)} ไฟล์ผลลัพธ์: {', '.join(sample)}{more}",
            text_color=C["text_dim"])
        # Destination preview
        dst = Path(self.src_var.get()).with_name(Path(self.src_var.get()).name + "_merged")
        self.dst_lbl.configure(
            text=f"🎵 ไฟล์รวมจะอยู่ที่:  {dst}",
            text_color=C["text_dim"])

    def _open_output(self):
        dst = Path(self.src_var.get()).with_name(Path(self.src_var.get()).name + "_merged")
        dst.mkdir(parents=True, exist_ok=True)
        if sys.platform.startswith("win"):
            os.startfile(str(dst))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(dst)])
        else:
            subprocess.Popen(["xdg-open", str(dst)])

    def _log(self, line: str):
        self.log_box.insert("end", line + "\n")
        self.log_box.see("end")

    def start(self):
        if self.running:
            return
        if not _RUN_LOCK.acquire(blocking=False):
            self.on_status("มีบริการอื่นกำลังทำงานอยู่", "warn")
            return
        src = Path(self.src_var.get())
        if not src.exists():
            self._log(f"[error] โฟลเดอร์ไม่มีอยู่: {src}")
            _RUN_LOCK.release()
            return
        prefix = self.prefix_var.get()
        try:
            start, end = int(self.start_var.get()), int(self.end_var.get())
            group = int(self.group_var.get())
        except (ValueError, tk.TclError):
            self._log("[error] กรุณาใส่ตัวเลขให้ถูกต้อง")
            _RUN_LOCK.release()
            return
        ext = self.ext_var.get() or "m4a"
        dst = src.with_name(src.name + "_merged")
        argv = [
            "merge_groups.py",
            "--src", str(src), "--dst", str(dst),
            "--prefix", prefix,
            "--start", str(start), "--end", str(end),
            "--group", str(group), "--ext", ext,
        ]
        self.start_time = time.time()
        self.running = True
        self.run_btn.configure(state="disabled")
        self.log_box.delete("1.0", "end")
        self._log(f"[plan] รวม {prefix}{start}-{end} เป็นกลุ่มละ {group} ตอน")
        self._log(f"[plan] ผลลัพธ์ที่: {dst}")
        self.on_status(f"กำลังรวม {prefix}{start}-{end} กลุ่มละ {group}", "run")
        threading.Thread(target=self._run_in_thread,
                         args=("merge_groups.py", argv), daemon=True).start()
        if not self._tick_scheduled:
            self._tick_scheduled = True
            self.after(100, self._tick)

    def _run_in_thread(self, script_filename: str, argv: list[str]):
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
            self._log(str(msg))
        if finished:
            elapsed = time.time() - self.start_time if self.start_time else 0
            self._log(f"\n=== เสร็จใน {elapsed:.1f} วินาที ===")
            self.run_btn.configure(state="normal")
            self.running = False
            self._tick_scheduled = False
            self.on_status(f"รวมไฟล์เสร็จแล้ว ({elapsed:.1f}s)", "ok")
            return
        self.after(200, self._tick)


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

        # Both ServicePanel (TTS backends) and MergePanel (audio merge tool)
        # are kept in the same dict — they're both CTkFrames with .tkraise()
        self.panels: dict[str, ctk.CTkFrame] = {}
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

        # ── Tools section — non-TTS utilities ────────────────────────────
        label(side, "  เครื่องมือ", font_size=10, weight="bold",
              fg=C["text_muted"]).pack(anchor="w", padx=14, pady=(14, 4))
        merge_btn = ctk.CTkButton(
            side,
            text="  🔀   รวมไฟล์เสียง",
            anchor="w",
            command=lambda: self._select("merge"),
            height=36, corner_radius=4,
            font=(FONT, 12, "bold"),
            fg_color="transparent",
            hover_color=C["hover"],
            text_color=C["text"],
        )
        merge_btn.pack(fill="x", padx=8, pady=2)
        self.sidebar_btns["merge"] = merge_btn

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

        # Merge tool — separate panel sharing the same content host
        merge_panel = MergePanel(self.host, on_status=self._set_status)
        merge_panel.grid(row=0, column=0, sticky="nsew")
        self.panels["merge"] = merge_panel

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
