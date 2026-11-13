#!/usr/bin/env bash
# No-excuse rule checker for Rust files.
# Only rules that can be enforced via pure text matching live here.
# Everything semantic is on clippy + miri + nextest.
#
# Rules:
#   unwrap / expect         outside tests, unless the previous line carries
#                           #[expect(clippy::unwrap_used|expect_used, reason = "...")]
#   placeholder-macro       todo!/unimplemented!/unreachable! in committed code
#   box-dyn-error           Box<dyn Error> in non-test code
#   lib-panic               panic!() in library code
#   discarded-result        `let _ = call(...)`, unless the previous line carries
#                           #[expect(clippy::let_underscore_must_use, reason = "...")]
#   blocking-in-async       std::thread::sleep / std::fs / reqwest::blocking /
#                           .blocking_*() inside an async fn or async block
#   unsafe-no-safety        unsafe { without // SAFETY: in the preceding 5 lines
#   allow-attribute         #[allow(...)] - silence lints with #[expect(lint, reason)]
#   expect-without-reason   #[expect(...)] with no `reason = "..."`
#   narrowing-as-cast       possible narrowing numeric `as` cast

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <file.rs> [file.rs ...]" >&2
    exit 2
fi

violations=0
report() {
    echo "::error file=$1,line=$2::[$3] $4" >&2
    violations=$((violations + 1))
}

is_test_path() {
    case "$1" in
        */tests/*|*/benches/*|*/examples/*|*/build.rs|*_test.rs|tests/*|benches/*|examples/*) return 0 ;;
    esac
    return 1
}

count_char() {
    local only="${1//[^$2]/}"
    echo "${#only}"
}

for file in "$@"; do
    [ -f "$file" ] || continue
    case "$file" in
        *.rs) ;;
        *) continue ;;
    esac

    in_test_file=0
    is_test_path "$file" && in_test_file=1

    lines=()
    while IFS= read -r raw || [ -n "$raw" ]; do lines+=("$raw"); done < "$file"
    total=${#lines[@]}

    # Brace-tracked regions: a region starts at its marker line and ends when the
    # braces opened after the marker are closed again.
    in_cfg_test=0; cfg_depth=0; cfg_opened=0
    in_async=0; async_depth=0; async_opened=0

    for ((i = 0; i < total; i++)); do
        line_no=$((i + 1))
        line="${lines[$i]}"
        prev=""
        [ "$i" -gt 0 ] && prev="${lines[$((i - 1))]}"
        code_only="${line%%//*}"
        opens=$(count_char "$code_only" "{")
        closes=$(count_char "$code_only" "}")

        if [[ "$line" =~ \#\[cfg\(test\)\] ]]; then
            in_cfg_test=1; cfg_depth=0; cfg_opened=0
        fi
        if [ "$in_cfg_test" -eq 1 ]; then
            cfg_depth=$((cfg_depth + opens - closes))
            [ "$opens" -gt 0 ] && cfg_opened=1
            if [ "$cfg_opened" -eq 1 ] && [ "$cfg_depth" -le 0 ]; then in_cfg_test=0; fi
        fi

        if [ "$in_async" -eq 0 ] && [[ "$code_only" =~ (^|[^[:alnum:]_])async([[:space:]]+(move[[:space:]]*)?\{|[[:space:]]+(unsafe[[:space:]]+)?fn[[:space:]]) ]]; then
            in_async=1; async_depth=0; async_opened=0
        fi
        async_line=$in_async
        if [ "$in_async" -eq 1 ]; then
            async_depth=$((async_depth + opens - closes))
            [ "$opens" -gt 0 ] && async_opened=1
            if [ "$async_opened" -eq 1 ] && [ "$async_depth" -le 0 ]; then in_async=0; fi
        fi

        exempt=0
        [ "$in_test_file" -eq 1 ] && exempt=1
        [ "$in_cfg_test" -eq 1 ] && exempt=1

        if [ "$exempt" -eq 0 ]; then
            if [[ "$code_only" =~ \.unwrap\(\) ]] && [[ ! "$prev" =~ \#\[expect\(clippy::unwrap_used,.*reason ]]; then
                report "$file" "$line_no" "unwrap" ".unwrap() outside tests - use ? / ok_or / let-else, or for a proven invariant use .expect() behind #[expect(clippy::expect_used, reason = \"...\")]"
            fi

            if [[ "$code_only" =~ \.expect\( ]] && [[ ! "$prev" =~ \#\[expect\(clippy::expect_used,.*reason ]]; then
                report "$file" "$line_no" "expect" ".expect() outside tests - use ?, or for a proven invariant annotate the previous line with #[expect(clippy::expect_used, reason = \"...\")]"
            fi

            if [[ "$code_only" =~ (todo!|unimplemented!|unreachable!|unreachable_unchecked!) ]]; then
                report "$file" "$line_no" "placeholder-macro" "todo!/unimplemented!/unreachable! in committed code"
            fi

            if [[ "$code_only" =~ Box\<dyn[[:space:]]+Error ]]; then
                report "$file" "$line_no" "box-dyn-error" "Box<dyn Error> in non-test code - use anyhow::Error (apps) or thiserror enum (libs)"
            fi

            if [[ "$file" == */src/lib.rs || "$file" == */src/*/mod.rs || ( "$file" == */src/*.rs && "$file" != */src/main.rs && "$file" != */src/bin/* ) ]]; then
                if [[ "$code_only" =~ panic!\( ]]; then
                    report "$file" "$line_no" "lib-panic" "panic!() in library code - return Result"
                fi
            fi

            if [[ "$code_only" =~ let[[:space:]]+_[[:space:]]*=[[:space:]]*[^\;]*\( ]] && [[ ! "$prev" =~ \#\[expect\(clippy::let_underscore_must_use,.*reason ]]; then
                report "$file" "$line_no" "discarded-result" "let _ = call() drops its result - propagate or handle the error; log it on a best-effort path"
            fi

            if [ "$async_line" -eq 1 ] && [[ "$code_only" =~ (thread::sleep\(|std::fs::|reqwest::blocking::|\.blocking_(recv|send|lock|read|write)\() ]]; then
                report "$file" "$line_no" "blocking-in-async" "blocking call inside async code - use tokio::time::sleep / tokio::fs / the async client, or move it into spawn_blocking"
            fi
        fi

        if [[ "$code_only" =~ unsafe[[:space:]]*\{ ]]; then
            start=$((i > 5 ? i - 5 : 0))
            window=$(printf '%s\n' "${lines[@]:$start:$((i - start + 1))}")
            if [[ ! "$window" =~ //[[:space:]]*SAFETY: ]]; then
                report "$file" "$line_no" "unsafe-no-safety-comment" "unsafe block without // SAFETY: comment in preceding 5 lines"
            fi
        fi

        if [[ "$code_only" =~ \#!?\[allow\( ]]; then
            report "$file" "$line_no" "allow-attribute" "#[allow(...)] - use #[expect(lint, reason = \"...\")] so the exception fails once the lint stops firing"
        fi

        if [[ "$code_only" =~ \#!?\[expect\( ]]; then
            attr=$(printf '%s\n' "${lines[@]:$i:4}")
            if [[ ! "$attr" =~ reason[[:space:]]*= ]]; then
                report "$file" "$line_no" "expect-without-reason" "#[expect(...)] needs reason = \"...\" naming why the lint does not apply"
            fi
        fi

        # Heuristic flag for human review; exact analysis belongs to clippy::cast_possible_truncation.
        if [[ "$code_only" =~ (u16|u32|u64|u128|usize|i16|i32|i64|i128|isize)[[:space:]]+as[[:space:]]+(u8|u16|u32|i8|i16|i32)([^[:alnum:]_]|$) ]]; then
            report "$file" "$line_no" "narrowing-as-cast" "possible narrowing 'as' cast - use TryFrom / try_into() for fallible conversion"
        fi
    done
done

if [ "$violations" -gt 0 ]; then
    echo "" >&2
    echo "rust-programmer: ${violations} violation(s). Fix before declaring work done." >&2
    echo "" >&2
    echo "Then run the full toolchain gate:" >&2
    echo "  cargo fmt --all -- --check" >&2
    echo "  cargo clippy --all-targets --all-features -- -D warnings" >&2
    echo "  cargo nextest run --all-targets --all-features && cargo test --doc" >&2
    echo "  cargo +nightly miri nextest run --all-features    # if unsafe touched" >&2
    echo "  cargo machete" >&2
    echo "  cargo deny check" >&2
    exit 1
fi

echo "rust-programmer: no-excuse rules passed for $# file(s)."
