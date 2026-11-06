"""Desktop launcher for the CRMMS ESP Compare & Report Builder.

This is the PyInstaller entry point.  It starts the local Uvicorn server and
opens the browser when the health endpoint becomes available.
"""

from __future__ import annotations

import multiprocessing
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

# Running from source: main.py uses package-relative imports, so import the
# application as a package from the project's parent directory.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from App.main import app  # noqa: E402

HOST = "127.0.0.1"
START_PORT = 8000
PORT_ATTEMPTS = 20


def _find_available_port() -> int:
    for port in range(START_PORT, START_PORT + PORT_ATTEMPTS):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((HOST, port))
            except OSError:
                continue
            return port
    raise RuntimeError(
        f"Could not find a free port between {START_PORT} and "
        f"{START_PORT + PORT_ATTEMPTS - 1}."
    )


def _open_browser_when_ready(url: str) -> None:
    deadline = time.monotonic() + 60.0
    health_url = f"{url}/api/health"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=0.75) as response:
                if 200 <= response.status < 300:
                    webbrowser.open(url, new=2)
                    return
        except Exception:
            pass
        time.sleep(0.35)
    print(f"Server did not become ready. Open {url} manually if it is running.", flush=True)


def main() -> None:
    multiprocessing.freeze_support()

    port = _find_available_port()
    url = f"http://{HOST}:{port}"

    print("=" * 60, flush=True)
    print("  CRMMS ESP Compare & Report Builder", flush=True)
    print("=" * 60, flush=True)
    print(f"  Server: {url}", flush=True)
    print("  Close this window or press CTRL+C to stop the app.", flush=True)
    print("=" * 60, flush=True)

    threading.Thread(target=_open_browser_when_ready, args=(url,), daemon=True).start()
    uvicorn.run(app, host=HOST, port=port, log_level="info")


if __name__ == "__main__":
    main()
