from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from pydantic import TypeAdapter
from scanner_models import AstPayload, Candidate

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
AST_SCANNER = HERE / "prompt_contract_ast.mjs"


def scan_candidates(paths: list[Path]) -> tuple[Candidate, ...]:
    relative_paths = [path.relative_to(ROOT).as_posix() for path in paths]
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as handle:
        json.dump(relative_paths, handle)
        handle.flush()
        result = subprocess.run(
            ["node", str(AST_SCANNER), "--root", str(ROOT), "--files-json", handle.name],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    return TypeAdapter(AstPayload).validate_json(result.stdout).candidates
