# Error Handling

Typed errors, wrap chains, `errors.Is` / `errors.As`, no panic in libraries, resource cleanup. Go errors look simple and are full of footguns. This document is the canonical set of moves.

---

## The five rules

1. **Every error is wrapped on the way up, with `%w`, with context.** Never `return err` from a non-trivial site.
2. **Compare with `errors.Is`, not `==`.** Wrap chains break `==`. The `errorlint` linter forbids `==` on errors.
3. **Cast with `errors.As`, not type assertion.** Same reason.
4. **`panic` is reserved for programmer errors.** Library code never panics on user input or environment failures. Use `(T, error)`.
5. **Resources released via `defer` immediately after acquisition.** No "I'll add it later".

---

## Sentinel errors — for invariant programmatic checks

```go
package domain

import "errors"

var (
    ErrInvalidEmail   = errors.New("domain: invalid email")
    ErrInvalidPhone   = errors.New("domain: invalid phone")
    ErrInvalidAge     = errors.New("domain: invalid age")
)

func NewEmail(s string) (Email, error) {
    if !emailRe.MatchString(s) {
        return Email{}, fmt.Errorf("email %q: %w", s, ErrInvalidEmail)
    }
    return Email{raw: strings.ToLower(s)}, nil
}
```

Caller branches on identity:

```go
email, err := domain.NewEmail(input)
if errors.Is(err, domain.ErrInvalidEmail) {
    return c.JSON(400, gin.H{"error": "email format"})
}
```

`errors.Is` walks the wrap chain. `err == domain.ErrInvalidEmail` would have failed because `fmt.Errorf` wrapped it.

---

## Typed errors — when you need structured data

When callers need fields off the error (the offending value, the failing field name, the upstream HTTP status):

```go
type ValidationError struct {
    Field   string
    Value   string
    Rule    string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s=%q failed %s", e.Field, e.Value, e.Rule)
}

// Optional: identity sentinel for errors.Is comparisons
var ErrValidation = errors.New("validation")

func (e *ValidationError) Is(target error) bool {
    return target == ErrValidation
}
```

Caller:

```go
err := svc.Save(ctx, user)

var vErr *ValidationError
if errors.As(err, &vErr) {
    // vErr.Field, vErr.Rule are available
    c.JSON(400, gin.H{"field": vErr.Field, "rule": vErr.Rule})
    return
}
```

**`errors.As` requires a non-nil pointer-to-pointer.** Almost always the type is `*ConcreteError`. Forgetting the leading `*` is the most common bug here.

---

## Wrapping — `%w` is mandatory

```go
// BAD — drops context
return err

// BAD — drops the error chain (errors.Is/As stops working)
return fmt.Errorf("failed to save user: %v", err)

// GOOD — preserves chain via %w
return fmt.Errorf("save user %s: %w", userID, err)
```

The `errorlint` linter catches `%v` where `%w` was meant. **Wrap once per layer**, with the minimum useful context:

```
api/handler:  "create user request: %w"
   service:   "validate inputs: %w"
      domain: "email %q: %w"
```

Each frame adds one fact, not a duplicate. The top-level error message reads as a path: `create user request: validate inputs: email "foo": domain: invalid email`.

### `errors.Join` — multiple errors at once

```go
// Validate all fields, collect all errors
var errs []error
if _, err := NewEmail(req.Email); err != nil {
    errs = append(errs, fmt.Errorf("email: %w", err))
}
if _, err := NewUsername(req.Username); err != nil {
    errs = append(errs, fmt.Errorf("username: %w", err))
}
if len(errs) > 0 {
    return errors.Join(errs...)
}
```

`errors.Is` still walks each joined error. Use when reporting batch validation, not for "wrap two unrelated errors".

---

## Panics — when allowed, when banned

**Banned**:

- Anywhere a `(T, error)` could be returned.
- Inside HTTP handlers (gin's `Recovery` middleware catches them, but you've already lost the error context).
- Inside any goroutine that survives request lifetime.

**Allowed** (with documentation):

- Map literal init at package level: `var statusNames = map[Status]string{...}` followed by a `func init()` that panics if a const has no name. Catches the bug at startup, not runtime.
- The `must*` convention for genuinely unrecoverable startup:
  ```go
  func MustParseURL(s string) *url.URL {
      u, err := url.Parse(s)
      if err != nil { panic(err) }
      return u
  }
  // Use only with literals known at compile time:
  var defaultAPI = MustParseURL("https://api.example.com")
  ```
- `default:` case of an exhaustive sealed-interface switch — see `type-patterns.md`.

The `revive` linter rule `error-return` will flag suspect panic sites; treat them as bugs.

---

## `defer` for resources — the only safe pattern

```go
func writeReport(path string) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return fmt.Errorf("create %s: %w", path, err)
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close %s: %w", path, cerr)
        }
    }()

    if _, err := f.Write(data); err != nil {
        return fmt.Errorf("write %s: %w", path, err)
    }
    return nil
}
```

Key points:

- `defer f.Close()` immediately after `os.Create` — never further down.
- Named return `(err error)` so the deferred close can mutate it on close failure.
- `bodyclose` linter catches missed `defer resp.Body.Close()` for HTTP responses.
- `sqlclosecheck` linter catches missed `defer rows.Close()` for SQL.

### `errors.Join` for multi-stage cleanup

```go
func process(path string) (err error) {
    f, err := os.Open(path)
    if err != nil { return err }
    defer func() {
        err = errors.Join(err, f.Close())
    }()
    // ... use f ...
    return nil
}
```

When both the main operation AND `Close` can fail, `errors.Join` reports both without dropping either.

---

## HTTP error responses — a single funnel

Build one helper, route all handler errors through it:

```go
package httperr

type APIError struct {
    Status  int    `json:"-"`
    Code    string `json:"code"`
    Message string `json:"message"`
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

var (
    NotFound       = &APIError{Status: 404, Code: "not_found", Message: "resource not found"}
    Unauthorized   = &APIError{Status: 401, Code: "unauthorized", Message: "unauthorized"}
    BadRequest     = &APIError{Status: 400, Code: "bad_request", Message: "bad request"}
    Internal       = &APIError{Status: 500, Code: "internal", Message: "internal error"}
)

// Wrap a domain error into an API error.
func From(err error) *APIError {
    if err == nil { return nil }

    var apiErr *APIError
    if errors.As(err, &apiErr) { return apiErr }

    switch {
    case errors.Is(err, domain.ErrInvalidEmail),
         errors.Is(err, domain.ErrInvalidUsername):
        return &APIError{Status: 400, Code: "validation", Message: err.Error()}
    case errors.Is(err, ErrNotFound):
        return NotFound
    case errors.Is(err, ErrUnauthorized):
        return Unauthorized
    default:
        // unknown — log full chain, return generic
        slog.Error("unmapped error", slog.Any("err", err))
        return Internal
    }
}

func Write(c *gin.Context, err error) {
    apiErr := From(err)
    c.JSON(apiErr.Status, apiErr)
}
```

Handlers become trivial:

```go
func (h *Handler) Create(c *gin.Context) {
    user, err := h.svc.Create(c.Request.Context(), req)
    if err != nil {
        httperr.Write(c, err)
        return
    }
    c.JSON(201, user)
}
```

---

## errgroup — error propagation across goroutines

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)  // concurrency cap

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

- `errgroup.WithContext` cancels remaining tasks on first error.
- `SetLimit` bounds concurrency.
- First non-nil error is returned; others are discarded — by design.

See `concurrency.md` for the full pattern.

---

## Logging errors — structured, once

```go
slog.ErrorContext(ctx, "save user failed",
    slog.String("user_id", string(id)),
    slog.Any("err", err),   // %w chain is fully rendered
)
```

**Log once, at the outermost frame.** Logging at every wrap site produces five log lines for one error.

The `sloglint` linter enforces `slog.Any("err", err)` over `slog.String("err", err.Error())` — the former preserves the chain when handlers walk the value.

---

## Antipatterns

| Bad | Why | Good |
|---|---|---|
| `_ = err` | Silent ignore | Handle, log, or wrap |
| `if err != nil { return err }` chained 10 deep without wrap | No path info | Add one fact per layer: `fmt.Errorf("step: %w", err)` |
| `panic(err)` in HTTP handlers | Loses error chain, hits gin Recovery | `httperr.Write(c, err)` |
| `err.Error() == "some string"` | Brittle, breaks on wrap | Define a sentinel, use `errors.Is` |
| `if err == sql.ErrNoRows` | Breaks under wrap | `errors.Is(err, sql.ErrNoRows)` |
| `catch-all log.Fatal(err)` in library code | Crashes the caller's process | Return error, let main decide |
| Returning a typed nil pointer wrapped in error interface | Classic "nil != nil" bug | Return explicit `nil` for the error |

The last bug deserves its own example:

```go
// BUG — returns a non-nil error interface containing a nil concrete type
func bad() error {
    var e *MyError = nil
    return e  // interface wraps nil pointer; errors == nil is FALSE
}

// Caller
if err := bad(); err != nil {
    // ← entered, but err.(*MyError) is nil — surprise panic
}
```

Fix: return explicit `nil`, not a typed nil. The `nilnil` linter catches this in `(T, error)` returns.

---

## Sources

- Go blog "Working with Errors in Go 1.13+": https://go.dev/blog/go1.13-errors
- `errors.Join` (Go 1.20+): https://pkg.go.dev/errors#Join
- errorlint: https://github.com/polyfloyd/go-errorlint
- nilaway nil-interface check: https://github.com/uber-go/nilaway
