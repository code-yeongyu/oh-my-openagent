"""Typed immutable records exchanged across prompt-contract scanner boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal

from classification_bundle import Category
from pydantic import BaseModel, ConfigDict

Status = Literal["allowed", "unclassified", "forbidden"]


class FrozenModel(BaseModel):
    """Base for immutable strict scanner payload models."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="forbid")


class Candidate(FrozenModel):
    """Candidate emitted by the TypeScript AST scanner."""

    path: str
    line: int
    column: int
    kind: str
    matcher: str
    actual: str
    expected: str
    fingerprint: str


class AstPayload(FrozenModel):
    """Typed top-level output from the TypeScript AST scanner."""

    parser: str
    candidates: tuple[Candidate, ...]


class ClassifiedCandidate(Candidate):
    """AST candidate joined to its explicit disposition."""

    status: Status
    category: Category | None
    rationale: str | None


class Summary(FrozenModel):
    """Complete machine-readable audit result."""

    root: str
    parser: str
    tracked_test_count: int
    existing_tracked_test_count: int
    missing_tracked_test_count: int
    candidate_count: int
    classified_allowed_count: int
    unclassified_count: int
    forbidden_count: int
    stale_classification_count: int
    missing_tracked_tests: tuple[str, ...]
    stale_classifications: tuple[str, ...]
    candidates: tuple[ClassifiedCandidate, ...]


@dataclass(frozen=True, slots=True)
class Disposition:
    """Classification data used while joining candidates."""

    status: Status
    category: Category | None = None
    rationale: str | None = None


@dataclass(frozen=True, slots=True)
class Options:
    """Typed command-line options."""

    root: Path
    classification: Path | None
    compact: bool
