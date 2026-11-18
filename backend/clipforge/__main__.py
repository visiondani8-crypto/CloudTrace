"""Run the ClipForge Studio backend: ``python -m clipforge``."""

from __future__ import annotations

import argparse

import uvicorn

from .config import get_config


def main() -> None:
    cfg = get_config()
    ap = argparse.ArgumentParser(description="ClipForge Studio backend")
    ap.add_argument("--host", default=cfg.host, help="Bind address (default 127.0.0.1 — keep it local)")
    ap.add_argument("--port", type=int, default=cfg.port)
    ap.add_argument("--reload", action="store_true")
    args = ap.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: binding to {args.host} exposes your media library to the network.")
    uvicorn.run("clipforge.api.app:create_app", factory=True, host=args.host, port=args.port, reload=args.reload,
                log_level="info", timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
