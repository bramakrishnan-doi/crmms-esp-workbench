"""Filesystem locations that work both from source and in a frozen build.

PyInstaller extracts bundled read-only files under ``sys._MEIPASS``.  The
application's writable data (currently the Explorer presets) must live outside
that temporary directory so it survives restarts.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, "frozen", False))

_MEIPASS = getattr(sys, "_MEIPASS", None)
if _MEIPASS:
    # The PyInstaller spec places bundled data under ``<package name>/...`` so
    # the frozen layout mirrors the source package layout.
    _bundled_package = Path(_MEIPASS) / PACKAGE_DIR.name
    BUNDLE_DIR = _bundled_package if _bundled_package.exists() else Path(_MEIPASS)
else:
    BUNDLE_DIR = PACKAGE_DIR


def user_data_dir() -> Path:
    """Return the per-user directory used for writable application data."""
    if not FROZEN:
        return PACKAGE_DIR

    base = os.environ.get("LOCALAPPDATA")
    if not base:
        base = str(Path.home() / "AppData" / "Local")
    return Path(base) / "CRMMS_ESP_Compare"
