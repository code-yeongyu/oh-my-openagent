"""Re-execute PEP 723 scanner entry points when dependencies are unavailable."""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Final

if importlib.util.find_spec("pydantic") is None:
    os.execvp("uv", ["uv", "run", "--script", sys.argv[0], *sys.argv[1:]])

DEPENDENCIES_READY: Final = True
