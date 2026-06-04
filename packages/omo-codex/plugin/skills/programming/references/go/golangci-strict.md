# Strict `.golangci.yml` (golangci-lint v2)

The single source of truth for "is this Go code acceptable". Drop this in unmodified. **Every linter below is enabled deliberately — read the rationale before disabling one.**

`golangci-lint` v2 changed config schema (top-level `version: "2"`). All v1 configs are incompatible. The block below is v2.

## `.golangci.yml`

```yaml
version: "2"

run:
  timeout: 5m
  tests: true
  modules-download-mode: readonly

linters:
  default: none
  enable:
    # ── Correctness — bug catchers ───────────────────────────────
    - govet              # stdlib vet, includes shadow, fieldalignment, nilness
    - staticcheck        # SA1*-SA9* — the de facto Go correctness linter
    - errcheck           # unhandled errors. ZERO tolerance.
    - errorlint          # %w wrapping, errors.As vs type-assertion, errors.Is vs ==
    - nilerr             # `return nil` after `err != nil` — classic bug
    - nilnil             # returning `(nil, nil)` from a (*T, error) function
    - bodyclose          # http.Response.Body not closed
    - rowserrcheck       # sql.Rows.Err() not checked
    - sqlclosecheck      # sql.Rows / sql.Stmt not closed
    - contextcheck       # functions taking context.Context don't get context.Background()
    - fatcontext         # context.WithValue() in a loop — leaks
    - copyloopvar        # Go 1.22 loop-var capture — should now use the new semantics
    - intrange           # use `for i := range N` (Go 1.22+) instead of `for i := 0; i < N; i++`
    - usetesting         # use t.TempDir/t.Setenv over os.* in tests
    - testifylint        # require vs assert correctness, ObjectsAreEqual misuse

    # ── Style / readability — kept narrow to avoid bikeshedding ─
    - gofumpt            # stricter gofmt
    - goimports          # import grouping + local prefix
    - whitespace         # leading/trailing whitespace
    - misspell           # typos in comments and strings
    - unconvert          # redundant type conversions
    - unparam            # unused function parameters
    - ineffassign        # ineffective assignments
    - dupword            # duplicate words ("the the")

    # ── Architecture — file size, complexity, dead code ─────────
    - gocognit           # cognitive complexity per function (threshold 25)
    - gocyclo            # cyclomatic complexity per function (threshold 15)
    - funlen             # function length (90 lines, 60 statements)
    - lll                # line length 120
    - nestif             # excessive nesting depth (>4)
    - dupl               # duplicate code blocks
    - revive             # extensible replacement for golint; selected rules below
    - unused             # unused vars/funcs/types

    # ── Exhaustiveness — Go's weakest spot ──────────────────────
    - exhaustive         # type switch and enum-like const groups completeness

    # ── Security ────────────────────────────────────────────────
    - gosec              # CWE-aware security scanner

    # ── Logging ─────────────────────────────────────────────────
    - sloglint           # slog attr style + no slog.Any(); enforce structured logs

    # ── Performance ─────────────────────────────────────────────
    - perfsprint         # fmt.Sprintf where strconv suffices
    - prealloc           # slice prealloc when length is known
    - makezero           # make([]T, n) with non-zero n then append (the classic bug)

linters-settings:
  errcheck:
    check-type-assertions: true
    check-blank: true     # `_ = err` is a violation

  govet:
    enable-all: true
    settings:
      shadow:
        strict: true
      fieldalignment:
        # On by default; this catches struct layouts wasting memory.
        # Disable per-file with //nolint:fieldalignment ONLY for boundary types
        # whose JSON tag order matters for OpenAPI doc stability.

  errorlint:
    errorf: true          # %w mandatory for wrapping
    asserts: true         # errors.As over type-assertion on `error`
    comparison: true      # errors.Is over ==

  gocognit:
    min-complexity: 25

  gocyclo:
    min-complexity: 15

  funlen:
    lines: 90
    statements: 60
    ignore-comments: true

  lll:
    line-length: 120
    tab-width: 4

  nestif:
    min-complexity: 4

  exhaustive:
    default-signifies-exhaustive: false
    check:
      - switch
      - map

  gosec:
    excludes:
      - G104        # handled by errcheck/errorlint
      - G304        # file path provided as input — too noisy for CLIs

  sloglint:
    no-mixed-args: true       # all attr or all key-value, never mixed
    kv-only: false
    attr-only: true           # force slog.String(...) form
    no-global: all            # disallow slog.Info; force a logger receiver
    context: scope            # require *Context variants where ctx is in scope
    static-msg: true          # msg must be a string literal (not fmt.Sprintf)
    no-raw-keys: true         # use slog.String("key", ...) not raw "key", "val"
    key-naming-case: snake

  testifylint:
    enable-all: true
    disable:
      - require-error          # We DO use assert.Error in table-driven loops

  revive:
    severity: warning
    rules:
      - name: var-naming
      - name: package-comments
      - name: exported
      - name: error-return
      - name: error-naming
      - name: errorf            # use fmt.Errorf instead of errors.New(fmt.Sprintf)
      - name: if-return
      - name: indent-error-flow
      - name: range-val-in-closure
      - name: redefines-builtin-id
      - name: superfluous-else
      - name: unhandled-error
        arguments:
          - "fmt.Print.*"
          - "fmt.Fprint.*"

  perfsprint:
    integer-format: true
    error-format: true
    bool-format: true
    string-format: true

  goimports:
    local-prefixes:
      - github.com/your-org

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
  exclude-rules:
    # Tests get a longer leash on funlen + lll
    - path: _test\.go
      linters:
        - funlen
        - lll
        - dupl
        - gosec
    # Generated code never lints
    - path: \.pb\.go$
      linters: [all]
    - path: \.connect\.go$
      linters: [all]
    - path: ^.*sqlc/.*\.sql\.go$
      linters: [all]

formatters:
  enable:
    - gofumpt
    - goimports
```

## Per-linter rationale (why each is on)

| Linter | What it catches | Why no compromise |
|---|---|---|
| `errcheck` (incl. `check-blank: true`) | `_ = err`, ignored errors from `Close()`, `Write()`, `json.Marshal()` | Silent error ignore is the #1 Go bug class. Banning `_ = err` forces a decision at every site. |
| `errorlint` | `err == io.EOF` instead of `errors.Is(err, io.EOF)`; missing `%w` in `fmt.Errorf` | Once you wrap in middleware, `==` checks silently break. `errors.Is/As` is the only safe form. |
| `nilerr` / `nilnil` | `return nil` after `err != nil`; `return nil, nil` from `(*T, error)` | Classic AI-generated bugs. Linter catches them mechanically. |
| `bodyclose` | `defer resp.Body.Close()` missed | Single most common Go memory leak. |
| `contextcheck` | `ctx := context.Background()` inside a function that received `ctx` | Breaks cancellation propagation — the entire reason ctx exists. |
| `exhaustive` | `switch x.(type)` missing a sealed-interface variant | **Go's weakest type-system spot.** This linter is the closest thing to compiler-enforced exhaustiveness. |
| `sloglint` | `slog.Info(...)` (global), mixed `Any`/typed attrs | Without this, structured logging silently degrades into string concatenation. |
| `govet/shadow` strict | `err := ... ; if ... { err := ...; ... }` shadowing | Hides the real error from outer scope — extremely common. |
| `govet/fieldalignment` | Struct field order wasting memory | Cheap correctness signal. Disable per-file when JSON tag order matters for OpenAPI. |
| `copyloopvar` + `intrange` | Pre-1.22 loop-var capture and old `for i := 0; i < N; i++` | The language modernized; the lint enforces it. |
| `usetesting` | `os.Setenv` / `os.Mkdir` in tests instead of `t.Setenv` / `t.TempDir` | Avoids test isolation bugs. |
| `gocognit` / `gocyclo` / `funlen` | Functions exceeding cognitive thresholds | Direct architectural signal — same purpose as the 250 LOC ceiling, at function granularity. |
| `gosec` | CWE patterns — SQL injection, weak crypto, path traversal | Production must pass this. |
| `testifylint` | `assert.Equal` where `require.Equal` was meant; `ObjectsAreEqual` misuse | Subtle test-correctness bugs. |
| `perfsprint` | `fmt.Sprintf("%d", n)` instead of `strconv.Itoa(n)` | 5–10x faster in tight loops, lints catch the lazy form. |

## `nolint` policy

`//nolint:linter1,linter2 // <reason>` is permitted with **two hard rules**:

1. **One linter at a time per directive.** No `//nolint:all`. No omitting the linter name.
2. **A reason after `//` is mandatory.** "Generated code", "false positive — protobuf imports", "OpenAPI field order" are acceptable. "Ignore" is not.

The skill auto-rejects `//nolint` without a reason. So does `revive` if you enable its `nolint` rule.

## CI gate

```bash
gofumpt -l . | (! grep .)                          # format
golangci-lint run --timeout 5m ./...                # everything above
go vet -vettool=$(which fieldalignment) ./...       # extra check (also in govet)
nilaway ./...                                       # nil-deref static analysis
go test -race -shuffle=on -count=1 ./...            # races + ordering
```

Any non-zero exit = the change does not ship.

## Sources

- golangci-lint v2 docs: https://golangci-lint.run/docs/configuration/
- staticcheck rules: https://staticcheck.dev/docs/checks
- sloglint: https://github.com/go-simpler/sloglint
- exhaustive: https://github.com/nishanths/exhaustive
- nilaway: https://github.com/uber-go/nilaway
