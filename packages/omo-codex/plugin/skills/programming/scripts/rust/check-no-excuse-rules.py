#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# How to run:
#   uv run --script check-no-excuse-rules.py src/lib.rs src/main.rs
#   uv run --script check-no-excuse-rules.py src/           # recursively finds .rs files
#   uv run --script check-no-excuse-rules.py .              # entire tree
#
# No-excuse rule checker for Rust files — Python rewrite of check-no-excuse-rules.sh.
# Only rules enforceable via pure text matching live here.
# Everything semantic is on clippy + miri + nextest.
#
# Rules:
#   unwrap            .unwrap() outside tests without // SAFE-UNWRAP:
#   expect            .expect() outside tests without // SAFE-EXPECT:
#   placeholder-macro todo!/unimplemented!/unreachable!/unreachable_unchecked! in committed code
#   box-dyn-error     Box<dyn Error> in non-test code
#   lib-panic         panic!() in library code
#   unsafe-no-safety  unsafe { without // SAFETY: in preceding 5 lines
#   unjustified-clippy-allow  #[allow(clippy::...)] without // CLIPPY-ALLOW:
#   narrowing-as-cast possible narrowing 'as' cast
#
# Opt-out: place the appropriate comment on the previous line:
#   // SAFE-UNWRAP: <reason>
#   // SAFE-EXPECT: <reason>
#   // SAFETY: <reason>          (for unsafe blocks, within 5 lines above)
#   // CLIPPY-ALLOW: <reason>
#
# Test paths (exempt from unwrap/expect/placeholder/box-dyn-error/lib-panic):
#   tests/, benches/, examples/, build.rs, *_test.rs, #[cfg(test)] regions

from __future__ import annotations

import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Patterns (compiled once)
# ---------------------------------------------------------------------------

RE_UNWRAP = re.compile(r"\.unwrap\(\)")
RE_EXPECT = re.compile(r"\.expect\(")
RE_PLACEHOLDER = re.compile(r"\b(todo!|unimplemented!|unreachable!|unreachable_unchecked!)")
RE_BOX_DYN_ERROR = re.compile(r"Box<dyn\s+Error")
RE_PANIC = re.compile(r"\bpanic!\(")
RE_UNSAFE_BLOCK = re.compile(r"\bunsafe\s*\{")
RE_CLIPPY_ALLOW = re.compile(r"#\[allow\(clippy::")
RE_CFG_TEST = re.compile(r"#\[cfg\(test\)\]")
RE_SAFE_UNWRAP = re.compile(r"//\s*SAFE-UNWRAP:")
RE_SAFE_EXPECT = re.compile(r"//\s*SAFE-EXPECT:")
RE_SAFETY = re.compile(r"//\s*SAFETY:")
RE_CLIPPY_ALLOW_JUST = re.compile(r"//\s*CLIPPY-ALLOW:")

# Narrowing cast: (wider) as (narrower)
# Wider types that lose bits when cast to narrower targets.
# No leading \b — must match e.g. `999u64 as u32` where a digit precedes the type.
_WIDER = r"(?:u16|u32|u64|u128|usize|i16|i32|i64|i128|isize)"
_NARROWER = r"(?:u8|u16|u32|i8|i16|i32)"
RE_NARROWING_CAST = re.compile(
    rf"{_WIDER}\s+as\s+{_NARROWER}"
)

# Test-path fragments.
_TEST_PATH_PARTS = {"tests", "benches", "examples"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

violations = 0


def report(file: str, line: int, rule: str, detail: str) -> None:
    """Emit a GitHub-Actions-compatible error annotation to stderr."""
    global violations
    print(f"::error file={file},line={line}::[{rule}] {detail}", file=sys.stderr)
    violations += 1


def is_test_path(path: Path) -> bool:
    """Return True if *path* is in a test/bench/example directory or is a test file."""
    parts = path.parts
    for part in parts:
        if part in _TEST_PATH_PARTS:
            return True
    if path.name == "build.rs":
        return True
    if path.name.endswith("_test.rs"):
        return True
    return False


def is_lib_path(file: Path) -> bool:
    """Heuristic: is this file library code (not main.rs, not src/bin/*)."""
    parts = path_parts_str(file)
    # Must live under src/
    if "src" not in parts:
        return False
    if file.name == "main.rs":
        return False
    # src/bin/* is binary code
    try:
        src_idx = parts.index("src")
        if src_idx + 1 < len(parts) and parts[src_idx + 1] == "bin":
            return False
    except ValueError:
        return False
    return True


def path_parts_str(p: Path) -> list[str]:
    return list(p.parts)


def strip_line_comment(line: str) -> str:
    """Return the portion of *line* before any ``//`` line comment.

    This is a crude heuristic — it does not handle ``//`` inside string
    literals, but matches the behaviour of the bash version.
    """
    idx = line.find("//")
    if idx == -1:
        return line
    return line[:idx]


def collect_rs_files(args: list[str]) -> list[Path]:
    """Expand CLI arguments: files are kept as-is, directories are walked."""
    result: list[Path] = []
    for arg in args:
        p = Path(arg)
        if p.is_file():
            if p.suffix == ".rs":
                result.append(p)
        elif p.is_dir():
            result.extend(sorted(p.rglob("*.rs")))
        # Ignore non-existent / non-.rs
    return result


# ---------------------------------------------------------------------------
# Main checker
# ---------------------------------------------------------------------------

def check_file(file: Path) -> None:
    in_test_file = is_test_path(file)
    in_cfg_test = False
    cfg_test_brace_depth = 0

    try:
        lines = file.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        print(f"warning: cannot read {file}: {exc}", file=sys.stderr)
        return

    for line_no_0, raw_line in enumerate(lines):
        line_no = line_no_0 + 1  # 1-indexed

        # --- #[cfg(test)] region tracker ---
        if RE_CFG_TEST.search(raw_line):
            in_cfg_test = True
            cfg_test_brace_depth = 0

        if in_cfg_test:
            opens = raw_line.count("{")
            closes = raw_line.count("}")
            cfg_test_brace_depth += opens - closes
            if cfg_test_brace_depth <= 0 and not RE_CFG_TEST.search(raw_line):
                in_cfg_test = False

        exempt = in_test_file or in_cfg_test
        code_only = strip_line_comment(raw_line)

        if not exempt:
            # .unwrap()
            if RE_UNWRAP.search(code_only):
                prev = lines[line_no_0 - 1] if line_no_0 > 0 else ""
                if not RE_SAFE_UNWRAP.search(prev):
                    report(
                        str(file), line_no, "unwrap",
                        ".unwrap() outside tests - use ? / ok_or / pattern match "
                        "or annotate previous line with // SAFE-UNWRAP: <reason>",
                    )

            # .expect(...)
            if RE_EXPECT.search(code_only):
                prev = lines[line_no_0 - 1] if line_no_0 > 0 else ""
                if not RE_SAFE_EXPECT.search(prev):
                    report(
                        str(file), line_no, "expect",
                        ".expect() outside tests - use ? or annotate previous "
                        "line with // SAFE-EXPECT: <reason>",
                    )

            # todo!/unimplemented!/unreachable!/unreachable_unchecked!
            if RE_PLACEHOLDER.search(code_only):
                report(
                    str(file), line_no, "placeholder-macro",
                    "todo!/unimplemented!/unreachable! in committed code",
                )

            # Box<dyn Error>
            if RE_BOX_DYN_ERROR.search(code_only):
                report(
                    str(file), line_no, "box-dyn-error",
                    "Box<dyn Error> in non-test code - use anyhow::Error (apps) "
                    "or thiserror enum (libs)",
                )

            # panic!() in library code
            if is_lib_path(file) and RE_PANIC.search(code_only):
                report(
                    str(file), line_no, "lib-panic",
                    "panic!() in library code - return Result",
                )

        # unsafe { without // SAFETY: — always enforced, even in tests
        if RE_UNSAFE_BLOCK.search(code_only):
            start = max(0, line_no_0 - 5)
            window = "\n".join(lines[start : line_no_0 + 1])
            if not RE_SAFETY.search(window):
                report(
                    str(file), line_no, "unsafe-no-safety-comment",
                    "unsafe block without // SAFETY: comment in preceding 5 lines",
                )

        # #[allow(clippy::...)] without // CLIPPY-ALLOW: — always enforced
        if RE_CLIPPY_ALLOW.search(code_only):
            prev = lines[line_no_0 - 1] if line_no_0 > 0 else ""
            if not RE_CLIPPY_ALLOW_JUST.search(prev):
                report(
                    str(file), line_no, "unjustified-clippy-allow",
                    "#[allow(clippy::...)] without // CLIPPY-ALLOW: <reason> on "
                    "previous line",
                )

        # Narrowing numeric `as` casts
        if RE_NARROWING_CAST.search(code_only):
            report(
                str(file), line_no, "narrowing-as-cast",
                "possible narrowing 'as' cast - use TryFrom / try_into() for "
                "fallible conversion",
            )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    global violations

    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <file.rs|dir> [file.rs|dir ...]", file=sys.stderr)
        sys.exit(2)

    files = collect_rs_files(sys.argv[1:])
    if not files:
        print("warning: no .rs files found in the given arguments", file=sys.stderr)
        sys.exit(0)

    for f in files:
        check_file(f)

    if violations > 0:
        print("", file=sys.stderr)
        print(
            f"rust-programmer: {violations} violation(s). Fix before declaring work done.",
            file=sys.stderr,
        )
        print("", file=sys.stderr)
        print("Then run the full toolchain gate:", file=sys.stderr)
        print("  cargo +stable fmt --all -- --check", file=sys.stderr)
        print(
            "  cargo +stable clippy --all-targets --all-features -- -D warnings",
            file=sys.stderr,
        )
        print("  cargo nextest run --all-targets --all-features", file=sys.stderr)
        print(
            "  cargo +nightly miri nextest run --all-features    # if unsafe touched",
            file=sys.stderr,
        )
        print("  cargo machete", file=sys.stderr)
        print("  cargo deny check", file=sys.stderr)
        sys.exit(1)

    print(f"rust-programmer: no-excuse rules passed for {len(files)} file(s).")


if __name__ == "__main__":
    main()
