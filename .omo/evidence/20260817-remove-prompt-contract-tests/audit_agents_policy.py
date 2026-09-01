#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.11,<3"]
# ///
"""Check repository policy files for the prompt-contract testing rules."""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import scanner_bootstrap
from pydantic import BaseModel, ConfigDict, Field

_ = scanner_bootstrap.DEPENDENCIES_READY

REQUIRED_FILES = (Path("AGENTS.md"), Path("tests/AGENTS.md"))
REQUIRED_CONCEPTS = {
    "prohibition": (
        "prompt/prose contract tests are forbidden",
        "prompt contract tests are forbidden",
    ),
    "machine_seam": ("machine-consumed",),
    "copy_equality": ("shipped-copy equality", "byte equality"),
    "runtime_seam": ("observable runtime behavior", "runtime behavior"),
}


class PolicyFileResult(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="forbid")

    path: str
    exists: bool
    missing: tuple[str, ...]


class PolicyAuditResult(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="forbid")

    files: tuple[PolicyFileResult, ...]
    passed: bool = Field(serialization_alias="pass")


def main() -> int:
    results: list[PolicyFileResult] = []
    for path in REQUIRED_FILES:
        exists = path.exists()
        text = path.read_text(encoding="utf-8").lower() if exists else ""
        missing = tuple(
            name
            for name, alternatives in REQUIRED_CONCEPTS.items()
            if not any(alternative in text for alternative in alternatives)
        )
        results.append(
            PolicyFileResult(path=path.as_posix(), exists=exists, missing=missing)
        )
    audit = PolicyAuditResult(
        files=tuple(results), passed=all(not result.missing for result in results)
    )
    print(audit.model_dump_json(indent=2, by_alias=True))
    return int(not audit.passed)


if __name__ == "__main__":
    raise SystemExit(main())
