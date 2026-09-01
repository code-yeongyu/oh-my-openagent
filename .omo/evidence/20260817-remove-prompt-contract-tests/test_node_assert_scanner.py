# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.11,<3", "pytest>=8.4,<9"]
# ///
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from scanner_test_support import ROOT, scan_candidates


def test_node_assert_assertions_are_detected_in_javascript_tests(tmp_path: Path) -> None:
    fixture_root = ROOT / f".pytest-node-assert-fixtures-{tmp_path.name}"
    fixture_root.mkdir()
    fixtures = {
        "node-assert.fixture.test.js": '''
import * as assert from "node:assert";
const promptText = "must preserve JavaScript prompt guidance";
const actualValue = getValue();
const compatibilityGuidance = "must preserve expected compatibility guidance";
assert.equal(actualValue, compatibilityGuidance);
assert.equal(promptText, "must preserve loose equality guidance");
assert.strictEqual(promptText, "must preserve strict equality guidance");
assert.deepEqual(promptText, ["must preserve deep equality guidance"]);
assert.deepStrictEqual(promptText, ["must preserve deep strict equality guidance"]);
assert.notEqual(promptText, "must omit loose absence guidance");
assert.notStrictEqual(promptText, "must omit strict absence guidance");
assert.deepNotEqual(promptText, ["must omit deep absence guidance"]);
assert.deepNotStrictEqual(promptText, ["must omit deep strict absence guidance"]);
assert.match(promptText, /must preserve matching guidance/);
assert.doesNotMatch(promptText, /must never preserve forbidden guidance/);
assert.ok(promptText.includes("must preserve included guidance"));
assert.strict.equal(promptText, "must preserve strict namespace guidance");
''',
        "node-assert.fixture.test.mjs": '''
import assert from "node:assert/strict";
const promptText = "must preserve MJS prompt guidance";
assert.equal(promptText, "must preserve strict-module equality guidance");
assert.deepEqual(promptText, ["must preserve strict-module deep guidance"]);
assert.match(promptText, /must preserve strict-module matching guidance/);
assert.doesNotMatch(promptText, /must never preserve strict-module forbidden guidance/);
assert.ok(promptText.includes("must preserve strict-module included guidance"));
''',
        "node-assert.fixture.test.cjs": '''
const assert = require("node:assert");
const { strictEqual: same, match } = require("node:assert/strict");
const promptText = "must preserve CJS prompt guidance";
assert.equal(promptText, "must preserve CommonJS equality guidance");
assert.strict.deepEqual(promptText, ["must preserve CommonJS strict deep guidance"]);
same(promptText, "must preserve destructured strict guidance");
match(promptText, /must preserve destructured matching guidance/);
assert.ok(promptText.includes("must preserve CommonJS included guidance"));
''',
        "unrelated.fixture.test.js": '''
import assert from "node:assert";
assert.equal(1, 1);
assert.ok(true);
assert.notStrictEqual(1, 2);
const body = "workflow body";
const template = "release template";
assert.equal(body, "workflow completed successfully");
assert.match(template, /template workflow remains stable/);
''',
    }
    paths: list[Path] = []
    try:
        for name, source in fixtures.items():
            path = fixture_root / name
            _ = path.write_text(source, encoding="utf-8")
            paths.append(path)
        found = scan_candidates(paths)
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
        fixture_root.rmdir()

    expected_matchers = {
        "assert.equal", "assert.strictEqual", "assert.deepEqual", "assert.deepStrictEqual",
        "assert.notEqual", "assert.notStrictEqual", "assert.deepNotEqual", "assert.deepNotStrictEqual",
        "assert.match", "assert.doesNotMatch", "includes:assert.ok", "assert.strict.equal",
        "same", "match", "assert.strict.deepEqual",
    }
    assert expected_matchers <= {item.matcher for item in found}
    assert any(item.expected == "must preserve expected compatibility guidance" for item in found)
    assert {Path(item.path).suffix for item in found} == {".js", ".mjs", ".cjs"}
    assert not any(item.path.endswith("unrelated.fixture.test.js") for item in found)


def test_sync_skills_codex_compatibility_node_assertions_yield_candidates() -> None:
    path = ROOT / "packages/omo-codex/plugin/test/sync-skills-codex-compatibility.test.mjs"
    found = scan_candidates([path])
    by_matcher_kind = {(item.matcher, item.kind) for item in found}
    truthy_lines = {item.line for item in found if item.kind == "truthy-assertion"}

    assert ("assert.equal", "shipped-copy-equality") in by_matcher_kind
    assert ("assert.ok", "truthy-assertion") in by_matcher_kind
    assert ("assert.match", "matcher") in by_matcher_kind
    assert {24, 83, 85, 86} <= truthy_lines
    assert all(item.path == path.relative_to(ROOT).as_posix() for item in found)


def test_callable_node_assert_aliases_only_emit_instruction_assertions(tmp_path: Path) -> None:
    fixture_root = ROOT / f".pytest-callable-assert-fixtures-{tmp_path.name}"
    fixture_root.mkdir()
    fixtures = {
        "default.fixture.test.mjs": '''
import verify from "node:assert";
const promptText = "default alias prompt";
verify(promptText.includes("must preserve default callable guidance"));
verify(true);
''',
        "namespace.fixture.test.js": '''
import * as ensure from "node:assert/strict";
const promptText = "namespace alias prompt";
ensure(promptText.includes("must preserve namespace callable guidance"));
ensure(true);
''',
        "require.fixture.test.cjs": '''
const check = require("node:assert");
const promptText = "require alias prompt";
check(promptText.includes("must preserve require callable guidance"));
check(true);
''',
    }
    paths: list[Path] = []
    try:
        for name, source in fixtures.items():
            path = fixture_root / name
            _ = path.write_text(source, encoding="utf-8")
            paths.append(path)
        found = scan_candidates(paths)
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
        fixture_root.rmdir()

    assert {(item.matcher, item.expected) for item in found} == {
        ("includes:verify", "must preserve default callable guidance"),
        ("includes:ensure", "must preserve namespace callable guidance"),
        ("includes:check", "must preserve require callable guidance"),
        ("verify", "<truthy instruction assertion>"),
        ("ensure", "<truthy instruction assertion>"),
        ("check", "<truthy instruction assertion>"),
    }


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, *sys.argv[1:]]))
