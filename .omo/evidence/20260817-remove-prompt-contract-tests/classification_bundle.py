from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, ClassVar, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    StringConstraints,
    TypeAdapter,
    ValidationError,
)

Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Rationale = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Category = Literal[
    "machine-sentinel",
    "shipped-copy-equality",
    "parser-fixture",
    "runtime-behavior",
    "security-boundary",
    "user-ui-error",
]
Status = Literal["allowed", "forbidden"]


class ClassificationError(Exception):
    """Base error for invalid or inconsistent classification evidence."""


class ScannerOutputError(Exception):
    """Raised when the AST scanner emits invalid output."""


class ClassificationFormatError(ClassificationError):
    """Raised when a classification document does not match its typed schema."""


class ClassificationHashError(ClassificationError):
    """Raised when a hash-bound scanner or source has changed."""


class ClassificationConflictError(ClassificationError):
    """Raised when classifications are duplicated or conflict."""


class StrictModel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="forbid")


class ClassificationEntry(StrictModel):
    fingerprint: Sha256
    category: Category
    rationale: Rationale
    status: Status | None = None
    path: str | None = None
    line: int | None = None
    expected: str | None = None


class ClassificationDocument(StrictModel):
    version: Literal[1]
    allowed: tuple[ClassificationEntry, ...] = ()
    forbidden: tuple[ClassificationEntry, ...] = ()
    domain: str | None = None
    rule: str | None = None
    candidate_occurrence_count: int | None = None
    candidate_fingerprint_count: int | None = None


class ClassificationSource(StrictModel):
    path: str
    sha256: Sha256


class ClassificationIndex(StrictModel):
    version: Literal[1]
    rule: str | None = None
    scanner_hashes: dict[str, Sha256]
    sources: tuple[ClassificationSource, ...]
    active_fingerprints: tuple[Sha256, ...]


class BundleDisposition(StrictModel):
    status: Status
    category: Category
    rationale: Rationale


CLASSIFICATION_ADAPTER = TypeAdapter(ClassificationDocument)
INDEX_ADAPTER = TypeAdapter(ClassificationIndex)
ENVELOPE_ADAPTER: TypeAdapter[ClassificationDocument | ClassificationIndex] = (
    TypeAdapter(ClassificationDocument | ClassificationIndex)
)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _parse_classification_text(text: str, source: Path) -> ClassificationDocument:
    try:
        return CLASSIFICATION_ADAPTER.validate_json(text)
    except ValidationError as error:
        raise ClassificationFormatError(
            f"invalid classification document {source}: {error}"
        ) from error


def _parse_index_text(text: str, source: Path) -> ClassificationIndex:
    try:
        return INDEX_ADAPTER.validate_json(text)
    except ValidationError as error:
        raise ClassificationFormatError(
            f"invalid classification index {source}: {error}"
        ) from error


def parse_requested_document(
    path: Path,
) -> ClassificationDocument | ClassificationIndex:
    try:
        return ENVELOPE_ADAPTER.validate_json(path.read_text(encoding="utf-8"))
    except ValidationError as error:
        raise ClassificationFormatError(
            f"invalid classification input {path}: {error}"
        ) from error


def dispositions_from_document(
    document: ClassificationDocument,
) -> dict[str, BundleDisposition]:
    dispositions: dict[str, BundleDisposition] = {}
    _add_dispositions(dispositions, "allowed", document.allowed)
    _add_dispositions(dispositions, "forbidden", document.forbidden)
    return dispositions


def _add_dispositions(
    dispositions: dict[str, BundleDisposition],
    status: Status,
    entries: tuple[ClassificationEntry, ...],
) -> None:
    for entry in entries:
        disposition = BundleDisposition(
            status=status,
            category=entry.category,
            rationale=entry.rationale,
        )
        if entry.fingerprint in dispositions:
            message = f"duplicate candidate fingerprint: {entry.fingerprint}"
            raise ClassificationConflictError(message)
        dispositions[entry.fingerprint] = disposition


def load_direct_classification(path: Path) -> dict[str, BundleDisposition]:
    if not path.exists():
        raise ClassificationFormatError(f"classification file does not exist: {path}")
    return dispositions_from_document(
        _parse_classification_text(path.read_text(encoding="utf-8"), path)
    )


def load_classification_bundle(
    index_path: Path,
) -> tuple[Mapping[str, BundleDisposition], frozenset[str]]:
    document = _parse_index_text(index_path.read_text(encoding="utf-8"), index_path)
    active = frozenset(document.active_fingerprints)
    if len(active) != len(document.active_fingerprints):
        raise ClassificationConflictError(
            "active_fingerprints must not contain duplicates"
        )

    for relative, expected in document.scanner_hashes.items():
        if file_sha256(index_path.parent / relative) != expected:
            raise ClassificationHashError(f"scanner hash mismatch: {relative}")

    dispositions: dict[str, BundleDisposition] = {}
    for source in document.sources:
        path = index_path.parent / source.path
        if file_sha256(path) != source.sha256:
            raise ClassificationHashError(
                f"classification source hash mismatch: {source.path}"
            )
        payload = _parse_classification_text(path.read_text(encoding="utf-8"), path)
        source_dispositions = dispositions_from_document(payload)
        for fingerprint, disposition in source_dispositions.items():
            if fingerprint not in active:
                continue
            previous = dispositions.get(fingerprint)
            if previous is not None and previous != disposition:
                raise ClassificationConflictError(
                    f"conflicting classification: {fingerprint}"
                )
            dispositions[fingerprint] = disposition

    missing = active - dispositions.keys()
    if missing:
        raise ClassificationConflictError(
            f"active fingerprints lack classification: {len(missing)}"
        )
    return dispositions, active
