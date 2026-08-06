# One-Liners and Disposable Scripts

Production hygiene with throwaway ergonomics. Go scripts get the same strict lints, the same type discipline, the same 250 LOC ceiling. The difference: they live as single `.go` files invoked via `go run`, not as full modules.

Python has PEP 723 + `uv run`. Rust has `rust-script`. **Go has `go run` directly** — no extra tooling needed.

---

## Pattern 1: Single-file `go run`

A `.go` file with a `main` package, run directly:

```go
//go:build ignore
// fetch.go — fetch a URL and print body length.
//
// Usage:
//   go run fetch.go <url>

package main

import (
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
)

func main() {
    if len(os.Args) < 2 {
        log.Fatal("usage: go run fetch.go <url>")
    }
    resp, err := http.Get(os.Args[1])
    if err != nil { log.Fatal(err) }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil { log.Fatal(err) }

    fmt.Printf("%d bytes\n", len(body))
}
```

Run: `go run fetch.go https://example.com`.

The `//go:build ignore` directive keeps this file out of `go build ./...` — it is a script, not part of the module. Without that line, every `.go` file in the package gets compiled into your binary.

---

## Pattern 2: Throwaway directory under `scripts/`

```
myproject/
├── go.mod
├── internal/...
└── scripts/
    ├── seed/
    │   └── main.go        # `go run ./scripts/seed`
    ├── migrate/
    │   └── main.go
    └── one-time-fix/
        └── main.go
```

Each `scripts/<name>/main.go` is its own `main` package. Invoke as `go run ./scripts/seed/`. Dependencies are shared with the parent module — no separate `go.mod`.

This is the right pattern when:

- You need module deps (sqlc, pgx, your own internal packages).
- You want IDE support, type-checking, test coverage.
- The script lives alongside the project, runs in CI.

---

## Pattern 3: Inline `go run` from shell

```bash
go run -mod=mod <(cat <<'EOF'
package main
import "fmt"
func main() { fmt.Println("hello") }
EOF
)
```

Rare, but useful for one-shot terminal experiments. The `<(...)` is process substitution; `go run -mod=mod` reads from stdin.

---

## Hard rules for scripts

Even a 30-line script follows the philosophy:

1. **Typed flags via `flag` or `pflag`**, not `os.Args` string parsing past 2 args.
   ```go
   var (
       url   = flag.String("url", "", "URL to fetch")
       limit = flag.Int("limit", 100, "max bytes")
   )
   flag.Parse()
   if *url == "" { log.Fatal("--url required") }
   ```

2. **`context.Context` propagation** wherever I/O happens.
   ```go
   ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
   defer cancel()
   req, _ := http.NewRequestWithContext(ctx, "GET", *url, nil)
   ```

3. **`log.Fatal` is fine in `main()`** of a script (programmer error / fatal path), but **never inside any function the script imports.** Library code returns errors.

4. **Errors get wrapped.** Same rule as production code:
   ```go
   if err != nil { return fmt.Errorf("fetch %s: %w", *url, err) }
   ```

5. **Resources released via `defer`.** No "I'll fix it later".

6. **slog for output if it must be parseable.** `fmt.Println` for one-shot terminal output is fine.

7. **No more than 250 pure LOC.** If it grows, it stops being a script and becomes a subcommand of your CLI tool.

---

## Pattern 4: Standalone tool with deps — temporary module

Some scripts need deps the parent module does not have. Two options:

### Option A — script in its own tiny module

```bash
mkdir /tmp/migrate-tool && cd $_
go mod init scratch.local/migrate-tool
go get github.com/pressly/goose/v3
cat > main.go <<'EOF'
package main
import ... // use goose
func main() { ... }
EOF
go run .
```

Run, then delete `/tmp/migrate-tool`. Throwaway.

### Option B — `gorun` (community tool)

```bash
go install github.com/erning/gorun@latest

cat > script.go <<'EOF'
//usr/bin/env gorun "$0" "$@"; exit
// /// go.mod
// module scratch
// go 1.23
// require github.com/spf13/cobra v1.8.0
// ///

package main
...
EOF
chmod +x script.go
./script.go
```

`gorun` parses the inline `go.mod` block, materializes a temp module, runs the script. Niche tool — only if you want the executable-script experience.

---

## When a script becomes a CLI

If your script needs:

- More than one subcommand
- Long-term storage of state
- Help text more than a paragraph
- Repeated invocations from CI

... promote it to a real CLI tool via `cobra` — see `cobra-stack.md`. The boundary is fuzzy; trust your judgment, but **a 500-line "script" is not a script.**

---

## Antipatterns

| Bad | Why | Good |
|---|---|---|
| `os.Args[1]` indexing without length check | Panics on missing arg | `flag.Parse()` with explicit checks |
| `log.Fatal` inside a function the script imports | Crashes caller's process | Return error |
| `panic(err)` for expected failures | Same as above | `log.Fatal` in `main`, error return elsewhere |
| Skipping `defer resp.Body.Close()` because "it's a script" | Leaks fd | Always close |
| One 800-LOC `main.go` "to keep it simple" | Now harder to read than a real CLI | Promote to `cmd/<name>/` with subcommands |
| `// TODO: handle error` | Production-grade hygiene means production-grade hygiene | Handle now or document why ignored |

---

## Sources

- `go run` docs: https://pkg.go.dev/cmd/go#hdr-Compile_and_run_Go_program
- `//go:build` constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- `signal.NotifyContext`: https://pkg.go.dev/os/signal#NotifyContext
- gorun: https://github.com/erning/gorun
