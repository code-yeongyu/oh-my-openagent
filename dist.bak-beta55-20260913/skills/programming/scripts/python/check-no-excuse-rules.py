#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# noqa: SIZE_OK  — single self-contained checker, splitting adds import ceremony for no readability gain
"""Check Python files for no-excuse violations.

The python-programmer skill enforces these rules. Run after editing.

Rules:
  cast-any             - cast(Any, ...) / cast(typing.Any, ...) / typing.cast(Any, ...)
  type-ignore          - `# type: ignore` comments (any variant)
  pyright-ignore       - `# pyright: ignore` comments (any variant)
  bare-except          - `except:` with no class
  silent-except        - `except X: pass` or `except X: ...` (single statement)
  no-asyncio           - `import asyncio` / `from asyncio import ...`
                         Opt out per import line: trailing `# noqa: ANYIO_OK`
  no-pandas            - `import pandas` / `from pandas import ...`
                         Opt out per import line: trailing `# noqa: PANDAS_OK`
  mutable-dataclass    - @dataclass without frozen=True
                         Opt out: trailing `# noqa: MUTABLE_OK`
  missing-slots        - @dataclass without slots=True
                         Opt out: trailing `# noqa: SLOTS_OK`
  raw-dict-return      - function returns bare `dict` type
                         Opt out: trailing `# noqa: DICT_OK`
  missing-assert-never - match statement without assert_never in default case
                         Opt out: `# noqa: MATCH_OK` on the match line
  generic-exception    - raise ValueError/TypeError/RuntimeError with bare string
                         Opt out: trailing `# noqa: GENERIC_ERR_OK`
  no-object            - `object` used as type annotation (param, return, variable)
                         Opt out: trailing `# noqa: OBJECT_OK`
  if-elif-on-variant   - isinstance/enum-comparison if/elif chain (should be match/case)
                         Opt out: trailing `# noqa: IF_VARIANT_OK`
  oversized-module     - file exceeds 250 pure LOC (non-blank, non-comment)
                         Opt out: `# noqa: SIZE_OK` in first 10 lines
  broad-except         - `except Exception` / `except BaseException` (too broad)
                         Opt out: trailing `# noqa: BROAD_EXCEPT_OK`

Usage:
  check-no-excuse-rules.py <file-or-dir>...

Exit codes:
  0 - no violations
  1 - one or more violations
  2 - input error (path missing, etc.)
"""
from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

EXCLUDED_DIRS = frozenset({
    ".git", ".hg", ".svn", ".venv", "venv", "env", ".env",
    "__pycache__", ".tox", ".nox", "dist", "build", ".eggs",
    ".ruff_cache", ".mypy_cache", ".pytest_cache", ".basedpyright",
    "node_modules",
})

SUPPRESSION_RE = re.compile(r"#\s*(type|pyright)\s*:\s*ignore\b")
ANYIO_OK_RE = re.compile(r"#\s*noqa:\s*ANYIO_OK\b")
PANDAS_OK_RE = re.compile(r"#\s*noqa:\s*PANDAS_OK\b")

BANNED_IMPORTS: dict[str, tuple[str, re.Pattern[str], str]] = {
    "asyncio": (
        "no-asyncio",
        ANYIO_OK_RE,
        "import asyncio - use anyio (opt out: trailing `# noqa: ANYIO_OK`)",
    ),
    "pandas": (
        "no-pandas",
        PANDAS_OK_RE,
        "import pandas - use polars (opt out: trailing `# noqa: PANDAS_OK`)",
    ),
}

# Opt-out patterns for new Rust-like rules
MUTABLE_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*MUTABLE_OK")
SLOTS_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*SLOTS_OK")
DICT_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*DICT_OK")
MATCH_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*MATCH_OK")
GENERIC_ERR_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*GENERIC_ERR_OK")
OBJECT_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*OBJECT_OK")
IF_VARIANT_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*IF_VARIANT_OK")
SIZE_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*SIZE_OK")
BROAD_EXCEPT_OK_RE: re.Pattern[str] = re.compile(r"#\s*noqa:\s*BROAD_EXCEPT_OK")

PURE_LOC_LIMIT: int = 250


@dataclass(frozen=True, slots=True)
class Violation:
    rule: str
    file: Path
    line: int
    col: int
    message: str

    def render(self) -> str:
        return f"{self.file}:{self.line}:{self.col}: [{self.rule}] {self.message}"


def discover_files(inputs: Iterable[Path]) -> list[Path]:
    seen: set[Path] = set()
    for raw in inputs:
        path = raw.resolve()
        if not path.exists():
            print(f"check-no-excuse-rules: input does not exist: {path}", file=sys.stderr)
            sys.exit(2)
        if path.is_file():
            if path.suffix == ".py":
                seen.add(path)
            continue
        for child in path.rglob("*.py"):
            if any(part in EXCLUDED_DIRS for part in child.parts):
                continue
            seen.add(child)
    return sorted(seen)


def is_any_node(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return node.id == "Any"
    if isinstance(node, ast.Attribute):
        return node.attr == "Any"
    return False


def is_cast_callable(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return node.id == "cast"
    if isinstance(node, ast.Attribute):
        return node.attr == "cast"
    return False


def find_node_violations(tree: ast.AST, file: Path) -> list[Violation]:
    violations: list[Violation] = []

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and is_cast_callable(node.func)
            and node.args
            and is_any_node(node.args[0])
        ):
            violations.append(Violation(
                rule="cast-any",
                file=file,
                line=node.lineno,
                col=node.col_offset + 1,
                message="cast(Any, ...) - narrow with isinstance/TypeGuard or use a Protocol/TypedDict",
            ))

        if isinstance(node, ast.ExceptHandler):
            if node.type is None:
                violations.append(Violation(
                    rule="bare-except",
                    file=file,
                    line=node.lineno,
                    col=node.col_offset + 1,
                    message="bare `except:` - catch the narrowest exception you mean",
                ))

            if len(node.body) != 1:
                continue

            body = node.body[0]
            if isinstance(body, ast.Pass):
                violations.append(Violation(
                    rule="silent-except",
                    file=file,
                    line=body.lineno,
                    col=body.col_offset + 1,
                    message="silent `except: pass` - log, re-raise, or actually handle the error",
                ))
            elif (
                isinstance(body, ast.Expr)
                and isinstance(body.value, ast.Constant)
                and body.value.value is Ellipsis
            ):
                violations.append(Violation(
                    rule="silent-except",
                    file=file,
                    line=body.lineno,
                    col=body.col_offset + 1,
                    message="silent `except: ...` - log, re-raise, or actually handle the error",
                ))

    return violations


def find_import_violations(tree: ast.AST, source_lines: list[str], file: Path) -> list[Violation]:
    violations: list[Violation] = []

    def line_text(lineno: int) -> str:
        index = lineno - 1
        return source_lines[index] if 0 <= index < len(source_lines) else ""

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):  # noqa: IF_VARIANT_OK  — filtering walk, not closed union
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in BANNED_IMPORTS:
                    continue
                rule, opt_re, message = BANNED_IMPORTS[top]
                if opt_re.search(line_text(node.lineno)):
                    continue
                violations.append(Violation(
                    rule=rule,
                    file=file,
                    line=node.lineno,
                    col=node.col_offset + 1,
                    message=message,
                ))
        elif isinstance(node, ast.ImportFrom):
            top = (node.module or "").split(".")[0]
            if top not in BANNED_IMPORTS:
                continue
            rule, opt_re, message = BANNED_IMPORTS[top]
            if opt_re.search(line_text(node.lineno)):
                continue
            violations.append(Violation(
                rule=rule,
                file=file,
                line=node.lineno,
                col=node.col_offset + 1,
                message=message,
            ))

    return violations


def find_comment_violations(source: str, file: Path) -> list[Violation]:
    """Use tokenize so we don't false-match `# type: ignore` inside string literals."""
    violations: list[Violation] = []
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except tokenize.TokenError as exc:
        print(f"check-no-excuse-rules: tokenize failed for {file}: {exc}", file=sys.stderr)
        return violations

    for tok in tokens:
        if tok.type != tokenize.COMMENT:
            continue
        match = SUPPRESSION_RE.search(tok.string)
        if not match:
            continue
        kind = match.group(1)
        rule = "type-ignore" if kind == "type" else "pyright-ignore"
        violations.append(Violation(
            rule=rule,
            file=file,
            line=tok.start[0],
            col=tok.start[1] + match.start() + 1,
            message=f"`# {kind}: ignore` - fix the underlying type instead",
        ))
    return violations


# ─────────────────────────────────────────────────────────────────
# Rust-like pattern checks
# ─────────────────────────────────────────────────────────────────


def _has_keyword(decorator_node: ast.Call, keyword: str) -> bool | None:
    """Check if a decorator call has a specific keyword argument.

    Returns True if keyword is True, False if keyword is False or absent, None if not a Call.
    """
    for kw in decorator_node.keywords:
        if kw.arg == keyword and isinstance(kw.value, ast.Constant):
            return bool(kw.value.value)
    return False


def _is_dataclass_decorator(node: ast.expr) -> tuple[bool, ast.Call | None]:
    """Return (is_dataclass, call_node_or_None)."""
    if isinstance(node, ast.Name) and node.id == "dataclass":
        return True, None
    if isinstance(node, ast.Attribute) and node.attr == "dataclass":
        return True, None
    if isinstance(node, ast.Call):
        inner, _ = _is_dataclass_decorator(node.func)
        if inner:
            return True, node
    return False, None


def find_dataclass_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check @dataclass decorators for frozen=True and slots=True."""
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for dec in node.decorator_list:
            is_dc, call_node = _is_dataclass_decorator(dec)
            if not is_dc:
                continue

            # Get the line of the decorator for opt-out check
            dec_line = source_lines[dec.lineno - 1] if dec.lineno <= len(source_lines) else ""

            if call_node is not None:
                has_frozen = _has_keyword(call_node, "frozen")
                has_slots = _has_keyword(call_node, "slots")
            else:
                # bare @dataclass with no arguments
                has_frozen = False
                has_slots = False

            if not has_frozen and not MUTABLE_OK_RE.search(dec_line):
                violations.append(Violation(
                    rule="mutable-dataclass",
                    file=file,
                    line=dec.lineno,
                    col=dec.col_offset + 1,
                    message=f"class {node.name}: @dataclass without frozen=True",
                ))

            if not has_slots and not SLOTS_OK_RE.search(dec_line):
                violations.append(Violation(
                    rule="missing-slots",
                    file=file,
                    line=dec.lineno,
                    col=dec.col_offset + 1,
                    message=f"class {node.name}: @dataclass without slots=True",
                ))
    return violations


def find_dict_return_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check for functions returning bare `dict` type."""
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        ret = node.returns
        if ret is None:
            continue
        # Check for bare `dict` return annotation
        is_bare_dict = (
            (isinstance(ret, ast.Name) and ret.id == "dict")
            or (isinstance(ret, ast.Attribute) and ret.attr == "dict")
        )
        if not is_bare_dict:
            continue

        func_line = source_lines[node.lineno - 1] if node.lineno <= len(source_lines) else ""
        if DICT_OK_RE.search(func_line):
            continue

        violations.append(Violation(
            rule="raw-dict-return",
            file=file,
            line=node.lineno,
            col=node.col_offset + 1,
            message=f"`{node.name}` returns bare dict - use TypedDict/dataclass/Pydantic model",
        ))
    return violations


def find_match_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check match statements for assert_never in default case."""
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Match):
            continue

        match_line = source_lines[node.lineno - 1] if node.lineno <= len(source_lines) else ""
        if MATCH_OK_RE.search(match_line):
            continue

        has_assert_never = False
        for case in node.cases:
            # Wildcard: `case _:` -> MatchAs(pattern=None, name=None)
            #           `case _ as x:` -> MatchAs(pattern=MatchAs(pattern=None, name=None), name="x")
            pattern = case.pattern
            is_wildcard = (
                isinstance(pattern, ast.MatchAs)
                and (
                    pattern.pattern is None
                    or (
                        isinstance(pattern.pattern, ast.MatchAs)
                        and pattern.pattern.pattern is None
                        and pattern.pattern.name is None
                    )
                )
            )
            if not is_wildcard:
                continue
            # Check if body contains assert_never call
            for stmt in case.body:
                if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
                    func = stmt.value.func
                    if (
                        (isinstance(func, ast.Name) and func.id == "assert_never")
                        or (isinstance(func, ast.Attribute) and func.attr == "assert_never")
                    ):
                        has_assert_never = True
                        break

        if not has_assert_never:
            violations.append(Violation(
                rule="missing-assert-never",
                file=file,
                line=node.lineno,
                col=node.col_offset + 1,
                message="match without `case _: assert_never(x)` default",
            ))
    return violations


def find_generic_exception_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check for raise ValueError/TypeError/RuntimeError with bare string or f-string."""
    GENERIC_EXCEPTIONS = {"ValueError", "TypeError", "RuntimeError", "KeyError"}
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise) or node.exc is None:
            continue
        exc = node.exc
        # Match: raise SomeError("string literal")
        if not isinstance(exc, ast.Call):
            continue
        func = exc.func
        exc_name: str | None = None
        if isinstance(func, ast.Name) and func.id in GENERIC_EXCEPTIONS:
            exc_name = func.id
        elif isinstance(func, ast.Attribute) and func.attr in GENERIC_EXCEPTIONS:
            exc_name = func.attr
        if exc_name is None:
            continue
        # Check if all arguments are string literals or f-strings
        if not exc.args:
            continue
        all_str = all(
            (isinstance(arg, ast.Constant) and isinstance(arg.value, str))
            or isinstance(arg, ast.JoinedStr)
            for arg in exc.args
        )
        if not all_str:
            continue

        raise_line = source_lines[node.lineno - 1] if node.lineno <= len(source_lines) else ""
        if GENERIC_ERR_OK_RE.search(raise_line):
            continue

        violations.append(Violation(
            rule="generic-exception",
            file=file,
            line=node.lineno,
            col=node.col_offset + 1,
            message=f"`raise {exc_name}(\"...\")` - define a typed error class instead",
        ))
    return violations


def _is_isinstance_test(node: ast.expr) -> bool:
    """Check if node is an isinstance() call."""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "isinstance"
    )


def _is_enum_comparison(node: ast.expr) -> bool:
    """Check if node is `x == Enum.VALUE` or `x is Enum.VALUE`."""
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        op = node.ops[0]
        if isinstance(op, (ast.Eq, ast.Is)):
            comparator = node.comparators[0]
            # x == Enum.VALUE  (attribute access on the right)
            if isinstance(comparator, ast.Attribute):
                return True
            # Enum.VALUE == x  (attribute access on the left)
            if isinstance(node.left, ast.Attribute):
                return True
    return False


def find_object_annotation_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check for `object` used as a type annotation."""
    violations: list[Violation] = []

    def _check_annotation(ann: ast.expr | None) -> None:
        if ann is None:
            return
        for child in ast.walk(ann):
            if isinstance(child, ast.Name) and child.id == "object":
                line = source_lines[child.lineno - 1] if child.lineno <= len(source_lines) else ""
                if OBJECT_OK_RE.search(line):
                    return
                violations.append(Violation(
                    rule="no-object",
                    file=file,
                    line=child.lineno,
                    col=child.col_offset + 1,
                    message="`object` as type annotation \u2014 use Protocol, TypeVar, or union",
                ))

    for node in ast.walk(tree):
        match node:  # noqa: MATCH_OK  — filtering walk, not discriminating a closed union
            case ast.FunctionDef() | ast.AsyncFunctionDef():
                all_args = (
                    node.args.args
                    + node.args.posonlyargs
                    + node.args.kwonlyargs
                )
                for arg in all_args:
                    _check_annotation(arg.annotation)
                if node.args.vararg:
                    _check_annotation(node.args.vararg.annotation)
                if node.args.kwarg:
                    _check_annotation(node.args.kwarg.annotation)
                _check_annotation(node.returns)
            case ast.AnnAssign():
                _check_annotation(node.annotation)
    return violations


def find_if_elif_variant_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check for if/elif chains on isinstance or enum comparison."""
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue

        line = source_lines[node.lineno - 1] if node.lineno <= len(source_lines) else ""
        if IF_VARIANT_OK_RE.search(line):
            continue

        is_variant_test = _is_isinstance_test(node.test) or _is_enum_comparison(node.test)
        if not is_variant_test:
            continue

        # Must have at least one elif that is also a variant test
        orelse = node.orelse
        while orelse and len(orelse) == 1 and isinstance(orelse[0], ast.If):
            elif_node = orelse[0]
            if _is_isinstance_test(elif_node.test) or _is_enum_comparison(elif_node.test):
                violations.append(Violation(
                    rule="if-elif-on-variant",
                    file=file,
                    line=node.lineno,
                    col=node.col_offset + 1,
                    message="isinstance/enum if/elif chain \u2014 use match/case + assert_never",
                ))
                break
            orelse = elif_node.orelse
    return violations


def find_broad_except_violations(
    tree: ast.Module, source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check for except Exception / except BaseException (too broad)."""
    BROAD_EXCEPTIONS = {"Exception", "BaseException"}
    violations: list[Violation] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        if node.type is None:
            continue  # already caught by bare-except

        exc_name: str | None = None
        if isinstance(node.type, ast.Name) and node.type.id in BROAD_EXCEPTIONS:
            exc_name = node.type.id
        elif isinstance(node.type, ast.Attribute) and node.type.attr in BROAD_EXCEPTIONS:
            exc_name = node.type.attr
        if exc_name is None:
            continue

        line = source_lines[node.lineno - 1] if node.lineno <= len(source_lines) else ""
        if BROAD_EXCEPT_OK_RE.search(line):
            continue

        violations.append(Violation(
            rule="broad-except",
            file=file,
            line=node.lineno,
            col=node.col_offset + 1,
            message=f"`except {exc_name}` is too broad \u2014 catch the specific exception you expect",
        ))
    return violations


def find_oversized_module_violations(
    source_lines: list[str], file: Path,
) -> list[Violation]:
    """Check if file exceeds 250 pure LOC (non-blank, non-comment)."""
    # File-level opt-out in first 10 lines (shebang + script metadata can push it down)
    for line in source_lines[:10]:
        if SIZE_OK_RE.search(line):
            return []

    pure_loc = sum(
        1 for line in source_lines
        if line.strip() and not line.strip().startswith("#")
    )
    if pure_loc > PURE_LOC_LIMIT:
        return [Violation(
            rule="oversized-module",
            file=file,
            line=1,
            col=1,
            message=f"{pure_loc} pure LOC (limit: {PURE_LOC_LIMIT}) \u2014 split by responsibility",
        )]
    return []


def check_file(file: Path) -> list[Violation]:
    source = file.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(file))
    except SyntaxError as exc:
        return [Violation(
            rule="syntax-error",
            file=file,
            line=exc.lineno or 1,
            col=exc.offset or 1,
            message=f"SyntaxError: {exc.msg}",
        )]

    source_lines = source.splitlines()
    return [
        *find_node_violations(tree, file),
        *find_import_violations(tree, source_lines, file),
        *find_comment_violations(source, file),
        *find_dataclass_violations(tree, source_lines, file),
        *find_dict_return_violations(tree, source_lines, file),
        *find_match_violations(tree, source_lines, file),
        *find_generic_exception_violations(tree, source_lines, file),
        *find_object_annotation_violations(tree, source_lines, file),
        *find_if_elif_variant_violations(tree, source_lines, file),
        *find_oversized_module_violations(source_lines, file),
        *find_broad_except_violations(tree, source_lines, file),
    ]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-no-excuse-rules.py <file-or-dir>...", file=sys.stderr)
        return 2

    files = discover_files(Path(arg) for arg in sys.argv[1:])
    if not files:
        print("check-no-excuse-rules: no .py files found", file=sys.stderr)
        return 0

    violations: list[Violation] = []
    for file in files:
        violations.extend(check_file(file))

    if not violations:
        print(f"no violations in {len(files)} file(s)")
        return 0

    for violation in violations:
        print(violation.render(), file=sys.stderr)
    print(
        f"\n{len(violations)} violation(s) in {len(files)} file(s)",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
