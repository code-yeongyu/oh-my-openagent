# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.11,<3", "pytest>=8.4,<9"]
# ///
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import audit_prompt_contracts as audit
import pytest
from classification_bundle import ClassificationFormatError, ClassificationHashError
from pydantic import TypeAdapter
from scanner_models import AstPayload, Candidate, Disposition

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
AST_SCANNER = HERE / "prompt_contract_ast.mjs"
FIXTURES = HERE / "fixtures"


@pytest.fixture(scope="module")
def candidates() -> tuple[Candidate, ...]:
    fixture_paths = sorted(
        path.relative_to(ROOT).as_posix() for path in FIXTURES.glob("*.fixture.ts")
    )
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as handle:
        json.dump(fixture_paths, handle)
        handle.flush()
        result = subprocess.run(
            [
                "node",
                str(AST_SCANNER),
                "--root",
                str(ROOT),
                "--files-json",
                handle.name,
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    return TypeAdapter(AstPayload).validate_json(result.stdout).candidates


def candidates_for(
    candidates: tuple[Candidate, ...], fixture: str
) -> Iterator[Candidate]:
    suffix = f"fixtures/{fixture}"
    return (item for item in candidates if item.path.endswith(suffix))


def test_project_skill_includes_and_negative_assertion_are_detected(
    candidates: tuple[Candidate, ...],
) -> None:
    found = tuple(
        candidates_for(candidates, "project-skill-tool-references.fixture.ts")
    )
    expected = {item.expected for item in found}
    kinds = {item.kind for item in found}
    assert "commits through `git-master`" in expected
    assert 'task_create(subject="Triage: #{number} {title}")' in expected
    assert 'task_update(id=task_id, status="completed")' in expected
    assert any(item.matcher == "not.toContain" for item in found)
    assert "includes-boolean" in kinds


def test_team_mode_headings_resolve_through_for_of_loop(
    candidates: tuple[Candidate, ...],
) -> None:
    found = tuple(candidates_for(candidates, "team-mode.fixture.ts"))
    expected = {item.expected for item in found}
    assert {
        "## Lead-only tools",
        "## Universal team-run tools",
        "## Global query tool",
    } <= expected
    assert "team_shutdown_request - ask the lead to wind down" in expected


def test_playwright_marker_array_is_detected_through_order_helper(
    candidates: tuple[Candidate, ...],
) -> None:
    found = tuple(candidates_for(candidates, "playwright.fixture.ts"))
    order_markers = {item.expected for item in found if item.kind == "order-helper"}
    assert order_markers == {
        "# Browser Automation with agent-browser",
        "## Quick start",
        "## Core workflow",
        "### Navigation",
    }
    assert any(item.matcher == "toStartWith" for item in found)
    assert any(item.matcher == "toEndWith" for item in found)


def test_memory_assets_and_seeds_derived_contracts_are_detected(
    candidates: tuple[Candidate, ...],
) -> None:
    found = tuple(candidates_for(candidates, "memory-assets-seeds.fixture.ts"))
    expected_by_kind = {(item.kind, item.expected) for item in found}
    assert ("derived-array-equality", "Phase 1: Investigate") in expected_by_kind
    assert ("relative-order", "`update`:") in expected_by_kind
    assert (
        "relative-order",
        "when unsure between `create` and `none`, choose `none`",
    ) in expected_by_kind
    assert ("starts-with", "This skill should be used when") in expected_by_kind
    assert (
        "presentation-regex",
        "/^(feat|fix|chore)\\(reflection\\): /",
    ) in expected_by_kind
    assert ("authored-non-empty", "<non-empty authored text>") in expected_by_kind


def test_category_resolver_direct_prompt_and_prompt_assertions_are_detected(
    candidates: tuple[Candidate, ...],
) -> None:
    found = tuple(candidates_for(candidates, "category-resolver.fixture.ts"))
    by_kind = {(item.kind, item.expected) for item in found}
    assert (
        "direct-category-prompt",
        "Investigate the failure thoroughly before changing implementation code.",
    ) in by_kind
    assert ("matcher", "operating in DEEP mode") in by_kind
    assert ("matcher", "Skip exploration and edit immediately") in by_kind


def test_fingerprints_are_sha256_and_line_independent(
    candidates: tuple[Candidate, ...],
) -> None:
    assert all(
        len(item.fingerprint) == 64 and int(item.fingerprint, 16) >= 0
        for item in candidates
    )
    first = candidates[0]
    moved = first.model_copy(
        update={"line": first.line + 100, "column": first.column + 4}
    )
    dispositions = {
        first.fingerprint: Disposition(
            "allowed", "runtime-behavior", "Exercises dispatch."
        )
    }
    classified, used = audit.classify_candidates([moved], dispositions)
    assert classified[0].status == "allowed"
    assert used == {first.fingerprint}


def test_tracked_tests_enumerates_only_tracked_test_files(tmp_path: Path) -> None:
    tracked_paths = (
        "src/alpha.test.ts",
        "src/bravo.spec.mjs",
        "src/nested/charlie.test.js",
    )
    ignored_paths = ("src/runtime.ts", "src/fixture.test.ts.snap")
    for relative in (*tracked_paths, *ignored_paths):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        _ = path.write_text("export {}\n", encoding="utf-8")
    _ = subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    _ = subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)

    tracked = audit.tracked_tests(tmp_path)

    assert tracked == list(tracked_paths)


def test_allowed_entry_requires_non_empty_rationale_and_category(
    tmp_path: Path,
) -> None:
    path = tmp_path / "classification.json"
    _ = path.write_text(
        json.dumps(
            {
                "version": 1,
                "allowed": [
                    {
                        "fingerprint": "0" * 64,
                        "category": "runtime-behavior",
                        "rationale": "",
                    }
                ],
                "forbidden": [],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ClassificationFormatError, match="at least 1 character"):
        _ = audit.load_classification(path)


def test_indexed_classification_rejects_hash_mismatch(tmp_path: Path) -> None:
    source = tmp_path / "source.json"
    _ = source.write_text('{"version":1,"allowed":[],"forbidden":[]}', encoding="utf-8")
    index = tmp_path / "index.json"
    _ = index.write_text(
        json.dumps(
            {
                "version": 1,
                "active_fingerprints": [],
                "scanner_hashes": {},
                "sources": [{"path": "source.json", "sha256": "0" * 64}],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ClassificationHashError, match="source hash mismatch"):
        _ = audit.load_indexed_classification(index)


def test_indexed_classification_loads_only_active_fingerprints(tmp_path: Path) -> None:
    active = "1" * 64
    stale = "2" * 64
    source = tmp_path / "source.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 1,
                "allowed": [
                    {
                        "fingerprint": active,
                        "category": "runtime-behavior",
                        "rationale": "Active seam.",
                    },
                    {
                        "fingerprint": stale,
                        "category": "runtime-behavior",
                        "rationale": "Historical seam.",
                    },
                ],
                "forbidden": [],
            }
        ),
        encoding="utf-8",
    )
    index = tmp_path / "index.json"
    _ = index.write_text(
        json.dumps(
            {
                "version": 1,
                "active_fingerprints": [active],
                "scanner_hashes": {},
                "sources": [
                    {
                        "path": "source.json",
                        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    dispositions = audit.load_indexed_classification(index)
    assert set(dispositions) == {active}


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, *sys.argv[1:]]))
