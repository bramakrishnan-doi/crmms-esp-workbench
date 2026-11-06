# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build definition for the CRMMS one-file Windows executable."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

APP_DIR = Path(SPECPATH)
PACKAGE_NAME = APP_DIR.name
PROJECT_PARENT = APP_DIR.parent

datas = [
    (str(APP_DIR / "static"), f"{PACKAGE_NAME}/static"),
    (str(APP_DIR / "explorer_presets.json"), PACKAGE_NAME),
    (str(APP_DIR / "reporting" / "report_template.docx"), f"{PACKAGE_NAME}/reporting"),
]
datas += collect_data_files("docx")

hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("anyio")
hiddenimports += ["multipart", "python_multipart", "python_multipart.multipart"]

a = Analysis(
    ["launcher.py"],
    pathex=[str(PROJECT_PARENT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "sphinx",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="CRMMS_ESP_Compare",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
