#!/usr/bin/env bash
# No-excuse rule checker for Rust files.
# Mirrors the philosophy of python-programmer / typescript-programmer scripts:
# only rules that can be enforced via pure text matching live here.
# Everything semantic is on clippy + miri + nextest.

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <file.rs> [file.rs ...]" >&2
    exit 2
fi

violations=0
report() {
    local file="$1"
    local line="$2"
    local rule="$3"
    local detail="$4"
    echo "::error file=${file},line=${line}::[${rule}] ${detail}" >&2
    violations=$((violations + 1))
}

is_test_path() {
    local path="$1"
    case "$path" in
        */tests/*|*/benches/*|*/examples/*|*/build.rs|*_test.rs|tests/*|benches/*|examples/*) return 0 ;;
    esac
    # In-file #[cfg(test)] modules are handled per-line below.
    return 1
}

for file in "$@"; do
    [ -f "$file" ] || continue
    case "$file" in
        *.rs) ;;
        *) continue ;;
    esac

    if is_test_path "$file"; then
        # Test files are exempt from unwrap/expect/todo rules.
        # Still enforce unsafe-comment, allow-comment, panic-in-lib rules below
        # by setting a marker - keeping the loop unified.
        in_test_file=1
    else
        in_test_file=0
    fi

    # Track #[cfg(test)] regions for per-line exemptions.
    in_cfg_test=0
    cfg_test_brace_depth=0
    line_no=0

    while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        line_no=$((line_no + 1))
        line="$raw_line"

        # Crude #[cfg(test)] region tracker: when we see #[cfg(test)] on a
        # line followed by a mod with `{`, count braces until depth returns
        # to zero. This is approximate but matches typical formatting.
        if [[ "$line" =~ \#\[cfg\(test\)\] ]]; then
            in_cfg_test=1
            cfg_test_brace_depth=0
        fi
        if [ "$in_cfg_test" -eq 1 ]; then
            opens=$(printf '%s' "$line" | tr -cd '{' | wc -c)
            closes=$(printf '%s' "$line" | tr -cd '}' | wc -c)
            cfg_test_brace_depth=$((cfg_test_brace_depth + opens - closes))
            if [ "$cfg_test_brace_depth" -le 0 ] && [[ ! "$line" =~ \#\[cfg\(test\)\] ]]; then
                in_cfg_test=0
            fi
        fi

        exempt=0
        [ "$in_test_file" -eq 1 ] && exempt=1
        [ "$in_cfg_test" -eq 1 ] && exempt=1

        # Strip line comments before pattern checks - so doc comments and
        # explanatory prose do not trip the regexes.
        code_only="${line%%//*}"

        if [ "$exempt" -eq 0 ]; then
            # .unwrap()
            if [[ "$code_only" =~ \.unwrap\(\) ]]; then
                # Allow if previous line had // SAFE-UNWRAP: comment
                prev_line=$(sed -n "$((line_no - 1))p" "$file" 2>/dev/null || true)
                if [[ ! "$prev_line" =~ //[[:space:]]*SAFE-UNWRAP: ]]; then
                    report "$file" "$line_no" "unwrap" ".unwrap() outside tests - use ? / ok_or / pattern match or annotate previous line with // SAFE-UNWRAP: <reason>"
                fi
            fi

            # .expect("...")
            if [[ "$code_only" =~ \.expect\( ]]; then
                prev_line=$(sed -n "$((line_no - 1))p" "$file" 2>/dev/null || true)
                if [[ ! "$prev_line" =~ //[[:space:]]*SAFE-EXPECT: ]]; then
                    report "$file" "$line_no" "expect" ".expect() outside tests - use ? or annotate previous line with // SAFE-EXPECT: <reason>"
                fi
            fi

            # todo!() / unimplemented!() / unreachable!()
            if [[ "$code_only" =~ (todo!|unimplemented!|unreachable!|unreachable_unchecked!) ]]; then
                report "$file" "$line_no" "placeholder-macro" "todo!/unimplemented!/unreachable! in committed code"
            fi

            # Box<dyn Error
            if [[ "$code_only" =~ Box\<dyn[[:space:]]+Error ]]; then
                report "$file" "$line_no" "box-dyn-error" "Box<dyn Error> in non-test code - use anyhow::Error (apps) or thiserror enum (libs)"
            fi

            # panic!( in lib
            if [[ "$file" == */src/lib.rs || "$file" == */src/*/mod.rs || ( "$file" == */src/*.rs && "$file" != */src/main.rs && "$file" != */src/bin/* ) ]]; then
                if [[ "$code_only" =~ panic!\( ]]; then
                    report "$file" "$line_no" "lib-panic" "panic!() in library code - return Result"
                fi
            fi
        fi

        # unsafe { without preceding // SAFETY: in the last 5 lines (always enforced)
        if [[ "$code_only" =~ unsafe[[:space:]]*\{ ]]; then
            start=$((line_no > 5 ? line_no - 5 : 1))
            window=$(sed -n "${start},${line_no}p" "$file" 2>/dev/null || true)
            if [[ ! "$window" =~ //[[:space:]]*SAFETY: ]]; then
                report "$file" "$line_no" "unsafe-no-safety-comment" "unsafe block without // SAFETY: comment in preceding 5 lines"
            fi
        fi

        # #[allow(clippy::...)] without preceding // CLIPPY-ALLOW: justification
        if [[ "$code_only" =~ \#\[allow\(clippy:: ]]; then
            prev_line=$(sed -n "$((line_no - 1))p" "$file" 2>/dev/null || true)
            if [[ ! "$prev_line" =~ //[[:space:]]*CLIPPY-ALLOW: ]]; then
                report "$file" "$line_no" "unjustified-clippy-allow" "#[allow(clippy::...)] without // CLIPPY-ALLOW: <reason> on previous line"
            fi
        fi

        # Narrowing numeric `as` casts - heuristic flag for human review.
        # Catches the common shapes; precise type analysis belongs to clippy::cast_possible_truncation.
        if [[ "$code_only" =~ as[[:space:]]+(u8|u16|u32|i8|i16|i32) ]] && \
           [[ "$code_only" =~ (u16|u32|u64|u128|usize|i16|i32|i64|i128|isize)[[:space:]]+as[[:space:]]+(u8|u16|u32|i8|i16|i32) ]]; then
            report "$file" "$line_no" "narrowing-as-cast" "possible narrowing 'as' cast - use TryFrom / try_into() for fallible conversion"
        fi
    done < "$file"
done

if [ "$violations" -gt 0 ]; then
    echo "" >&2
    echo "rust-programmer: ${violations} violation(s). Fix before declaring work done." >&2
    echo "" >&2
    echo "Then run the full toolchain gate:" >&2
    echo "  cargo +stable fmt --all -- --check" >&2
    echo "  cargo +stable clippy --all-targets --all-features -- -D warnings" >&2
    echo "  cargo nextest run --all-targets --all-features" >&2
    echo "  cargo +nightly miri nextest run --all-features    # if unsafe touched" >&2
    echo "  cargo machete" >&2
    echo "  cargo deny check" >&2
    exit 1
fi

echo "rust-programmer: no-excuse rules passed for $# file(s)."
