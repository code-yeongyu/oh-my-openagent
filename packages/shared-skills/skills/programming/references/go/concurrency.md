# Concurrency

Goroutines, context, errgroup, channels, locks, and the discipline that keeps them from leaking. Go makes concurrency *easy to start* and *easy to get wrong*. This document is the boring rule set.

---

## The four non-negotiables

1. **`ctx context.Context` is the first parameter of every public function that does I/O or can be cancelled.**
2. **No goroutine without a shutdown path.** Every `go` keyword must answer "how does this stop?".
3. **`-race` on every test run.** The `Taskfile.yml` and CI both enforce it.
4. **`goleak` in `TestMain`** for every package that spawns goroutines. Catches leaks the race detector cannot.

---

## `context.Context` — the cancellation backbone

```go
// GOOD — ctx as first param, propagated through
func (s *UserService) Create(ctx context.Context, email Email) (User, error) {
    user, err := s.store.Insert(ctx, email)
    if err != nil {
        return User{}, fmt.Errorf("insert: %w", err)
    }
    if err := s.notifier.Welcome(ctx, user); err != nil {
        return User{}, fmt.Errorf("notify: %w", err)
    }
    return user, nil
}

// BAD — creates a fresh ctx, breaks request cancellation
func (s *UserService) Create(email Email) (User, error) {
    ctx := context.Background()  // ← contextcheck linter rejects this
    // ...
}
```

The `contextcheck` linter (enabled in `golangci-strict.md`) refuses any function that has `ctx context.Context` available but uses `context.Background()` instead.

### `context.Value` — use sparingly

```go
// Typed key — never use a bare string
type ctxKey struct{ name string }
var requestIDKey = ctxKey{"request_id"}

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, requestIDKey, id)
}

func RequestID(ctx context.Context) string {
    v, _ := ctx.Value(requestIDKey).(string)
    return v
}
```

**Rules**:
- Keys are unexported struct types, not strings. Prevents collisions across packages.
- `context.Value` is for *request-scoped metadata* (request ID, auth subject, trace span), NEVER for application-scoped dependencies.
- Dependencies (loggers, DB pools, config) go in your service struct, not in `context.Value`.

### `WithTimeout` / `WithCancel` — always pair with `defer cancel()`

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()  // ← MUST be deferred. fatcontext linter catches misses.

if err := slow(ctx); err != nil { ... }
```

Forgetting `defer cancel()` leaks a context goroutine until the parent expires — the `lostcancel` vet check catches it.

---

## `errgroup` — the structured concurrency primitive

`golang.org/x/sync/errgroup` is Go's answer to Python's `asyncio.TaskGroup` or Rust's `JoinSet`. Use it instead of raw `go` for any group of related goroutines.

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)  // concurrency cap — leave unbounded = production outage

    results := make([][]byte, len(urls))
    for i, u := range urls {
        g.Go(func() error {
            body, err := fetch(ctx, u)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            results[i] = body
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Properties:

- `WithContext(parent)` returns a child ctx that gets cancelled on **first non-nil error**. All in-flight goroutines see `ctx.Done()` and bail.
- `SetLimit(n)` blocks `g.Go(...)` when the in-flight count hits `n`. **Always set this.** Unbounded fan-out is how services die.
- `g.Wait()` returns the **first** non-nil error. Others are dropped. If you need all errors, accumulate them manually:
  ```go
  var mu sync.Mutex
  var errs []error
  // inside g.Go:
  //   mu.Lock(); errs = append(errs, err); mu.Unlock()
  // after Wait, errors.Join(errs...)
  ```

---

## Goroutine leaks — `goleak`

```go
package store_test

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

This single line at the top of `*_test.go` runs goleak's check after every test in the package. If a test leaks a goroutine, the run fails — pointing at which goroutine.

**The bug it catches**: starting a goroutine in `setUp` and never joining it. Common in DB connection pools, background workers, ticker loops. The race detector does NOT catch this.

If you have a known long-lived goroutine (a singleton background worker, a metrics exporter), use `goleak.IgnoreTopFunction`:

```go
goleak.VerifyTestMain(m,
    goleak.IgnoreTopFunction("github.com/prometheus/client_golang/prometheus.(*Registry).Push"),
)
```

---

## Channels — the rules that hold

### Direction

```go
// GOOD — direction in signatures
func produce(out chan<- Item)
func consume(in <-chan Item)
func pipeline(in <-chan Item, out chan<- Item)
```

Direction restricts misuse. A consumer cannot close the producer's channel.

### Closing

- **The sender closes.** Always. Never the receiver, never multiple senders.
- **Multiple senders → use a `sync.WaitGroup` + one closer.**
- **Closing a closed channel panics.** Closing a `nil` channel panics. Sending on a closed channel panics. Receiving from a closed channel returns zero value with `ok = false`.

```go
// Canonical fan-in: multiple producers, one closer
func fanIn(ctx context.Context, sources ...<-chan Item) <-chan Item {
    out := make(chan Item)
    var wg sync.WaitGroup
    wg.Add(len(sources))
    for _, src := range sources {
        go func() {
            defer wg.Done()
            for item := range src {
                select {
                case out <- item:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

### Selecting

```go
select {
case msg := <-incoming:
    handle(msg)
case <-ctx.Done():
    return ctx.Err()
case <-time.After(5 * time.Second):
    return ErrTimeout
}
```

- `time.After` allocates a timer each call — fine for occasional selects, **NOT for hot loops**. Use `time.NewTimer` + `timer.Reset` for repeat selects.
- A `default:` case makes `select` non-blocking. Use deliberately, not by accident.

### Buffered vs unbuffered

- **Unbuffered** (`make(chan T)`) = synchronous handoff. Sender blocks until receiver is ready. Use for *coordination*.
- **Buffered** (`make(chan T, n)`) = asynchronous up to `n`. Use for *decoupling producer rate from consumer rate*.

A buffered channel of size 1 acts as a **non-blocking signal**:

```go
ready := make(chan struct{}, 1)
// Producer
select {
case ready <- struct{}{}:  // signal once, non-blocking
default:                    // already signaled, skip
}
// Consumer
<-ready
```

---

## Locks — the pyramid

```
Highest level (preferred)
  channels (message passing — "share memory by communicating")
  errgroup / wait group

  sync.RWMutex (many readers, occasional writer)
  sync.Mutex   (mutual exclusion)

  atomic.Int64 / atomic.Pointer  (single-word lock-free)

Lowest level (rare)
  unsafe.Pointer + barriers  (custom lock-free; needs -race AND review)
```

### `sync.Mutex` — embed, don't expose

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]Entry
}

func (c *Cache) Get(key string) (Entry, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.items[key]
    return e, ok
}

func (c *Cache) Set(key string, e Entry) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[key] = e
}
```

- `sync.Mutex` is **not** copyable. The `copylocks` vet check catches `var c2 = c1` where `c1` has a mutex.
- Always `defer mu.Unlock()` immediately after `Lock()`. Forgetting is the #1 deadlock cause.
- Never call user code (callbacks, listener notifications) while holding the lock. Drop the lock, snapshot the data, release, then call out.

### `sync.OnceValue` / `sync.OnceFunc` (Go 1.21+)

Replacement for `sync.Once` for typed lazy init:

```go
var loadConfig = sync.OnceValue(func() Config {
    var cfg Config
    if err := env.Parse(&cfg); err != nil { panic(err) }
    return cfg
})

func handler() { cfg := loadConfig(); ... }
```

Type-safe, no `sync.Once` + global variable boilerplate.

### Atomics — the typed API only

```go
// Go 1.19+ — use the typed atomic.* family
var counter atomic.Int64
counter.Add(1)
n := counter.Load()

// NEVER — the old function-style is type-unsafe
atomic.AddInt64(&counter, 1)  // ← rejected
```

---

## Time — inject a clock for testability

```go
type Clock interface {
    Now() time.Time
}

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

type Service struct {
    clock Clock
}

// Tests
import "github.com/benbjohnson/clock"
fake := clock.NewMock()
fake.Set(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
svc := &Service{clock: fake}
```

**Never call `time.Now()` in domain or service code.** The `time` package becomes a hidden dependency — tests become flaky, retries become time-of-day-dependent, expirations cannot be tested.

`time.Sleep` in production code is a code smell. Use:
- `time.NewTicker` for periodic work (and a `<-ctx.Done()` exit).
- `time.NewTimer` for one-shot delays.
- `time.After` ONLY in select statements, ONLY in non-hot paths.

---

## Race detector — non-negotiable in CI

```bash
go test -race -shuffle=on -count=1 ./...
```

- `-race` instruments memory accesses; catches data races at runtime. ~10x slow-down — acceptable for tests, not production.
- `-shuffle=on` randomizes test order; catches hidden ordering dependencies.
- `-count=1` defeats the test cache. Without it, "passing" might mean "ran 3 weeks ago".

If a test ONLY fails under `-race`, the bug is real. Don't disable the test; fix the race.

---

## Common antipatterns

| Bad | Why | Good |
|---|---|---|
| `go func() { ... }()` with no `ctx` plumbing | Leaks on shutdown | `errgroup.WithContext` or pass ctx |
| Bare `time.Sleep(d)` in production | Untestable, blocks | `time.NewTimer` + select with `ctx.Done()` |
| Channel of `interface{}` | Loses type | Typed channel; use sealed interface if variants needed |
| `sync.Mutex` in a struct passed by value | Locked copies, undefined behavior | Embed in pointer-receiver type; copylocks catches it |
| Locking around an entire request handler | Serializes the whole API | Lock only the smallest critical section |
| `for { select { ... } }` without `<-ctx.Done()` | Cannot stop | Add ctx case in every long-lived select |
| `sync.WaitGroup.Add(1)` inside the goroutine | Race: Wait can return before Add | Add **before** `go` |

---

## Sources

- Go memory model: https://go.dev/ref/mem
- `errgroup` package: https://pkg.go.dev/golang.org/x/sync/errgroup
- `goleak`: https://github.com/uber-go/goleak
- "Go concurrency patterns" (Pike): https://go.dev/blog/pipelines
- Sync.OnceValue blog: https://go.dev/blog/synctest (1.24+ note: `testing/synctest` for time-controlled tests is now experimental)
