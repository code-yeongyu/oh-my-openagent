# Go Debugging

Covers goroutines, `dlv` (Delve), `pprof`, the race detector, and the fact that Go's concurrency model means most bugs are about goroutines doing something quiet and wrong.

---

## Environment detection (Phase 0)

```bash
go version
cat go.mod | head -5

# Delve installed?
which dlv
dlv version

# Build constraints
grep -r '// +build\|//go:build' cmd/ internal/ pkg/ 2>/dev/null | head

# pprof wired up?
grep -r 'net/http/pprof\|runtime/pprof' --include='*.go' | head -3
```

---

## Delve (`dlv`) — the Go debugger

Go's gc compiler emits DWARF, but plain gdb barely understands goroutines. **Use dlv, not gdb.** Plain gdb on a Go binary will miss goroutine state and print garbage for interface values.

### The five `dlv` launch modes

```bash
# Build and launch under debugger (equivalent to `go run` + debug)
dlv debug ./cmd/server -- --port=8080

# Debug a test binary
dlv test ./internal/handler/           # enters the test package under debug

# Debug an existing binary (must be built with -gcflags="all=-N -l" for best results)
dlv exec ./bin/myserver

# Attach to a running process
dlv attach $(pgrep myserver)

# Headless mode (IDE / remote attach) — default port 2345
dlv debug --headless --listen=:2345 --api-version=2 ./cmd/server
```

### Building a debuggable binary

The compiler inlines and optimizes aggressively in normal builds, which makes stepping confusing. For serious debugging:

```bash
go build -gcflags="all=-N -l" -o ./bin/server ./cmd/server
# -N disables optimization
# -l disables inlining
```

Then `dlv exec ./bin/server`.

### Essential dlv commands

```
(dlv) b main.main                      # breakpoint at function
(dlv) b handler.go:42                  # breakpoint at file:line
(dlv) b pkg/foo.Bar                    # breakpoint at type method (Go path syntax)
(dlv) c / continue                     # continue until next break
(dlv) n / next                         # step over
(dlv) s / step                         # step into
(dlv) so / stepout                     # step out
(dlv) bt / stack                       # stack trace of current goroutine
(dlv) goroutines                       # list all goroutines
(dlv) goroutine <id>                   # switch to goroutine N
(dlv) goroutine <id> bt                # stack of a specific goroutine
(dlv) locals                           # all locals in frame
(dlv) args                             # function args
(dlv) p <expr>                         # print value (understands interfaces, maps, slices)
(dlv) vars <regex>                     # package vars matching regex
(dlv) regs                             # registers (rare in Go debugging)
(dlv) on <bpid> print <expr>           # auto-print on breakpoint hit (powerful!)
(dlv) trace <location>                 # like breakpoint but just logs, doesn't stop
```

The `trace` command is underused — it's like a logpoint, no stepping required.

---

## Goroutine-centric debugging

Goroutine leaks and deadlocks are the most common Go bugs. `dlv`'s `goroutines` command is the starting point.

```
(dlv) goroutines -t                    # with truncated stack
(dlv) goroutines -s                    # sorted by stack
(dlv) goroutines -with user            # filter user-spawned goroutines
```

Common patterns:

| You see in `goroutines` | Usually means |
|---|---|
| 100s of goroutines stuck at `chan receive` | Producer died; consumers leak |
| 100s stuck at `semacquire` | Lock contention; a holder probably deadlocked |
| One stuck at `select` with no default | Missing case or closed channel scenario |
| Stuck at `netpoll` | External I/O not responding — not a Go bug, check downstream |
| Growing count over time | Goroutine leak — need to find who's spawning without cleanup |

### Panic signals in Go

```go
// Without recovery, panics crash the program with a stack trace of ALL goroutines
// With recovery, they're silent unless explicitly logged:
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered panic: %v\n%s", r, debug.Stack())   // GOOD
        // log.Printf("recovered")                                  // BAD — silent
    }
}()
```

**Always check for silent recovers** in Phase 8. Grep:
```bash
rg 'recover\(\)' --type go
```

And inspect each site for whether the panic is actually surfaced.

---

## Race detector — ALWAYS run when the bug is intermittent

```bash
go test -race ./...
go run -race ./cmd/server
go build -race ./cmd/server
```

The race detector wraps memory accesses and catches concurrent read/write without synchronization. **Run this before attaching dlv** if intermittency is involved — it often finds the bug directly.

Output shape:
```
WARNING: DATA RACE
Read at 0x00c0001a0080 by goroutine 7:
  main.(*Counter).Value()
      /path/to/counter.go:14 +0x3c
Previous write at 0x00c0001a0080 by goroutine 6:
  main.(*Counter).Inc()
      /path/to/counter.go:10 +0x5f
```

Both stacks. Both goroutines. The race is obvious from the line pair.

---

## pprof — for perf, memory, goroutine leaks

### Wire it up (idempotent; usually already present)

```go
import _ "net/http/pprof"

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
    // ... rest of your server
}
```

### Queries

```bash
# CPU profile (30s)
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Heap snapshot
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine snapshot — find leaks
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Block profile — find blocking ops (needs runtime.SetBlockProfileRate)
go tool pprof http://localhost:6060/debug/pprof/block

# Mutex profile — find lock contention (needs runtime.SetMutexProfileFraction)
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Inside pprof:
```
(pprof) top                 # top functions by self time
(pprof) list main.handler   # annotated source of a function
(pprof) web                 # SVG callgraph in browser (requires graphviz)
(pprof) traces              # sample traces
```

For goroutine leaks, **take two snapshots 30s apart** and diff:
```bash
go tool pprof -base prof1.pb.gz prof2.pb.gz
```

Goroutines that appear in prof2 but not prof1 are new; if they stick around, they're leaking.

---

## `GODEBUG` — runtime-level observability

```bash
GODEBUG=gctrace=1 ./myserver              # print GC stats
GODEBUG=schedtrace=1000 ./myserver        # scheduler trace every 1000ms
GODEBUG=scheddetail=1,schedtrace=1000     # detailed scheduler state
GODEBUG=allocfreetrace=1 ./myserver       # every alloc/free (noisy!)
GODEBUG=memprofilerate=1 ./myserver       # profile every allocation
```

Useful for diagnosing GC pressure, goroutine starvation, or memory pattern issues.

---

## Silent-failure patterns in Go

| Pattern | Why it's silent |
|---|---|
| `if err != nil { return err }` that returns to a caller that ignores | Error bubbles up, then gets discarded at the top |
| `defer func() { recover() }()` — bare recover, no log | Panic swallowed, program continues with state corruption |
| `_, _ = conn.Write(data)` | Intentionally discarded error |
| Buffered channel send that blocks forever | Sender hangs; hard to see if no deadlock detection |
| `time.Sleep` in a test | "Works on my machine"; test passes locally, fails in CI |
| `go func() { ... }()` with no error path | Goroutine dies silently on panic unless recover+log |
| Context canceled but operation continues | Ignored `ctx.Err()` check |
| `json.Unmarshal` of zero-value struct field | Input missing the key; silently zero |
| Closed channel read returning zero value | Consumer doesn't check `ok`; reads forever |

---

## Phase 9 cleanup specifics

```bash
# Kill dlv sessions
pkill -f 'dlv' || true
lsof -iTCP:2345 -sTCP:LISTEN -nP 2>/dev/null      # dlv default

# Kill pprof HTTP endpoint if you started it just for this session
lsof -iTCP:6060 -sTCP:LISTEN -nP 2>/dev/null

# Revert any `fmt.Println("DEBUG: ...")` or `log.Printf("DEBUG: ...")` additions
git diff | grep -E '(fmt\.Println\("DEBUG|log\.Printf\("DEBUG|println!)'
git checkout <file>

# Unset env vars
unset GODEBUG
```
