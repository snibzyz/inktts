# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for INKTTS — single-file .exe with embedded ffmpeg.

Build:  pyinstaller INKTTS.spec --noconfirm
Output: dist/INKTTS.exe (single file, ~120 MB)
"""
from PyInstaller.utils.hooks import collect_all, collect_data_files

# Pull in CustomTkinter's bundled themes + fonts
ctk_datas, ctk_binaries, ctk_hidden = collect_all('customtkinter')

# Pull in edge_tts assets if any
edge_datas, edge_binaries, edge_hidden = collect_all('edge_tts')

# Resolve real ffmpeg.exe (chocolatey shim is just a wrapper, follow it)
import shutil, subprocess, os, pathlib
def _resolve_ffmpeg():
    p = shutil.which('ffmpeg')
    if not p:
        raise SystemExit('ffmpeg not found on PATH — install before building')
    p = pathlib.Path(p)
    if p.stat().st_size < 5_000_000:
        # likely a shim — find the real binary in chocolatey lib
        real = pathlib.Path(r'C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe')
        if real.exists():
            return str(real)
    return str(p)

FFMPEG_PATH = _resolve_ffmpeg()
print(f'[INKTTS spec] bundling ffmpeg from: {FFMPEG_PATH}')

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[
        (FFMPEG_PATH, '.'),
    ] + ctk_binaries + edge_binaries,
    datas=[
        ('scripts/edge.py', 'scripts'),
        ('scripts/google.py', 'scripts'),
        ('scripts/responsivevoice.py', 'scripts'),
        ('scripts/_lib.py', 'scripts'),
        ('inktts.ico', '.'),
    ] + ctk_datas + edge_datas,
    hiddenimports=[
        'edge_tts',
        'aiohttp',
        'customtkinter',
    ] + ctk_hidden + edge_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'numpy', 'scipy', 'pandas',
        'PIL.ImageQt', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
        'IPython', 'jupyter', 'notebook', 'jedi', 'parso',
        'pytest', 'sphinx', 'docutils',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='INKTTS',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='inktts.ico',
)
