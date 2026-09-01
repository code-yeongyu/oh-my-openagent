from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

from .types import Json, JsonMap

if TYPE_CHECKING:
    def _loads(_text: str) -> Json: ...
else:
    def _loads(text_value: str) -> Json:
        return json.loads(text_value)


def as_map(value: Json | None) -> JsonMap | None:
    return value if isinstance(value, dict) else None


def text(value: Json | None) -> str | None:
    return value if isinstance(value, str) else None


def int_value(value: Json | None) -> int | None:
    return value if isinstance(value, int) else None


def parse_json_text(value: str) -> Json | None:
    try:
        return _loads(value)
    except json.JSONDecodeError:
        return None


def read_json(path: Path) -> Json | None:
    try:
        return parse_json_text(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return None


def iter_jsonl(path: Path) -> Iterator[JsonMap]:
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                value = parse_json_text(line)
                if isinstance(value, dict):
                    yield value
    except OSError:
        return


def dumps(value: JsonMap) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)
