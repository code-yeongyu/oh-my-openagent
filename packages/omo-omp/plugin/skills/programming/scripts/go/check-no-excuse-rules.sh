#!/usr/bin/env bash
# No-excuse rule checker for Go files.
# Mirrors the philosophy of python-programmer / typescript-programmer / rust-programmer scripts:
# only rules that can be enforced via pure text matching live here.
# Everything semantic is on golangci-lint + nilaway + go test -race.

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <file.go> [file.go ...]" >&2
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

is_test_file() {
    case "$1" in
        *_test.go) return 0 ;;
    esac
    return 1
}

is_generated_file() {
    local file="$1"
    case "$file" in
        *.pb.go|*.connect.go|*.gen.go) return 0 ;;
        *_string.go) return 0 ;;
    esac
    # First-line check for "Code generated ... DO NOT EDIT." (the official marker)
    if [ -f "$file" ]; then
        head -n 5 "$file" 2>/dev/null | grep -qE "^// Code generated .* DO NOT EDIT\.$" && return 0
    fi
    return 1
}

for file in "$@"; do
    [ -f "$file" ] || continue
    case "$file" in
        *.go) ;;
        *) continue ;;
    esac

    if is_generated_file "$file"; then
        continue
    fi

    in_test=0
    if is_test_file "$file"; then
        in_test=1
    fi

    line_no=0
    while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        line_no=$((line_no + 1))
        line="$raw_line"

        # Strip line comments before pattern checks
        # (block comments are not handled — keep the rules robust to that limitation).
        code_only="${line%%//*}"

        # ── Exemption marker: // no-excuse-ok: <reason> ──────────────────
        if [[ "$line" =~ //[[:space:]]*no-excuse-ok:[[:space:]]*.+ ]]; then
            continue
        fi

        # ── Rule: no `_ = err` (silent error swallow) ────────────────────
        # The errcheck linter catches most of these but the `_ = err` form
        # specifically slips through if used with named returns.
        if [[ "$code_only" =~ ^[[:space:]]*_[[:space:]]*=[[:space:]]*err[[:space:]]*$ ]] ||
           [[ "$code_only" =~ ^[[:space:]]*_[[:space:]]*=[[:space:]]*err[[:space:]]*[^a-zA-Z0-9_].*$ ]]; then
            if [ "$in_test" -eq 0 ]; then
                report "$file" "$line_no" "silent-err" "discarding err with '_ = err' — handle the error"
            fi
        fi

        # ── Rule: no `panic(` in non-test, non-main code ─────────────────
        # Allowed in main(), allowed in tests, allowed with explicit marker.
        if [[ "$code_only" =~ [^a-zA-Z0-9_]panic\( ]] || [[ "$code_only" =~ ^[[:space:]]*panic\( ]]; then
            if [ "$in_test" -eq 0 ]; then
                # main package main.go is the one exception
                pkg_line=$(head -n 5 "$file" 2>/dev/null | grep -m1 "^package ")
                if [[ "$pkg_line" != "package main" ]]; then
                    report "$file" "$line_no" "panic-in-lib" "panic outside main/test — return error instead"
                fi
            fi
        fi

        # ── Rule: no `log.Fatal` / `log.Panic` in library code ───────────
        if [[ "$code_only" =~ log\.(Fatal|Panic)(f|ln)?\( ]]; then
            if [ "$in_test" -eq 0 ]; then
                pkg_line=$(head -n 5 "$file" 2>/dev/null | grep -m1 "^package ")
                if [[ "$pkg_line" != "package main" ]]; then
                    report "$file" "$line_no" "log-fatal-in-lib" "log.Fatal/Panic outside main — return error"
                fi
            fi
        fi

        # ── Rule: no init() functions ─────────────────────────────────
        # init() ruins testability and creates hidden global state.
        # Exception: //go:build constraint files and generated code.
        if [[ "$code_only" =~ ^func[[:space:]]+init\(\)[[:space:]]*\{ ]]; then
            report "$file" "$line_no" "no-init-func" "init() ruins testability — use explicit constructor"
        fi

        # ── Rule: no `time.Sleep` in non-test code ──────────────────────
        if [[ "$code_only" =~ time\.Sleep\( ]]; then
            if [ "$in_test" -eq 0 ]; then
                report "$file" "$line_no" "time-sleep" "time.Sleep in production code — use ticker/timer with ctx"
            fi
        fi

        # ── Rule: no `context.Background()` inside functions (only in main/init/test) ──
        if [[ "$code_only" =~ context\.Background\(\) ]]; then
            if [ "$in_test" -eq 0 ]; then
                pkg_line=$(head -n 5 "$file" 2>/dev/null | grep -m1 "^package ")
                if [[ "$pkg_line" != "package main" ]]; then
                    report "$file" "$line_no" "ctx-background-in-lib" "context.Background() outside main — propagate ctx as parameter"
                fi
            fi
        fi

        # ── Rule: no `interface{}` (use `any`, the alias from Go 1.18+) ──
        if [[ "$code_only" =~ interface\{\} ]]; then
            report "$file" "$line_no" "old-interface-empty" "use 'any' instead of 'interface{}' (Go 1.18+)"
        fi

        # ── Rule: no bare `fmt.Println` for logging (use slog) ───────────
        # Acceptable in main.go (CLI output) and tests. Reject in libraries.
        if [[ "$code_only" =~ fmt\.(Print|Println|Printf)\( ]]; then
            if [ "$in_test" -eq 0 ]; then
                pkg_line=$(head -n 5 "$file" 2>/dev/null | grep -m1 "^package ")
                if [[ "$pkg_line" != "package main" ]]; then
                    report "$file" "$line_no" "fmt-print-in-lib" "fmt.Print* in library — use slog for structured logs"
                fi
            fi
        fi

        # ── Rule: no `nolint` directive without reason ───────────────────
        if [[ "$line" =~ //nolint(:|$| ) ]]; then
            if ! [[ "$line" =~ //nolint:[a-zA-Z0-9_,-]+[[:space:]]+//[[:space:]]*[^[:space:]] ]]; then
                report "$file" "$line_no" "nolint-no-reason" "//nolint requires a // reason after the linter list"
            fi
        fi

        # ── Rule: no TODO / FIXME without an issue link or owner ─────────
        # Check the full line — TODOs live in comments, which $code_only has stripped.
        if echo "$line" | grep -qE '(TODO|FIXME|XXX)([[:space:]]|:)'; then
            if ! echo "$line" | grep -qE '(TODO|FIXME|XXX).*[(@[]'; then
                report "$file" "$line_no" "todo-no-owner" "TODO/FIXME requires (#issue) or @owner attribution"
            fi
        fi
    done < "$file"
done

if [ "$violations" -gt 0 ]; then
    echo "" >&2
    echo "go-programmer: $violations violation(s). Run also:" >&2
    echo "  gofumpt -l ." >&2
    echo "  golangci-lint run --timeout 5m ./..." >&2
    echo "  nilaway ./..." >&2
    echo "  go test -race -shuffle=on -count=1 ./..." >&2
    exit 1
fi

echo "go-programmer: no-excuse rules passed for $# file(s)."
