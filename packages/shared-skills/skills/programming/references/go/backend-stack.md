# HTTP Backend Stack — gin + slog + validator + pgx

The canonical production HTTP service skeleton. Distilled from the [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) codebase — a real proxy serving OpenAI / Gemini / Claude / Codex APIs in production, with SSE streaming, WebSocket upgrades, request logging, and hot-reload config.

If you are tempted to pick echo or chi instead, see `libraries.md` — gin wins on ecosystem, not technical merit, and the win is large enough to matter.

---

## `go.mod`

```go
module github.com/your-org/myservice

go 1.23

require (
    github.com/gin-gonic/gin v1.10.1
    github.com/go-playground/validator/v10 v10.22.1
    github.com/caarlos0/env/v11 v11.2.2
    github.com/google/uuid v1.6.0
    github.com/jackc/pgx/v5 v5.7.6
    golang.org/x/sync v0.18.0
)
```

---

## Project structure

```
cmd/server/main.go          # ≤ 50 LOC; flags → run.Execute(ctx)
internal/
  cmd/run.go                # ~150 LOC; signal handling, config load, server.Run
  config/config.go          # env-driven Config struct
  api/
    server.go               # gin.Engine setup, route mounting, http.Server
    middleware/
      request_id.go
      request_logging.go
      auth.go
      recovery.go
      cors.go
    handlers/
      users.go              # one file per resource
      streams.go            # SSE / WebSocket endpoints
  domain/                   # smart-constructor types (Email, UserID, ...)
  service/                  # business logic
  store/                    # pgx + sqlc
  obs/
    logger.go               # slog setup
```

---

## `cmd/server/main.go`

```go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"

    "github.com/your-org/myservice/internal/cmd"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    if err := cmd.Execute(ctx); err != nil {
        slog.Error("fatal", slog.Any("err", err))
        os.Exit(1)
    }
}
```

That is the entire `main`. Anything more is a smell.

---

## `internal/config/config.go`

```go
package config

import (
    "time"
    "github.com/caarlos0/env/v11"
)

type Config struct {
    Host            string        `env:"HOST"             envDefault:"0.0.0.0"`
    Port            int           `env:"PORT"             envDefault:"8080"`
    DatabaseURL     string        `env:"DATABASE_URL,required"`
    ReadTimeout     time.Duration `env:"READ_TIMEOUT"     envDefault:"15s"`
    WriteTimeout    time.Duration `env:"WRITE_TIMEOUT"    envDefault:"30s"`
    ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"20s"`
    LogLevel        string        `env:"LOG_LEVEL"        envDefault:"info"`
    LogFormat       string        `env:"LOG_FORMAT"       envDefault:"json"`
    Env             string        `env:"ENV"              envDefault:"development"`
}

func Load() (Config, error) {
    var cfg Config
    if err := env.Parse(&cfg); err != nil {
        return Config{}, err
    }
    return cfg, nil
}
```

---

## `internal/obs/logger.go`

```go
package obs

import (
    "context"
    "log/slog"
    "os"
)

type ctxKey struct{ name string }
var requestIDKey = ctxKey{"request_id"}

func NewLogger(level, format string) *slog.Logger {
    var lvl slog.Level
    _ = lvl.UnmarshalText([]byte(level))

    opts := &slog.HandlerOptions{Level: lvl, AddSource: true}

    var h slog.Handler
    switch format {
    case "text":
        h = slog.NewTextHandler(os.Stdout, opts)
    default:
        h = slog.NewJSONHandler(os.Stdout, opts)
    }
    return slog.New(&ctxHandler{Handler: h})
}

// ctxHandler pulls request_id from ctx into every log line.
type ctxHandler struct{ slog.Handler }

func (h *ctxHandler) Handle(ctx context.Context, r slog.Record) error {
    if id, ok := ctx.Value(requestIDKey).(string); ok && id != "" {
        r.AddAttrs(slog.String("request_id", id))
    }
    return h.Handler.Handle(ctx, r)
}

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, requestIDKey, id)
}
```

---

## `internal/api/server.go`

```go
package api

import (
    "context"
    "fmt"
    "log/slog"
    "net/http"

    "github.com/gin-gonic/gin"
    "github.com/your-org/myservice/internal/api/handlers"
    "github.com/your-org/myservice/internal/api/middleware"
    "github.com/your-org/myservice/internal/config"
)

type Server struct {
    cfg    config.Config
    srv    *http.Server
    logger *slog.Logger
}

func New(cfg config.Config, logger *slog.Logger, h *handlers.Handler) *Server {
    gin.SetMode(gin.ReleaseMode)
    r := gin.New()

    // Middleware order matters — see "Middleware ordering" below.
    r.Use(
        middleware.RequestID(),     // 1. assign request_id first
        middleware.Recovery(logger), // 2. recovery wraps everything
        middleware.RequestLogger(logger),
        middleware.CORS(),
    )

    h.Mount(r)

    return &Server{
        cfg:    cfg,
        logger: logger,
        srv: &http.Server{
            Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
            Handler:      r,
            ReadTimeout:  cfg.ReadTimeout,
            WriteTimeout: cfg.WriteTimeout,
        },
    }
}

func (s *Server) Run(ctx context.Context) error {
    errCh := make(chan error, 1)
    go func() {
        s.logger.InfoContext(ctx, "server starting",
            slog.String("addr", s.srv.Addr))
        if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            errCh <- err
        }
        close(errCh)
    }()

    select {
    case <-ctx.Done():
        s.logger.InfoContext(ctx, "shutdown signal received")
        shutdownCtx, cancel := context.WithTimeout(
            context.Background(), s.cfg.ShutdownTimeout)
        defer cancel()
        return s.srv.Shutdown(shutdownCtx)
    case err := <-errCh:
        return err
    }
}
```

Notes:

- `gin.New()` not `gin.Default()` — `Default()` adds `Logger()` (text format, not slog) and `Recovery()` (no logger injection). We replace both.
- `gin.SetMode(gin.ReleaseMode)` silences debug output. Production assumed.
- `http.Server` with explicit timeouts. The default `nil` timeouts are a DoS waiting to happen.
- Graceful shutdown: SIGINT/SIGTERM cancels the ctx → `Shutdown(shutdownCtx)` gives in-flight requests up to `ShutdownTimeout` to finish.

---

## Middleware ordering — the rule that actually matters

```
RequestID    →   Recovery    →   Logger    →   CORS    →   Auth    →   Handler
   (1)            (2)              (3)            (4)         (5)
```

1. **RequestID** is first so every subsequent middleware sees it.
2. **Recovery** wraps everything after it. Order: a panic in CORS still gets caught.
3. **Logger** sees the request_id and the recovered panic.
4. **CORS** before Auth — OPTIONS preflight must return without auth.
5. **Auth** is the last cross-cutting middleware. Per-route auth (admin-only) is mounted on a sub-router with extra middleware.

```go
// Public routes — no auth
api := r.Group("/api/v1")
{
    api.POST("/auth/login", h.Login)
    api.GET("/healthz", h.Healthz)
}

// Authenticated routes
authed := r.Group("/api/v1", middleware.Auth(authSvc))
{
    authed.GET("/users/:id", h.GetUser)
    authed.POST("/users", h.CreateUser)
}

// Admin-only routes
admin := r.Group("/api/v1/admin",
    middleware.Auth(authSvc),
    middleware.RequireRole("admin"))
{
    admin.GET("/users", h.ListAllUsers)
}
```

---

## Middleware examples

### `middleware/request_id.go`

```go
package middleware

import (
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    "github.com/your-org/myservice/internal/obs"
)

func RequestID() gin.HandlerFunc {
    return func(c *gin.Context) {
        id := c.GetHeader("X-Request-ID")
        if id == "" {
            id = uuid.Must(uuid.NewV7()).String()
        }
        c.Request = c.Request.WithContext(obs.WithRequestID(c.Request.Context(), id))
        c.Header("X-Request-ID", id)
        c.Next()
    }
}
```

### `middleware/recovery.go`

```go
package middleware

import (
    "log/slog"
    "net/http"
    "runtime/debug"

    "github.com/gin-gonic/gin"
)

func Recovery(logger *slog.Logger) gin.HandlerFunc {
    return func(c *gin.Context) {
        defer func() {
            if r := recover(); r != nil {
                logger.ErrorContext(c.Request.Context(), "panic recovered",
                    slog.Any("panic", r),
                    slog.String("stack", string(debug.Stack())),
                )
                if !c.Writer.Written() {
                    c.JSON(http.StatusInternalServerError,
                        gin.H{"error": "internal_error"})
                }
                c.Abort()
            }
        }()
        c.Next()
    }
}
```

### `middleware/request_logging.go`

```go
func RequestLogger(logger *slog.Logger) gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        c.Next()
        logger.InfoContext(c.Request.Context(), "http request",
            slog.String("method",  c.Request.Method),
            slog.String("path",    c.Request.URL.Path),
            slog.Int("status",     c.Writer.Status()),
            slog.Int("bytes",      c.Writer.Size()),
            slog.Duration("elapsed", time.Since(start)),
            slog.String("ip",      c.ClientIP()),
        )
    }
}
```

The `sloglint` linter enforces typed attrs (`slog.String(...)`) over `slog.Any("path", ...)`. Keep the form.

### `middleware/cors.go`

```go
func CORS() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Header("Access-Control-Allow-Origin",  "*")
        c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        c.Header("Access-Control-Allow-Headers", "*")
        if c.Request.Method == http.MethodOptions {
            c.AbortWithStatus(http.StatusNoContent)
            return
        }
        c.Next()
    }
}
```

Note the explicit OPTIONS short-circuit — preflight must NOT go through Auth.

---

## Handlers — the canonical shape

```go
package handlers

import (
    "errors"
    "net/http"

    "github.com/gin-gonic/gin"
    "github.com/go-playground/validator/v10"
    "github.com/your-org/myservice/internal/domain"
    "github.com/your-org/myservice/internal/httperr"
    "github.com/your-org/myservice/internal/service"
)

type Handler struct {
    Users *service.UserService
}

func (h *Handler) Mount(r gin.IRouter) {
    api := r.Group("/api/v1")
    api.POST("/users", h.CreateUser)
    api.GET("/users/:id", h.GetUser)
}

type createUserReq struct {
    Email    string `json:"email"    binding:"required,email"`
    Username string `json:"username" binding:"required,alphanum,min=3,max=32"`
}

func (h *Handler) CreateUser(c *gin.Context) {
    var req createUserReq
    if err := c.ShouldBindJSON(&req); err != nil {
        writeBindingError(c, err)
        return
    }

    email, err := domain.NewEmail(req.Email)
    if err != nil {
        httperr.Write(c, err)
        return
    }
    username, err := domain.NewUsername(req.Username)
    if err != nil {
        httperr.Write(c, err)
        return
    }

    user, err := h.Users.Create(c.Request.Context(), email, username)
    if err != nil {
        httperr.Write(c, err)
        return
    }
    c.JSON(http.StatusCreated, user)
}

func writeBindingError(c *gin.Context, err error) {
    var vErr validator.ValidationErrors
    if errors.As(err, &vErr) {
        out := make(map[string]string, len(vErr))
        for _, fe := range vErr {
            out[fe.Field()] = fe.Tag()
        }
        c.JSON(http.StatusBadRequest, gin.H{"errors": out})
        return
    }
    c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
}
```

See `data-modeling.md` for the validator tag reference; see `error-handling.md` for the `httperr.Write` funnel.

---

## SSE streaming — the production pattern

CLIProxyAPI streams OpenAI-compatible SSE for hundreds of concurrent clients. The pattern:

```go
func (h *Handler) StreamChat(c *gin.Context) {
    ctx, cancel := context.WithCancel(c.Request.Context())
    defer cancel()

    // 1. Set SSE headers BEFORE writing any body
    c.Header("Content-Type",  "text/event-stream")
    c.Header("Cache-Control", "no-cache")
    c.Header("Connection",    "keep-alive")
    c.Header("X-Accel-Buffering", "no") // disable nginx buffering

    // 2. Obtain the flusher — REQUIRED for streaming
    flusher, ok := c.Writer.(http.Flusher)
    if !ok {
        httperr.Write(c, errors.New("streaming unsupported"))
        return
    }

    // 3. Pull chunks from upstream
    chunks, errs := h.svc.StreamCompletions(ctx, req)

    for {
        select {
        case <-ctx.Done():
            return  // client disconnected, ctx cancelled
        case chunk, ok := <-chunks:
            if !ok {
                fmt.Fprint(c.Writer, "data: [DONE]\n\n")
                flusher.Flush()
                return
            }
            fmt.Fprintf(c.Writer, "data: %s\n\n", chunk)
            flusher.Flush()
        case err := <-errs:
            // Error mid-stream — emit as SSE event and bail
            fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", err.Error())
            flusher.Flush()
            return
        }
    }
}
```

Key facts:

- **Headers MUST be set before the first `Write`.** Otherwise gin auto-sets `Content-Type: text/plain`.
- **`c.Writer.(http.Flusher)` is the streaming primitive.** Without `flusher.Flush()`, the response is buffered and arrives as one blob at the end.
- **Always respond to `<-ctx.Done()`.** A disconnected client must stop upstream work — otherwise you generate tokens for nothing.
- **The trailing `\n\n` per event is wire-mandatory** for SSE parsing. Missing it = the client never sees the event.

---

## WebSocket upgrade

```go
import "github.com/gorilla/websocket"  // still the canonical WS lib in 2026

var upgrader = websocket.Upgrader{
    ReadBufferSize:  4096,
    WriteBufferSize: 4096,
    CheckOrigin: func(r *http.Request) bool {
        // tighten in production
        return true
    },
}

func (h *Handler) WebSocketEcho(c *gin.Context) {
    conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
    if err != nil {
        slog.ErrorContext(c.Request.Context(), "ws upgrade failed", slog.Any("err", err))
        return
    }
    defer conn.Close()

    for {
        mt, msg, err := conn.ReadMessage()
        if err != nil { return }
        if err := conn.WriteMessage(mt, msg); err != nil { return }
    }
}
```

For long-lived connections, use `conn.SetReadDeadline` + `SetPongHandler` for keepalive. CLIProxyAPI's `wsrelay` package is a reference implementation.

---

## Database wiring — pgx pool, injected, never global

```go
package store

import (
    "context"
    "fmt"
    "github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
    cfg, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("parse dsn: %w", err)
    }
    cfg.MaxConns = 25
    cfg.MinConns = 5
    cfg.MaxConnLifetime = time.Hour
    cfg.MaxConnIdleTime = 30 * time.Minute

    pool, err := pgxpool.NewWithConfig(ctx, cfg)
    if err != nil {
        return nil, fmt.Errorf("connect: %w", err)
    }
    if err := pool.Ping(ctx); err != nil {
        pool.Close()
        return nil, fmt.Errorf("ping: %w", err)
    }
    return pool, nil
}
```

See `sqlc-pgx.md` for queries.

---

## Healthcheck

```go
func (h *Handler) Healthz(c *gin.Context) {
    if err := h.pool.Ping(c.Request.Context()); err != nil {
        c.JSON(503, gin.H{"db": "down", "error": err.Error()})
        return
    }
    c.JSON(200, gin.H{"ok": true})
}
```

Mount BEFORE auth. Health checks must be unauthenticated.

---

## Testing the server

```go
func TestCreateUser_returns_201_for_valid_input(t *testing.T) {
    // Given
    h := newTestHandler(t)
    r := gin.New()
    h.Mount(r)

    body := `{"email":"a@b.com","username":"alice"}`
    req := httptest.NewRequest("POST", "/api/v1/users", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()

    // When
    r.ServeHTTP(rec, req)

    // Then
    require.Equal(t, http.StatusCreated, rec.Code)
    var got struct{ ID string `json:"id"` }
    require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
    require.NotEmpty(t, got.ID)
}
```

See `testing.md` for full patterns (testcontainers integration, table-driven, goleak).

---

## Sources

- gin docs: https://gin-gonic.com/docs/
- CLIProxyAPI (reference impl): https://github.com/router-for-me/CLIProxyAPI
- pgx pool: https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool
- SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Go's `http.Server` graceful shutdown: https://pkg.go.dev/net/http#Server.Shutdown
