# Type Patterns

How to use Go's *limited* type system to catch bugs at compile time. Go gives you fewer tools than Python/TS/Rust — this document covers the four patterns that buy back most of the safety.

The four patterns:

1. **Named types** for branding primitives (the Go answer to `NewType` / branded TS).
2. **Smart constructors with unexported fields** for parse-don't-validate.
3. **Sealed interfaces** for sum types, with `type switch` + `exhaustive` linter.
4. **Generics with constraints** for bounded polymorphism (1.18+).

---

## 1. Named types — distinct primitives

Same underlying type, different meaning. The Go type checker prevents *implicit* mixing — but explicit conversion is always possible. Treat this as a contract enforced at boundaries.

```go
package domain

type UserID string
type OrderID string
type EmailRaw string  // raw, unvalidated string from input

func GetUser(id UserID) User { /* ... */ }

uid := UserID("u-123")
oid := OrderID("o-456")

GetUser(uid)              // ✅ OK
GetUser(oid)              // ❌ cannot use oid (type OrderID) as UserID
GetUser("u-123")          // ❌ untyped string literal — Go DOES catch this
GetUser(UserID("u-123"))  // ✅ explicit conversion — accept it
```

**Use when**: IDs, opaque tokens, foreign keys, units that share a base primitive.

**Reality check**: Go does NOT prevent `UserID(orderIDAsString)`. The defense is **smart constructors** for everything beyond an internal identifier. Use named types for cheap brand-only protection; combine with constructors for protection that actually holds.

### Time-of-day units

```go
type Milliseconds int64
type Seconds      int64

func (ms Milliseconds) ToSeconds() Seconds {
    return Seconds(ms / 1000)
}
```

No implicit `Milliseconds + Seconds`. The compiler refuses. Convert explicitly.

---

## 2. Smart constructors with unexported fields — the Go answer to Pydantic/Zod

The single most important pattern in this document. **Go has no Pydantic. It has this.**

```go
package domain

import (
    "errors"
    "regexp"
    "strings"
)

var (
    ErrInvalidEmail = errors.New("invalid email")
    emailRe         = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// Email is a parsed, lowercased, valid email address.
// The zero value is invalid; construct via NewEmail.
type Email struct {
    raw string  // unexported — cannot be set from outside the package
}

func NewEmail(s string) (Email, error) {
    s = strings.TrimSpace(strings.ToLower(s))
    if !emailRe.MatchString(s) {
        return Email{}, ErrInvalidEmail
    }
    return Email{raw: s}, nil
}

// String implements fmt.Stringer for printing.
func (e Email) String() string { return e.raw }

// MarshalJSON keeps the wire format unchanged.
func (e Email) MarshalJSON() ([]byte, error) {
    return []byte(`"` + e.raw + `"`), nil
}

// UnmarshalJSON is the parsing boundary — strict mode.
func (e *Email) UnmarshalJSON(data []byte) error {
    if len(data) < 2 || data[0] != '"' || data[len(data)-1] != '"' {
        return ErrInvalidEmail
    }
    parsed, err := NewEmail(string(data[1 : len(data)-1]))
    if err != nil {
        return err
    }
    *e = parsed
    return nil
}
```

**Why this works**:

- `Email{raw: "anything"}` from outside the `domain` package is a compile error — `raw` is unexported.
- The only way to obtain a non-zero `Email` is `NewEmail(...)`, which validates.
- `UnmarshalJSON` routes wire input through the same constructor — boundary parsing is automatic.
- Once a function signature has `email Email`, the caller has *proven* it is valid. No internal `if email == ""` checks.

**Use for every domain value that has invariants**: emails, URLs, phone numbers, currency amounts, percentages, semver versions, IDs with format constraints, time ranges, anything you currently validate in three places.

### The "zero value problem"

Go's zero value (`Email{}`) is reachable. The mitigation is documentation + a `IsValid()` method when needed:

```go
func (e Email) IsZero() bool { return e.raw == "" }
```

Or accept it: receivers that take `Email` should *never* receive a zero-value `Email` in correct code. Tests verify it.

---

## 3. Sealed interfaces — sum types in Go

Go has no sum types. The closest thing: an interface with an **unexported method** that only types in the same package can satisfy, dispatched via `type switch`, with the `exhaustive` linter ensuring completeness.

```go
package event

// Event is a closed sum: Created | Updated | Deleted.
// The sealed() method is unexported so external packages cannot add variants.
type Event interface {
    sealed()
    OccurredAt() time.Time
}

type Created struct {
    UserID    UserID
    Email     Email
    Timestamp time.Time
}
func (Created) sealed()                    {}
func (e Created) OccurredAt() time.Time    { return e.Timestamp }

type Updated struct {
    UserID    UserID
    Changes   map[string]any
    Timestamp time.Time
}
func (Updated) sealed()                    {}
func (e Updated) OccurredAt() time.Time    { return e.Timestamp }

type Deleted struct {
    UserID    UserID
    Reason    string
    Timestamp time.Time
}
func (Deleted) sealed()                    {}
func (e Deleted) OccurredAt() time.Time    { return e.Timestamp }
```

Consumer code:

```go
func Render(e event.Event) string {
    switch v := e.(type) {
    case event.Created:
        return fmt.Sprintf("created %s with %s", v.UserID, v.Email)
    case event.Updated:
        return fmt.Sprintf("updated %s: %v", v.UserID, v.Changes)
    case event.Deleted:
        return fmt.Sprintf("deleted %s (reason: %s)", v.UserID, v.Reason)
    default:
        panic(fmt.Sprintf("unhandled event variant: %T", v))
    }
}
```

The `panic` in `default` is the Go equivalent of TS's `assertNever` or Python's `assert_never`. It is only reachable if a new variant is added without updating the switch.

### The `exhaustive` linter — your compiler

```yaml
# .golangci.yml
linters:
  enable: [exhaustive]
linters-settings:
  exhaustive:
    check:
      - switch
      - map
    default-signifies-exhaustive: false
```

Now adding `event.Suspended` without updating `Render` is a **lint error**. This is the closest thing Go has to Rust's match exhaustiveness check. **Treat it as compulsory.**

### Sealed interface gotchas

- The method MUST be unexported (`sealed()`, not `Sealed()`). Otherwise other packages can implement it.
- `type switch` with `*Created` vs `Created` matters — pick value receivers and value cases, or pointer receivers and pointer cases. **Mixing them causes silent miss.**
- `interface{}` is not a sealed type. Anything implementing zero methods satisfies it. Sealed interfaces have at least the `sealed()` method.

---

## 4. Generics with constraints — bounded polymorphism

Go 1.18+. Use for genuinely generic algorithms; **do not** use for "I want this to accept anything".

```go
import "cmp"

// Ordered constraint includes all ordered types (int, float, string, …).
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

// Custom constraint
type Stringer interface {
    String() string
}

func Join[T Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, item := range items {
        parts[i] = item.String()
    }
    return strings.Join(parts, sep)
}
```

The `cmp.Ordered` (Go 1.21+), `cmp.Compare`, and `slices`/`maps` packages cover the common cases without you writing constraints.

### When NOT to use generics

- "I want to accept multiple types, so I'll make it generic." Use an **interface** instead. Generics are for parametric polymorphism (same code, different types). Interfaces are for behavioral polymorphism (different code behind a contract).
- "I want to return `any`." Use a sealed interface and a `type switch`. `any` returns are anti-patterns past public APIs.

---

## 5. Type assertions — the controlled escape hatch

```go
// Bad — panics on failure
e := evt.(event.Created)

// Good — comma-ok form, always
if e, ok := evt.(event.Created); ok {
    // use e
}

// Use errors.As for error chains
var pgErr *pgconn.PgError
if errors.As(err, &pgErr) {
    // pgErr is the wrapped pg error
}
```

**The `errcheck` and `errorlint` linters reject bare type assertions on `error` values.** Use `errors.As`. See `error-handling.md`.

---

## 6. Pointers vs values — the only durable rule

You will see endless debates. The rule that holds up:

- **If a type has a mutex, never copy it.** Use `*T` everywhere.
- **If a type is large (> 64 bytes) and read-only, pass by value or pointer is a measured choice.** Default to pointer for "large" things.
- **Receivers must be consistent.** All methods on `T` either take `T` or `*T`. Don't mix. The `staticcheck` linter catches mixed-receiver bugs.
- **`nil` pointer = absence. Zero value = "not set yet".** Choose ONE convention per type. Document it.

---

## 7. `any` / `interface{}` — when it is acceptable

Almost never in domain code. Acceptable cases:

- JSON parsing of genuinely heterogeneous payloads (and even then, prefer `json.RawMessage` + targeted parsing).
- `fmt.Sprintf` arguments (variadic `any` is unavoidable here).
- Generic container internals before the user-facing API.

The skill rejects `any` in handler signatures, service signatures, store signatures. If you find yourself writing `func Handle(payload any) error`, you have a sealed-interface waiting to happen.

---

## Sources

- "Parse, don't validate" — Alexis King: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- exhaustive linter: https://github.com/nishanths/exhaustive
- Generics constraints: https://go.dev/blog/intro-generics
- cmp.Ordered: https://pkg.go.dev/cmp
