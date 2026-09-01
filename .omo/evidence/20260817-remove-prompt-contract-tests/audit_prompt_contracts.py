#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.11,<3"]
# ///
"""Audit tracked tests for prompt/prose contract assertions."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import cast

import scanner_bootstrap
from classification_bundle import (
    BundleDisposition,
    ClassificationError,
    ClassificationIndex,
    ScannerOutputError,
    load_classification_bundle,
    load_direct_classification,
    parse_requested_document,
)
from pydantic import TypeAdapter, ValidationError
from scanner_models import (
    AstPayload,
    Candidate,
    ClassifiedCandidate,
    Disposition,
    Options,
    Summary,
)

_ = scanner_bootstrap.DEPENDENCIES_READY

TEST_PATH = re.compile(r"(?:^|/).+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$")
EVIDENCE_RELATIVE = ".omo/evidence/20260817-remove-prompt-contract-tests"
DEFAULT_CLASSIFICATION = Path(EVIDENCE_RELATIVE, "prompt-contract-classification.json")
DEFAULT_CLASSIFICATION_INDEX = Path(
    EVIDENCE_RELATIVE, "prompt-contract-classification-index.json"
)


def repository_root(start: Path) -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=start,
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip()).resolve()


def tracked_tests(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True
    )
    decoded = (item.decode("utf-8") for item in result.stdout.split(b"\0") if item)
    return sorted(path for path in decoded if TEST_PATH.search(path))


def load_classification(path: Path) -> dict[str, Disposition]:
    return _convert_dispositions(load_direct_classification(path))


def load_indexed_classification(path: Path) -> dict[str, Disposition]:
    bundled, _active = load_classification_bundle(path)
    return _convert_dispositions(bundled)


def _convert_dispositions(
    items: Mapping[str, BundleDisposition],
) -> dict[str, Disposition]:
    return {
        fingerprint: Disposition(item.status, item.category, item.rationale)
        for fingerprint, item in items.items()
    }


def load_requested_classification(path: Path) -> dict[str, Disposition]:
    document = parse_requested_document(path)
    if isinstance(document, ClassificationIndex):
        return load_indexed_classification(path)
    return load_classification(path)


def run_ast_scanner(
    root: Path, paths: Sequence[str], ast_script: Path
) -> tuple[AstPayload, tuple[str, ...]]:
    existing = [relative for relative in paths if (root / relative).is_file()]
    missing = tuple(relative for relative in paths if not (root / relative).is_file())
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as handle:
        json.dump(existing, handle)
        handle.flush()
        result = subprocess.run(
            ["node", str(ast_script), "--root", str(root), "--files-json", handle.name],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
    try:
        return TypeAdapter(AstPayload).validate_json(result.stdout), missing
    except ValidationError as error:
        raise ScannerOutputError(f"invalid AST scanner output: {error}") from error


def classify_candidates(
    candidates: Sequence[Candidate], dispositions: Mapping[str, Disposition]
) -> tuple[list[ClassifiedCandidate], set[str]]:
    used: set[str] = set()
    classified: list[ClassifiedCandidate] = []
    for candidate in candidates:
        disposition = dispositions.get(
            candidate.fingerprint, Disposition("unclassified")
        )
        if candidate.fingerprint in dispositions:
            used.add(candidate.fingerprint)
        classified.append(
            ClassifiedCandidate(
                path=candidate.path,
                line=candidate.line,
                column=candidate.column,
                kind=candidate.kind,
                matcher=candidate.matcher,
                actual=candidate.actual,
                expected=candidate.expected,
                fingerprint=candidate.fingerprint,
                status=disposition.status,
                category=disposition.category,
                rationale=disposition.rationale,
            )
        )
    return classified, used


def summary_payload(
    root: Path,
    tracked: Sequence[str],
    ast: AstPayload,
    missing: tuple[str, ...],
    candidates: Sequence[ClassifiedCandidate],
    stale: tuple[str, ...],
) -> Summary:
    allowed = sum(candidate.status == "allowed" for candidate in candidates)
    unclassified = sum(candidate.status == "unclassified" for candidate in candidates)
    forbidden = sum(candidate.status == "forbidden" for candidate in candidates)
    return Summary(
        root=str(root),
        parser=ast.parser,
        tracked_test_count=len(tracked),
        existing_tracked_test_count=len(tracked) - len(missing),
        missing_tracked_test_count=len(missing),
        candidate_count=len(candidates),
        classified_allowed_count=allowed,
        unclassified_count=unclassified,
        forbidden_count=forbidden,
        stale_classification_count=len(stale),
        missing_tracked_tests=missing,
        stale_classifications=stale,
        candidates=tuple(candidates),
    )


def print_compact(payload: Summary) -> None:
    header = payload.model_dump(
        exclude={"missing_tracked_tests", "stale_classifications", "candidates"}
    )
    print(json.dumps(header, ensure_ascii=False))
    for candidate in payload.candidates:
        location = f"{candidate.path}:{candidate.line}:{candidate.column}"
        classification = f"[{candidate.status}/{candidate.kind}/{candidate.matcher}]"
        print(
            f"{location} {classification} {candidate.fingerprint} {candidate.expected}"
        )
    for relative in payload.missing_tracked_tests:
        print(f"{relative}:0:0 [tracked-missing] working-tree file is absent")
    for fingerprint in payload.stale_classifications:
        print(f"<classification>:0:0 [stale] {fingerprint}")


def parse_args(argv: Sequence[str]) -> Options:
    parser = argparse.ArgumentParser(description=__doc__)
    _ = parser.add_argument("--root", type=Path, default=Path.cwd())
    _ = parser.add_argument("--classification", type=Path)
    _ = parser.add_argument("--compact", action="store_true")
    namespace = parser.parse_args(argv)
    return Options(
        root=cast(Path, namespace.root),
        classification=cast(Path | None, namespace.classification),
        compact=cast(bool, namespace.compact),
    )


def main(argv: Sequence[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        root = repository_root(options.root.resolve())
        evidence = Path(__file__).resolve().parent
        if options.classification is not None:
            dispositions = load_requested_classification(
                options.classification.resolve()
            )
        else:
            index_path = root / DEFAULT_CLASSIFICATION_INDEX
            dispositions = (
                load_indexed_classification(index_path)
                if index_path.exists()
                else load_classification(root / DEFAULT_CLASSIFICATION)
            )
        tracked = tracked_tests(root)
        ast, missing = run_ast_scanner(
            root, tracked, evidence / "prompt_contract_ast.mjs"
        )
        classified, used = classify_candidates(ast.candidates, dispositions)
        stale = tuple(sorted(set(dispositions) - used))
        payload = summary_payload(root, tracked, ast, missing, classified, stale)
    except (
        OSError,
        ClassificationError,
        ScannerOutputError,
        subprocess.CalledProcessError,
    ) as error:
        if isinstance(error, subprocess.CalledProcessError):
            stderr = cast(str | None, error.stderr)
            if isinstance(stderr, str) and stderr:
                print(stderr.rstrip(), file=sys.stderr)
        print(f"prompt-contract audit failed: {error}", file=sys.stderr)
        return 2

    if options.compact:
        print_compact(payload)
    else:
        print(payload.model_dump_json(indent=2))
    return int(
        bool(
            payload.unclassified_count
            or payload.forbidden_count
            or payload.stale_classification_count
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
