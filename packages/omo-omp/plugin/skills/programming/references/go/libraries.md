# Library Defaults — Full Decision Tree (Go 2026)

The opinionated, in-production stack for 2026 Go. Every entry has a one-line rationale and a canonical snippet so the agent does not relearn each library's idioms.

The biggest difference from Python/Rust/TypeScript: **Go has fewer "best" choices and more "boring" choices.** The standard library is the default; reach outside it only when the rationale below applies.

---

## HTTP framework — `gin` (default) or `chi` (minimalist) or `net/http` (no deps)

The reality of 2026 Go: **`gin` runs ~48% of new Go API projects** (Go Developer Survey 2024 + crawls of new repos), with `gorilla/mux` (~17%, in maintenance), `echo` (~16%), and `fiber` (~11%) the remaining quarter. The skill picks gin not because it is technically superior — it is not — but because:

1. The ecosystem (middleware, examples, SO answers) is largest.
2. The CLIProxyAPI codebase, which this skill's `backend-stack.md` is distilled from, uses gin in production for OpenAI/Gemini/Claude proxying including SSE streaming and WebSocket upgrades. That is real reference code, not a toy.
3. Gin's `Context` API is the closest thing Go has to a framework-blessed "request-scoped object", which makes middleware composition straightforward.

```go
import "github.com/gin-gonic/gin"

func main() {
    r := gin.New()
    r.Use(gin.Recovery(), middleware.RequestLogger(), middleware.RequestID())
    r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
    _ = r.Run(":8080")
}
```

**Pick `chi` instead** when:
- You want `net/http`-compatible handlers (you do, eventually — chi is closer to stdlib).
- The service is small and you do not need gin's binding helpers.

**Pick `net/http` (stdlib) directly** when:
- The service has fewer than 10 routes and zero auth complexity. Go 1.22's enhanced `ServeMux` (method+path patterns) eliminated 80% of the historical reason to use a framework.

**Never use** `gorilla/mux` (effectively in maintenance), `fiber` (uses `fasthttp` which is **not stdlib-compatible**, so middleware ecosystem is split), or `echo` (smaller eco than gin, no real advantage today).

See `backend-stack.md` for the gin canonical layout, middleware ordering, SSE, graceful shutdown, structured logging integration.

---

## RPC — `connectrpc/connect-go`

The default RPC layer. **Use Connect, not raw grpc-go**, unless you have a measured reason.

- Connect is wire-compatible with gRPC AND speaks HTTP/1.1 + HTTP/2 + Connect protocol. One server, three clients (gRPC, gRPC-Web, Connect-Web from browsers).
- No `grpcurl` needed for debugging — `curl -H "Content-Type: application/json" -d ...` works.
- Streaming, interceptors, deadlines, errors are first-class.
- Buf toolchain (`buf generate`, `buf lint`, `buf breaking`) for codegen is dramatically nicer than `protoc`.

```go
// Server
mux := http.NewServeMux()
mux.Handle(elizav1connect.NewElizaServiceHandler(&elizaServer{}))
_ = http.ListenAndServe(":8080", h2c.NewHandler(mux, &http2.Server{}))

// Client
client := elizav1connect.NewElizaServiceClient(
    http.DefaultClient,
    "http://localhost:8080",
)
res, err := client.Say(ctx, connect.NewRequest(&elizav1.SayRequest{Sentence: "hi"}))
```

**Use raw `grpc-go`** only when:
- You need server-streaming-from-multiple-services with a single gRPC mux.
- You are integrating with a strict gRPC-only environment (Envoy proxy with gRPC reflection, Istio strict-gRPC).

See `grpc-connect.md`.

---

## Database — `pgx/v5` + `sqlc` + `goose`

```bash
go get github.com/jackc/pgx/v5
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
```

- **`pgx/v5`** is faster, more type-safe, and has better PostgreSQL feature coverage than `database/sql + lib/pq`. Use the `pgxpool` package for connection pooling. Avoid `database/sql` driver mode — it loses pgx's batch, COPY, listen/notify.
- **`sqlc`** generates type-safe Go from `.sql` files. Hand-written SQL with hand-written struct mapping is the #1 source of subtle DB bugs. sqlc eliminates the class.
- **`goose`** for migrations — small, command-line first, no global state.

**Never use** `gorm` (active record, slow, brings runtime reflection into hot paths, encourages N+1 queries). **Never use** `ent` (heavy, opinionated graph layer) unless you specifically want a graph-shaped data model.

See `sqlc-pgx.md`.

---

## Validation — three layers, three tools

Go has no Pydantic / Zod equivalent and **does not need one** — but only because you wire three layers properly:

| Layer | Tool | Pattern |
|---|---|---|
| HTTP boundary (gin/chi/net/http) | `go-playground/validator/v10` via struct tags | `binding:"required,email,min=3"` |
| RPC boundary (protobuf) | `bufbuild/protovalidate-go` | `(buf.validate.field).string.min_len = 3` in `.proto` |
| Domain core | **Smart constructor + unexported fields** | `NewEmail(s) (Email, error)` returns a type whose fields cannot be set from outside |

```go
// HTTP boundary
type CreateUserReq struct {
    Email    string `json:"email" binding:"required,email"`
    Username string `json:"username" binding:"required,alphanum,min=3,max=32"`
}

// Domain — once a value is of type Email it is provably valid
type Email struct{ raw string }
func NewEmail(s string) (Email, error) {
    if !emailRegex.MatchString(s) { return Email{}, ErrInvalidEmail }
    return Email{raw: strings.ToLower(s)}, nil
}
func (e Email) String() string { return e.raw }
```

The boundary parses raw input into the domain type **once**. Inside the domain, no further validation is permitted — the types prove it. This is parse-don't-validate adapted to Go.

See `data-modeling.md` for the full pattern.

---

## Logging — `log/slog` (stdlib)

```go
import "log/slog"

logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level:     slog.LevelInfo,
    AddSource: true,
}))
slog.SetDefault(logger)

slog.InfoContext(ctx, "request handled",
    slog.String("path", r.URL.Path),
    slog.Int("status", 200),
    slog.Duration("elapsed", elapsed),
)
```

- **stdlib since 1.21**, stable since 1.23. Performance is on par with zerolog for structured output, and faster than logrus by a wide margin.
- The `slog.Handler` interface is implemented by all major exporters (OpenTelemetry, Datadog, Honeycomb).
- The skill bans `logrus`, `zap`, `zerolog` for new code. They are not bad — they are simply superseded. Existing projects on those keep them; new files use slog.

Use the `sloglint` linter from `golangci-strict.md` to enforce attr style (`slog.String(...)` instead of `slog.Any(...)`).

---

## CLI — `cobra` + `pflag` + slog

```bash
go install github.com/spf13/cobra-cli@latest
cobra-cli init mytool
cobra-cli add server
```

`cobra` is the de facto Go CLI framework — Kubernetes, Docker CLI, Helm, GitHub CLI all use it. The companion `viper` for config-file-+-env-+-flag merging is **optional**: prefer `caarlos0/env/v11` for env-only configs (12-factor apps), reach for viper only when you genuinely need file-based config.

See `cobra-stack.md`.

---

## TUI — `bubbletea v2` + `bubbles v2` + `lipgloss v2`

Use **v2 RC** (`charm.land/bubbletea/v2`), not v1. The v2 model adds:

- `tea.View{Cursor: *tea.Cursor, ...}` for real-cursor positioning.
- `SetVirtualCursor(false)` on textareas — lets the terminal own the cursor, which is **required** for CJK IME (Korean Hangul composition, Japanese kana→kanji conversion, Chinese pinyin lookup).
- Granular mouse events (`MouseClickMsg`, `MouseMotionMsg`, `MouseReleaseMsg`) instead of v1's coarse `MouseMsg`.

This is not a preference. v1 has no way to position the IME candidate window correctly — Korean input shows up two cells to the left of where you typed, every time. **If your TUI accepts text input AND your users include CJK speakers, v1 is broken.**

See `bubbletea-v2.md` for the full IME-correct skeleton.

---

## HTTP client — stdlib + `hashicorp/go-retryablehttp`

Default: `net/http.Client` with a tuned `http.Transport`. The stdlib client is **already excellent** in 2026 — HTTP/2 by default, connection pooling, sane timeouts when configured.

```go
client := &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 40,
        IdleConnTimeout:     90 * time.Second,
        DisableCompression:  false,
        ForceAttemptHTTP2:   true,
    },
}
```

For retry/backoff, add `github.com/hashicorp/go-retryablehttp` — small, single-purpose, integrates as a wrapper.

**Never use** `resty` (too much magic, hides headers, encourages wrong defaults). `req` is fine but adds dependency surface for marginal benefit over the stdlib + retry wrapper.

---

## JSON — stdlib (default), `goccy/go-json` (perf), `bytedance/sonic` (extreme perf)

Stdlib `encoding/json` improved dramatically in Go 1.21+. **Use it.**

Reach for `goccy/go-json` (~3x faster) only when you have measured a hot-path bottleneck:

```go
import json "github.com/goccy/go-json"
// drop-in replacement — same API
```

Reach for `bytedance/sonic` (~5x faster, requires amd64/arm64) for production proxies with thousands of RPS of JSON traversal. CLIProxyAPI uses `tidwall/gjson` + `tidwall/sjson` for **partial-tree mutation without full unmarshal** — a different optimization, useful when you transform large payloads. See `backend-stack.md`.

---

## Concurrency primitives — stdlib only

| Need | Use |
|---|---|
| Goroutine group with error propagation | `golang.org/x/sync/errgroup` |
| Semaphore | `golang.org/x/sync/semaphore` |
| Single-flight dedup | `golang.org/x/sync/singleflight` |
| Lazy init | **`sync.OnceValue` / `sync.OnceFunc`** (Go 1.21+, replaces `sync.Once` for typed values) |
| Atomic counter | `atomic.Int64` (Go 1.19+, typed atomics — don't use the old func-style) |
| Channel-based fanout | `chan T` with `errgroup` for shutdown |

The `x/sync` packages are stdlib-quality but live outside `std`. See `concurrency.md` for the discipline.

---

## Time — stdlib + `benbjohnson/clock` for tests

```go
type Clock interface { Now() time.Time }
// Production
var realClock Clock = clockImpl{}
// Test
fake := clock.NewMock()
fake.Set(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
```

**Never call `time.Now()` directly inside domain code.** Inject a `Clock`. Tests become deterministic, no `time.Sleep` flakiness.

---

## IDs — `google/uuid` (UUID v4/v7) or `xid` (sortable short ID)

```go
import "github.com/google/uuid"
id := uuid.Must(uuid.NewV7())  // sortable, time-ordered, 128-bit
```

UUID v7 is the modern default — sortable like v6, random like v4. Use v4 only when leaking creation time is a privacy concern.

For short, URL-safe IDs (~12 bytes, sortable) use `rs/xid` — Kubernetes-style.

---

## Crypto — stdlib + `alecthomas/argon2id` for passwords

Stdlib `crypto/*` for everything. For password hashing, **argon2id is the 2026 standard** — bcrypt is acceptable but argon2 is OWASP's recommendation since 2023.

```go
import "github.com/alecthomas/argon2id"
hash, err := argon2id.CreateHash("password", argon2id.DefaultParams)
```

---

## Data — `apache/arrow-go/v18` + `marcboeker/go-duckdb` + `gonum`

Same philosophy as Python's "never pandas":

| Need | Use |
|---|---|
| Tabular over CSV/Parquet/JSON | DuckDB-Go bindings — zero-copy Arrow integration |
| In-memory frame | Arrow + custom code (Go has no pandas-equivalent and that's fine) |
| Numerical | `gonum.org/v1/gonum` |
| Stats | `gonum/stat` |

Go's data-science story is intentionally thin. For heavy data work, write the pipeline in Polars/DuckDB (see `python/data-processing.md`), expose the result via Parquet or Arrow, consume from Go.

---

## Testing — stdlib + selective additions

| Need | Use |
|---|---|
| Assertions | `stretchr/testify/require` (fail-fast) — `assert` only in table-driven loops |
| Snapshots / golden | `hexops/autogold/v2` (auto-updates with `-update`) |
| Property-based | `pgregory.net/rapid` (modern) or stdlib `testing/quick` |
| Mocks | `go.uber.org/mock` (gomock successor) |
| HTTP mocks | `h2non/gock` for outbound, stdlib `httptest` for inbound |
| Integration containers | `testcontainers/testcontainers-go` |
| Goroutine leak | `go.uber.org/goleak` |
| Benchmarks | stdlib `testing.B` + `perf.dev/benchstat` |

See `testing.md` for canonical patterns.

---

## Config — `caarlos0/env/v11`

```go
type Config struct {
    Port        int           `env:"PORT" envDefault:"8080"`
    DatabaseURL string        `env:"DATABASE_URL,required"`
    Timeout     time.Duration `env:"TIMEOUT" envDefault:"30s"`
}

var cfg Config
if err := env.Parse(&cfg); err != nil { log.Fatal(err) }
```

Pure 12-factor. Defaults via struct tag, required marker, parsing for `time.Duration`, slices, maps. **Use viper only if you also need file-based config** — most services do not.

---

## Choosing an unfamiliar dependency — the checklist

Before `go get`-ing anything new:

1. Is it maintained? Latest tag within 12 months? Owner active?
2. Does it expose stdlib-compatible types (`io.Reader`, `context.Context`, `http.Handler`)? If it invents its own `Connection` or `Request` type, that's a yellow flag.
3. Does it use `init()` for side effects? **REJECT.** `init()` ruins testability.
4. Does it call `log.Fatal` / `panic` outside of true programmer-error paths? **REJECT.**
5. Does it have a `context.Context` first-arg convention? If not, **REJECT** — cancellation is non-negotiable.
6. Does adding it overlap with something already in your `go.mod`? Pick one.

---

## Sources

- 2024 Go Developer Survey: https://go.dev/blog/survey2024-h1-results
- Connect-Go docs: https://connectrpc.com/docs/go/getting-started
- sqlc: https://docs.sqlc.dev
- bubbletea v2 IME: https://github.com/code-yeongyu/bubbletea-wm (reference for `SetVirtualCursor(false)` pattern)
- CLIProxyAPI (gin + SSE + WebSocket in production): https://github.com/router-for-me/CLIProxyAPI
- slog blog: https://go.dev/blog/slog
