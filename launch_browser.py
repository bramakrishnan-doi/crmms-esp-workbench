"""Open the local CRMMS UI after Uvicorn becomes reachable.

Started as a small background helper by Start_CRMMS_Web_App.bat.  It uses only
Python's standard library so it adds no runtime dependency.
"""
from __future__ import annotations

import time
import urllib.request
import webbrowser

APP_URL = "http://127.0.0.1:8000"
HEALTH_URL = f"{APP_URL}/api/health"


def main() -> None:
    deadline = time.monotonic() + 45.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=0.75) as response:
                if 200 <= response.status < 300:
                    webbrowser.open(APP_URL, new=2)
                    return
        except Exception:
            time.sleep(0.4)


if __name__ == "__main__":
    main()
