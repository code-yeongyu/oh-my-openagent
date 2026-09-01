# Data Modeling — Three Layers of Validation

Go has no Pydantic. Go has no Zod. **You do not need them**, but only if you wire three layers correctly. This document is the canonical pattern.

## The three layers

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP / RPC / CLI                          │
│  Raw bytes, strings, untrusted input                         │
│                                                              │
│   Layer 1: validator/v10 (struct tags)   ◄── parse-once     │
│           OR protovalidate (proto)                           │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │  raw req → domain.X
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Domain (internal/domain)                  │
│                                                              │
│   Layer 2: Smart constructors + unexported fields            │
│           NewEmail(s) → (Email, error)                       │
│           NewUserID(s) → (UserID, error)                     │
│                                                              │
│           Once inside this layer, NO further validation.     │
│           The types prove correctness.                       │
└──────────────────────────┬──────────────────────────────────┘
                           │  domain.X (proven valid)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage (internal/store)                  │
│                                                              │
│   Layer 3: sqlc-generated row structs ↔ domain types         │
│           Hand-written mappers, NOT struct tags              │
└─────────────────────────────────────────────────────────────┘
```

Each layer parses once, into the next layer's types. **A function in the domain layer should never receive a raw string and validate it.** If it does, the boundary above failed.

---

## Layer 1: HTTP boundary — `go-playground/validator/v10`

```go
package handlers

import (
    "github.com/gin-gonic/gin"
    "github.com/go-playground/validator/v10"
)

// CreateUserRequest is the wire format. Tags drive validation.
type CreateUserRequest struct {
    Email    string `json:"email"    binding:"required,email"`
    Username string `json:"username" binding:"required,alphanum,min=3,max=32"`
    Age      int    `json:"age"      binding:"required,gte=13,lte=130"`
    Country  string `json:"country"  binding:"required,iso3166_1_alpha2"`
}

func (h *Handler) CreateUser(c *gin.Context) {
    var req CreateUserRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        // validator returns ValidationErrors with field-by-field detail
        var vErr validator.ValidationErrors
        if errors.As(err, &vErr) {
            c.JSON(400, gin.H{"errors": fieldErrors(vErr)})
            return
        }
        c.JSON(400, gin.H{"error": "invalid json"})
        return
    }

    // Cross into domain — single point of failure
    email, err := domain.NewEmail(req.Email)
    if err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }
    username, err := domain.NewUsername(req.Username)
    if err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    user, err := h.svc.Create(c.Request.Context(), email, username, req.Age)
    if err != nil {
        h.writeServiceError(c, err)
        return
    }
    c.JSON(201, user)
}

func fieldErrors(vErr validator.ValidationErrors) map[string]string {
    out := make(map[string]string, len(vErr))
    for _, fe := range vErr {
        out[fe.Field()] = fe.Tag() + "(" + fe.Param() + ")"
    }
    return out
}
```

**Tag reference — the tags you actually use**:

| Tag | Meaning |
|---|---|
| `required` | Non-zero value |
| `omitempty` (json) | Skip if zero |
| `min=N` / `max=N` | Length (strings/slices) or value (numbers) |
| `gte=N` / `lte=N` / `gt=N` / `lt=N` | Numeric comparison |
| `email` | RFC 5322-ish email |
| `url` | Valid URL |
| `uuid` / `uuid4` / `uuid7` | UUID format |
| `alphanum` / `alpha` / `numeric` | Character class |
| `iso3166_1_alpha2` | Country code (US, KR, JP) |
| `iso4217` | Currency code (USD, KRW) |
| `oneof=a b c` | Enum of literal values |
| `dive` | Apply rules to each element of slice/map |
| `eqfield=Field` | Cross-field equality (e.g., password confirm) |

### Custom validators — register at startup

```go
func init() {
    if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
        _ = v.RegisterValidation("strongpassword", validateStrongPassword)
    }
}

func validateStrongPassword(fl validator.FieldLevel) bool {
    s := fl.Field().String()
    return len(s) >= 12 && hasUpper(s) && hasDigit(s) && hasSymbol(s)
}
```

Use sparingly. Most domain rules belong in smart constructors, not validators.

---

## Layer 2: Domain — smart constructors

Covered in detail in `type-patterns.md`. Recap:

```go
package domain

type Username struct{ raw string }

func NewUsername(s string) (Username, error) {
    s = strings.TrimSpace(s)
    if len(s) < 3 || len(s) > 32 {
        return Username{}, ErrInvalidUsername
    }
    if !isAlphanum(s) {
        return Username{}, ErrInvalidUsername
    }
    return Username{raw: s}, nil
}

func (u Username) String() string { return u.raw }
```

**Rule**: every domain type that has invariants has:

1. An unexported field holding the raw form.
2. A `New<Type>(raw) (<Type>, error)` constructor as the sole entry point.
3. A `String() string` for printing.
4. `MarshalJSON` / `UnmarshalJSON` if it crosses a JSON boundary outside HTTP handlers (e.g., logging payloads, queue messages).
5. Optionally: `Scan` and `Value` for `database/sql` interop (rare with sqlc).

---

## Layer 3: Storage — sqlc rows ↔ domain types

sqlc generates row structs from `.sql` files. **Do not put validation tags on them.** Map between sqlc rows and domain types explicitly:

```go
// internal/store/user_store.go
package store

import "myservice/internal/domain"

func (s *UserStore) Get(ctx context.Context, id domain.UserID) (domain.User, error) {
    row, err := s.q.GetUser(ctx, string(id))
    if err != nil {
        return domain.User{}, err
    }
    return rowToUser(row)
}

func rowToUser(r sqlc.UserRow) (domain.User, error) {
    email, err := domain.NewEmail(r.Email)
    if err != nil {
        // DB invariant broken — this is a programmer error, not a user error
        return domain.User{}, fmt.Errorf("db invariant: invalid email for user %s: %w", r.ID, err)
    }
    username, err := domain.NewUsername(r.Username)
    if err != nil {
        return domain.User{}, fmt.Errorf("db invariant: invalid username: %w", err)
    }
    return domain.User{
        ID:       domain.UserID(r.ID),
        Email:    email,
        Username: username,
        Created:  r.CreatedAt,
    }, nil
}
```

The mapping is verbose. **That is the point.** Each field is a deliberate choice; refactors flag every site.

---

## Discriminated unions (sum types) at the boundary

When a wire payload has variants (e.g., `{"type": "user.created", ...}` vs `{"type": "user.deleted", ...}`):

```go
// Wire DTO with raw discriminator
type EventDTO struct {
    Type    string          `json:"type"    binding:"required,oneof=created deleted updated"`
    Payload json.RawMessage `json:"payload" binding:"required"`
}

// Parse into the sealed domain type
func ParseEvent(dto EventDTO) (event.Event, error) {
    switch dto.Type {
    case "created":
        var c event.Created
        if err := json.Unmarshal(dto.Payload, &c); err != nil {
            return nil, fmt.Errorf("decode created: %w", err)
        }
        return c, nil
    case "deleted":
        var d event.Deleted
        if err := json.Unmarshal(dto.Payload, &d); err != nil {
            return nil, fmt.Errorf("decode deleted: %w", err)
        }
        return d, nil
    case "updated":
        var u event.Updated
        if err := json.Unmarshal(dto.Payload, &u); err != nil {
            return nil, fmt.Errorf("decode updated: %w", err)
        }
        return u, nil
    default:
        return nil, fmt.Errorf("unknown event type %q", dto.Type)
    }
}
```

The `exhaustive` linter on the switch + the `oneof` validation tag together cover both "unknown type" and "unhandled variant".

---

## Enums — typed string consts, not iota

```go
// GOOD — string-based, JSON-serializes correctly, debuggable
type Status string

const (
    StatusPending Status = "pending"
    StatusActive  Status = "active"
    StatusClosed  Status = "closed"
)

func (s Status) IsValid() bool {
    switch s {
    case StatusPending, StatusActive, StatusClosed:
        return true
    }
    return false
}

func (s *Status) UnmarshalJSON(data []byte) error {
    var raw string
    if err := json.Unmarshal(data, &raw); err != nil { return err }
    parsed := Status(raw)
    if !parsed.IsValid() { return fmt.Errorf("invalid status %q", raw) }
    *s = parsed
    return nil
}
```

**Never use `iota` enums for anything that crosses a wire boundary.** They serialize as integers, which (a) breaks debuggability, (b) makes reordering enum values a silent breaking change.

Use the validator tag `binding:"oneof=pending active closed"` to enforce at the HTTP boundary.

---

## Nullable fields — `*T` vs sentinel

Three choices, in order of preference:

1. **Sentinel zero value**: `Age int` with `0` meaning "unknown". Works when zero is genuinely unreachable as a valid value.
2. **`sql.Null<T>`** for DB columns: `sql.NullString`, `sql.NullInt64`, `sql.NullTime`. sqlc generates these for nullable columns.
3. **`*T`**: only when you need to distinguish "not provided" from "set to zero" in a JSON payload (PATCH semantics).

```go
// PATCH payload — `*string` discriminates absent vs empty
type UpdateUserRequest struct {
    Email    *string `json:"email,omitempty"`
    Username *string `json:"username,omitempty"`
}
```

Avoid `*T` in domain types — it bloats every consumer with nil checks. Keep `*T` at the boundary, unwrap on the way in.

---

## Common AI-generated antipatterns this rejects

| Bad | Why | Good |
|---|---|---|
| `func handle(req map[string]any)` | No types, no validation | Define a struct, parse with `validator` |
| `if email != "" { ... }` inside domain | Validation in the wrong layer | Make `email Email`, no check needed |
| `type Status int` with `iota` for wire field | Silent breaking on reorder | `type Status string` with const literals |
| Struct tags `json:"email,string"` (the `,string` coercion) | Magic coercion hides bad input | Strict parsing, fail-fast |
| `json.Unmarshal` then range-check after | Two-step "validate after parse" | Use `validator` tags or custom `UnmarshalJSON` |
| Reusing handler DTO as the domain type | Couples wire format to business logic | Two distinct types, explicit mapping |

---

## Sources

- go-playground/validator: https://github.com/go-playground/validator
- gin binding internals: https://github.com/gin-gonic/gin/blob/master/binding/json.go
- Parse, don't validate: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- sqlc with custom types: https://docs.sqlc.dev/en/latest/howto/overrides.html
