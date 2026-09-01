# Testing

TDD shape, table-driven tests, `require` vs `assert`, snapshot tests, property-based tests, integration tests with testcontainers, goroutine-leak detection. The discipline in `programming/SKILL.md` (Given/When/Then, less mock the better, efficient AND accurate) — this document gives the Go-specific recipes.

---

## Tools

| Need | Use |
|---|---|
| Assertions | `stretchr/testify/require` (and `assert` only inside table loops) |
| Mocks | `go.uber.org/mock` (gomock successor) |
| Goroutine leaks | `go.uber.org/goleak` |
| Snapshots / golden | `hexops/autogold/v2` |
| Property-based | `pgregory.net/rapid` |
| HTTP mocks (outbound) | `h2non/gock` |
| HTTP test server (inbound) | stdlib `net/http/httptest` |
| Integration containers | `testcontainers/testcontainers-go` |
| TUI | `charm.land/bubbletea/v2/teatest` |
| Bench tooling | stdlib `testing.B` + `perf.dev/benchstat` |

---

## Test naming — Given / When / Then in the name

```go
// ──── PATTERN ────
// Test_<Subject>_<Outcome>_when_<Condition>
//   OR
// Test_<Subject>_<Action>_<ExpectedOutcome>

func Test_Email_NewEmail_lowercases_input(t *testing.T)
func Test_Email_NewEmail_rejects_input_without_at_sign(t *testing.T)
func Test_UserService_Create_persists_user_when_inputs_valid(t *testing.T)
func Test_UserService_Create_returns_validation_error_when_email_invalid(t *testing.T)
```

A test name should answer "what behavior is this asserting?" without reading the body. Names that need a comment to explain them are misnamed.

---

## Single test — explicit Given/When/Then

```go
func Test_Email_NewEmail_rejects_input_without_at_sign(t *testing.T) {
    // Given
    raw := "not-an-email"

    // When
    _, err := domain.NewEmail(raw)

    // Then
    require.Error(t, err)
    require.ErrorIs(t, err, domain.ErrInvalidEmail)
}
```

`require.*` fails the test immediately on miss. Use `require` for preconditions and primary assertions. Use `assert.*` only inside table-driven loops where you want all cases to report.

---

## Table-driven tests

```go
func Test_Email_NewEmail(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    string
        wantErr error
    }{
        {"lowercases", "ALICE@example.com", "alice@example.com", nil},
        {"trims whitespace", "  bob@example.com  ", "bob@example.com", nil},
        {"rejects missing @", "no-at-sign", "", domain.ErrInvalidEmail},
        {"rejects empty", "", "", domain.ErrInvalidEmail},
        {"rejects too long", strings.Repeat("a", 256) + "@e.com", "", domain.ErrInvalidEmail},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // When
            got, err := domain.NewEmail(tt.input)

            // Then
            if tt.wantErr != nil {
                require.ErrorIs(t, err, tt.wantErr)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want, got.String())
        })
    }
}
```

Rules:

- One **scenario** per row, not one **assertion** per row.
- Subtest names are sentences in lowercase; `t.Run(tt.name, ...)` makes them filterable: `go test -run Test_Email_NewEmail/rejects_missing_@`.
- The loop body itself is Given/When/Then in shape.
- For Go 1.22+, the loop var capture works correctly without the `tt := tt` shadow line — the `copyloopvar` linter enforces the new style.

---

## Less mocks — the priority order

In Go specifically:

1. **Real implementation.** Domain types, pure functions, value objects — instantiate them. They are fast.
2. **In-memory fake** that satisfies the interface. Has its own test suite proving behavioral parity with the real impl.
3. **`httptest.Server`** for HTTP collaborators (real wire, no internet).
4. **`testcontainers`** for stateful collaborators (Postgres, Redis, S3-compatible, Kafka).
5. **gomock** ONLY for: clocks, randomness, third-party SaaS with no sandbox.

### Example: an in-memory fake

```go
// Real interface
type UserRepo interface {
    Save(ctx context.Context, u domain.User) error
    Get(ctx context.Context, id domain.UserID) (domain.User, error)
}

// In-memory fake — production-quality, tested separately
type FakeUserRepo struct {
    mu    sync.RWMutex
    users map[domain.UserID]domain.User
}

func NewFakeUserRepo() *FakeUserRepo {
    return &FakeUserRepo{users: map[domain.UserID]domain.User{}}
}

func (r *FakeUserRepo) Save(ctx context.Context, u domain.User) error {
    r.mu.Lock(); defer r.mu.Unlock()
    r.users[u.ID] = u
    return nil
}

func (r *FakeUserRepo) Get(ctx context.Context, id domain.UserID) (domain.User, error) {
    r.mu.RLock(); defer r.mu.RUnlock()
    u, ok := r.users[id]
    if !ok { return domain.User{}, domain.ErrUserNotFound }
    return u, nil
}
```

The fake has the same observable behavior as the real one. Tests against `FakeUserRepo` survive when the production repo's internals change. Tests against a gomock stub of `UserRepo` break.

**A test passing against a fake AND a test passing against the real impl is the gold standard.** Run the same test suite twice — once with the fake, once with testcontainers. The fakes earn their keep when the suites diverge.

### Example: gomock for the unmockable

```go
//go:generate mockgen -source=clock.go -destination=mocks/clock_mock.go -package=mocks

type Clock interface {
    Now() time.Time
}

// In a test:
ctrl := gomock.NewController(t)
clock := mocks.NewMockClock(ctrl)
clock.EXPECT().Now().Return(fixedTime).AnyTimes()
```

Mock the narrowest seam. Never mock `UserRepo` if a fake suffices.

---

## E2E scenario tests

```go
//go:build e2e

func Test_E2E_user_can_signup_then_login(t *testing.T) {
    // Given — full server in a goroutine
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    pool := newTestDB(t)              // testcontainers Postgres
    server := startServer(t, pool)    // real gin engine on a random port
    defer server.Close()

    client := server.Client()

    // When — sign up
    resp, err := client.Post(server.URL+"/api/v1/users",
        "application/json",
        strings.NewReader(`{"email":"a@b.com","username":"alice","password":"PassWord!23"}`),
    )
    require.NoError(t, err)
    require.Equal(t, 201, resp.StatusCode)

    // When — log in
    resp, err = client.Post(server.URL+"/api/v1/auth/login",
        "application/json",
        strings.NewReader(`{"email":"a@b.com","password":"PassWord!23"}`),
    )
    require.NoError(t, err)
    require.Equal(t, 200, resp.StatusCode)

    var body struct{ Token string `json:"token"` }
    require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
    require.NotEmpty(t, body.Token)

    // Then — token works on protected endpoint
    req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/v1/me", nil)
    req.Header.Set("Authorization", "Bearer "+body.Token)
    resp, err = client.Do(req)
    require.NoError(t, err)
    require.Equal(t, 200, resp.StatusCode)
}
```

Patterns:

- `//go:build e2e` build tag separates slow E2E from fast unit tests. Run with `go test -tags=e2e ./...`.
- One narrative per test: "user can sign up then log in". One `Test_E2E_*` per user-visible outcome.
- Real DB via testcontainers, real gin engine, real HTTP. **No mocks.** The point is to catch integration bugs.
- Bounded context — every E2E gets a `context.WithTimeout` so failures don't hang CI.

---

## Goroutine leak detection

```go
package mypkg

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("github.com/prometheus/client_golang/prometheus.(*Registry)..."),
    )
}
```

One line at the top of every package that spawns goroutines. Catches the bug class the race detector cannot.

---

## Snapshot / golden tests — `autogold`

```go
import "github.com/hexops/autogold/v2"

func Test_RenderHelp_matches_snapshot(t *testing.T) {
    // Given
    cmd := newRootCmd()

    // When
    out := captureOutput(t, func() { _ = cmd.Help() })

    // Then
    autogold.ExpectFile(t, out)
}
```

First run: `go test -update ./...` writes `testdata/Test_RenderHelp.golden`. Future runs compare; failures show a diff. Re-approve intentional changes with `-update`.

**Use snapshots for STRUCTURE, not BEHAVIOR.** Good targets:

- CLI `--help` output
- JSON response shape
- Generated SQL queries
- Rendered prompts (assert the structure, not exact wording — see SKILL.md prompt-test rule)

Bad targets: a function's return value where you should `require.Equal` on the actual structure.

---

## Property-based tests — `rapid`

```go
import "pgregory.net/rapid"

func Test_Email_NewEmail_then_String_roundtrips(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        // Given — generate valid emails
        local  := rapid.StringMatching(`[a-z]{3,10}`).Draw(t, "local")
        domain := rapid.StringMatching(`[a-z]{3,10}\.com`).Draw(t, "domain")
        raw    := local + "@" + domain

        // When
        e, err := domain.NewEmail(raw)
        require.NoError(t, err)

        // Then — round-trip property
        e2, err := domain.NewEmail(e.String())
        require.NoError(t, err)
        require.Equal(t, e, e2)
    })
}
```

`rapid` shrinks failing cases to minimal counterexamples. Use for:

- Round-trips (parse → serialize → parse).
- Algebraic properties (sort produces ordered, dedup is idempotent, JSON marshal/unmarshal is involutive).
- Invariants under random input (validator never panics, serializer never produces invalid UTF-8).

---

## HTTP testing — `httptest`

### Server side

```go
func Test_GetUser_returns_user_for_existing_id(t *testing.T) {
    // Given
    svc := newSvcWithFake(t)
    r := gin.New()
    h := &Handler{Users: svc}
    h.Mount(r)

    req := httptest.NewRequest("GET", "/api/v1/users/u-1", nil)
    rec := httptest.NewRecorder()

    // When
    r.ServeHTTP(rec, req)

    // Then
    require.Equal(t, 200, rec.Code)
    var body domain.User
    require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
    require.Equal(t, "u-1", string(body.ID))
}
```

### Client side — `httptest.NewServer`

```go
func Test_Client_retries_on_500(t *testing.T) {
    // Given — fake upstream
    var calls int
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        calls++
        if calls < 3 {
            w.WriteHeader(500)
            return
        }
        w.WriteHeader(200)
        _, _ = w.Write([]byte(`{"ok":true}`))
    }))
    defer srv.Close()

    client := myclient.New(srv.URL)

    // When
    err := client.DoSomething(context.Background())

    // Then
    require.NoError(t, err)
    require.Equal(t, 3, calls)
}
```

`httptest.NewServer` spins a real HTTP server on a random port. The fake handler implements the upstream contract. Test the client against the contract, not the implementation.

---

## Determinism — the cardinal rules

- **No `time.Sleep` in tests.** If you need delay, you need a Clock injection.
- **`go test -shuffle=on`** in every CI run.
- **`go test -count=1`** to defeat the cache.
- **Subscribe to the event, do not poll for it.** Channels, callbacks, `t.Cleanup` over polling.
- **`t.Parallel()`** for tests that share no state. Speeds up large suites by 4-8x.

A test that fails 1-in-10 runs is a bug, not flake. The race detector + `-shuffle=on` + ordering hygiene catches >95% of "flake".

---

## Benchmarks — `testing.B` + `benchstat`

```go
func Benchmark_NewEmail(b *testing.B) {
    for b.Loop() {  // Go 1.24+ idiom, replaces `for i := 0; i < b.N; i++`
        _, _ = domain.NewEmail("alice@example.com")
    }
}
```

Run:

```bash
go test -bench=. -count=10 -benchmem ./... | tee bench.txt
benchstat bench.txt   # statistical comparison
```

Always `-count=10` for stable means. `-benchmem` reports allocations. A 5%-slower benchmark in one run is noise; 10 runs + benchstat tells you what is real.

To compare before/after a change:

```bash
git stash
go test -bench=. -count=10 ./... > before.txt
git stash pop
go test -bench=. -count=10 ./... > after.txt
benchstat before.txt after.txt
```

---

## Coverage — the right target

Run:

```bash
go test -race -shuffle=on -coverprofile=cover.out ./...
go tool cover -html=cover.out -o cover.html
```

**Aim for 80%+ on `internal/domain` and `internal/service`.** Boundary code (handlers, store mappers) is exercised by integration tests, where line coverage understates what is actually verified. Do not chase 100% — the last 5% is usually error paths that need fault-injection to hit.

The `golangci-lint` config does not enforce a minimum — coverage as a CI gate becomes a goal-displacement metric. Treat it as feedback, not requirement.

---

## TUI testing — `teatest`

```go
import teatest "charm.land/bubbletea/v2/teatest"

func Test_Counter_increments_on_space(t *testing.T) {
    // Given
    tm := teatest.NewTestModel(t, initial(), teatest.WithInitialTermSize(80, 24))

    // When
    tm.Send(tea.KeyPressMsg{Code: ' '})

    // Then
    final := tm.FinalModel(t).(model)
    require.Equal(t, 1, final.count)
}
```

For full-view regression, snapshot the rendered output via `autogold`.

---

## Antipatterns the skill rejects

| Bad | Why | Good |
|---|---|---|
| `if got != want { t.Errorf("expected %v got %v", want, got) }` | Reinvents `require.Equal` | Use testify |
| `time.Sleep(100 * time.Millisecond)` after triggering async work | Flake | Subscribe to completion signal, bounded await |
| `t.Skip(...)` to silence a known failure | Buries the bug | Fix or open an issue; never silently skip |
| One mega-test asserting 12 things | First failure hides next 11 | Split by `Then` |
| Snapshot-everything | Locks formatting, not behavior | Snapshots for structure, asserts for values |
| Mock every collaborator | Test asserts implementation, not behavior | Real or fake, never mock everything |
| Test calls private function via `_test.go` in same package only | Couples test to implementation | Test through the public surface |

---

## Sources

- testify: https://github.com/stretchr/testify
- goleak: https://github.com/uber-go/goleak
- autogold: https://github.com/hexops/autogold
- rapid: https://pkg.go.dev/pgregory.net/rapid
- testcontainers-go: https://golang.testcontainers.org
- benchstat: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- "Go test naming conventions" (Dave Cheney): https://dave.cheney.net/practical-go/presentations/qcon-china.html
