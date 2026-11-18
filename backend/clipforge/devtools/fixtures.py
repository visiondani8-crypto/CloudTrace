"""Regenerate shared/geometry_fixtures.json (consumed by backend and frontend tests).

Run after intentionally changing crop/keyframe/colour math:  python -m clipforge.devtools.fixtures
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(root / "backend" / "tests"))
    from test_unit_core import FIXTURES, _geometry_doc  # noqa: E402

    FIXTURES.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES.write_text(json.dumps(_geometry_doc(), indent=1))
    print(f"wrote {FIXTURES}")


if __name__ == "__main__":
    main()
