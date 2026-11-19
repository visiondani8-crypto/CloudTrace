"""Manage the optional neural speaker model (Resemblyzer voice encoder, Apache-2.0).

    python -m clipforge.devtools.voice_model status
    python -m clipforge.devtools.voice_model install                 # downloads the 15.7 MB wheel from PyPI
    python -m clipforge.devtools.voice_model install --wheel FILE    # offline: use a wheel you already have
    python -m clipforge.devtools.voice_model remove

Only the public model file is downloaded; no media or transcripts leave the machine. The
weights are checksum-verified and converted to numpy — PyTorch is not needed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m clipforge.devtools.voice_model")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    ins = sub.add_parser("install")
    ins.add_argument("--wheel", help="local Resemblyzer-0.1.4-py3-none-any.whl (no download)")
    sub.add_parser("remove")
    args = ap.parse_args(argv)

    from ..media import voice_encoder as ve

    if args.cmd == "status":
        print(json.dumps(ve.status(), indent=1))
    elif args.cmd == "install":
        path = ve.install_from_wheel(Path(args.wheel)) if args.wheel else ve.download_and_install()
        print(f"Installed {path}")
    else:
        ve.remove()
        print("Removed; speaker detection uses the spectral method.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
