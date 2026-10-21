from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable, Iterator
from pathlib import Path

from .jsonio import parse_json_text
from .types import Json

BODY_SUFFIXES = frozenset({".json", ".jsonl"})
# Opaque blobs (reasoning signatures, encrypted reasoning, base64 attachments) would only produce accidental substring hits.
OPAQUE_KEYS = frozenset({"data", "encrypted_content"})
SNIPPET_LEAD = 60
SNIPPET_WIDTH = 160


def fold(value: str) -> str:
    """Case- and normalization-insensitive form: macOS paths and IME input mix NFC and NFD Hangul."""
    return unicodedata.normalize("NFC", value).lower()


def snippet(value: str, needle: str) -> str:
    value = unicodedata.normalize("NFC", value)
    start = max(value.lower().find(needle) - SNIPPET_LEAD, 0)
    return value[start : start + SNIPPET_WIDTH]


def body_snippet(path: Path, needle: str) -> str | None:
    """Snippet around `needle` (already folded) in any text of the transcript file, or None."""
    if path.suffix not in BODY_SUFFIXES:
        return None
    forms = _raw_forms(needle)
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            for chunk in handle if path.suffix == ".jsonl" else (handle.read(),):
                if not _may_contain(chunk, forms):
                    continue
                for value in _strings(parse_json_text(chunk)):
                    if needle in fold(value):
                        return snippet(value, needle)
    except OSError:
        return None
    return None


def _raw_forms(needle: str) -> tuple[str, ...]:
    # The file stores text either verbatim or as \uXXXX escapes, in NFC or NFD; decode only chunks that could match.
    variants = {needle, unicodedata.normalize("NFD", needle)}
    return tuple(variants | {json.dumps(variant)[1:-1] for variant in variants})


def _may_contain(chunk: str, forms: Iterable[str]) -> bool:
    lowered = chunk.lower()
    return any(form in lowered for form in forms)


def _strings(value: Json | None) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key not in OPAQUE_KEYS and "signature" not in key.lower():
                yield from _strings(item)
