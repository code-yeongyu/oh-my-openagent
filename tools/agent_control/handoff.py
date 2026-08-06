"""Validated project-local context handoffs for AgentControl workers."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

MAX_HANDOFF_BYTES = 128 * 1024
SCHEMA = "agentcontrol-handoff/v1"
ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
FRONTMATTER_KEY_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$")
HEADING_PATTERN = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
REQUIRED_METADATA = ("schema", "id", "action", "projectRoot", "sourceRevision", "status")
REQUIRED_SECTIONS = (
    "Goal",
    "Done when",
    "Workspace",
    "Scope",
    "Source map",
    "Claims and decisions",
    "Acceptance atoms",
    "Verification",
    "Deliverable",
)


class HandoffValidationError(ValueError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class HandoffMetadata:
    id: str
    action: str
    path: Path
    sha256: str
    source_revision: str

    def public(self) -> dict[str, str]:
        return {"id": self.id, "path": str(self.path), "sha256": self.sha256}


def _frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise HandoffValidationError("HANDOFF_FRONTMATTER_REQUIRED", "first line must be ---")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise HandoffValidationError("HANDOFF_FRONTMATTER_UNTERMINATED", "closing --- is missing") from exc
    values: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        match = FRONTMATTER_KEY_PATTERN.fullmatch(line)
        if match is None:
            raise HandoffValidationError("HANDOFF_FRONTMATTER_INVALID", f"invalid metadata line: {line}")
        key, value = match.groups()
        if key in values:
            raise HandoffValidationError("HANDOFF_FRONTMATTER_DUPLICATE", f"duplicate metadata key: {key}")
        values[key] = value.strip('"\'')
    missing = [key for key in REQUIRED_METADATA if not values.get(key)]
    if missing:
        raise HandoffValidationError("HANDOFF_METADATA_MISSING", f"missing metadata: {', '.join(missing)}")
    return values


def _sections(text: str, action: str) -> None:
    matches = list(HEADING_PATTERN.finditer(text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        heading = match.group(1)
        if heading in sections:
            raise HandoffValidationError("HANDOFF_SECTION_DUPLICATE", f"duplicate section: {heading}")
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[heading] = text[match.end():end].strip()
    required = [*REQUIRED_SECTIONS]
    if action in {"execute", "dispatch"}:
        required.append("Mutation boundary")
    missing = [heading for heading in required if heading not in sections]
    if missing:
        raise HandoffValidationError("HANDOFF_SECTION_MISSING", f"missing sections: {', '.join(missing)}")
    empty = [heading for heading in required if not sections[heading]]
    if empty:
        raise HandoffValidationError("HANDOFF_SECTION_EMPTY", f"empty sections: {', '.join(empty)}")


def validate_handoff(project: Path, supplied_path: str, action: str) -> HandoffMetadata:
    root = project.resolve()
    if not isinstance(supplied_path, str) or not supplied_path.strip():
        raise HandoffValidationError("HANDOFF_REQUIRED", "handoff path is required")
    candidate = Path(supplied_path).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        path = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HandoffValidationError("HANDOFF_NOT_FOUND", f"handoff does not exist: {candidate}") from exc
    if not path.is_relative_to(root):
        raise HandoffValidationError("HANDOFF_OUTSIDE_PROJECT", f"handoff must be inside {root}")
    if not path.is_file():
        raise HandoffValidationError("HANDOFF_NOT_FILE", f"handoff is not a regular file: {path}")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise HandoffValidationError("HANDOFF_UNREADABLE", str(exc)) from exc
    if size > MAX_HANDOFF_BYTES:
        raise HandoffValidationError("HANDOFF_TOO_LARGE", f"handoff is {size} bytes; maximum is {MAX_HANDOFF_BYTES}")
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise HandoffValidationError("HANDOFF_UNREADABLE", str(exc)) from exc
    metadata = _frontmatter(text)
    if metadata["schema"] != SCHEMA:
        raise HandoffValidationError("HANDOFF_SCHEMA_UNSUPPORTED", f"expected schema {SCHEMA}")
    if ID_PATTERN.fullmatch(metadata["id"]) is None:
        raise HandoffValidationError("HANDOFF_ID_INVALID", f"invalid handoff id: {metadata['id']}")
    if metadata["action"] != action:
        raise HandoffValidationError(
            "HANDOFF_ACTION_MISMATCH",
            f"handoff action {metadata['action']} does not match requested action {action}",
        )
    if metadata["status"] != "ready":
        raise HandoffValidationError("HANDOFF_NOT_READY", "handoff status must be ready")
    declared_root = root if metadata["projectRoot"] == "." else Path(metadata["projectRoot"]).expanduser()
    if not declared_root.is_absolute():
        declared_root = root / declared_root
    if declared_root.resolve() != root:
        raise HandoffValidationError("HANDOFF_PROJECT_MISMATCH", "projectRoot does not match the launch project")
    _sections(text, action)
    return HandoffMetadata(
        id=metadata["id"],
        action=action,
        path=path,
        sha256=hashlib.sha256(raw).hexdigest(),
        source_revision=metadata["sourceRevision"],
    )
