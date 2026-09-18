# Code Smells — Full Reference

When any of these smells is detected, **STOP and re-examine your design.** A code smell is not a syntax error — it is a signal that the current structure deserves a second look. The correct response is to assess whether `/refactor` is warranted, fix the smell, or document a SPECIFIC justification for carrying it. "It's fine" is not a justification.

---

## Smell 1 — File exceeds 250 pure LOC

### Why 250

At 250 pure LOC a file still fits in one screen on a 32-inch monitor with a 14pt font. A reviewer can hold the whole thing in working memory and spot a cross-cutting bug. At 500 LOC they cannot. At 1000 LOC they stop trying. The number is the cognitive ceiling of a single human reviewer who has not memorized the file.

A file past this line is telling you:

- The module is doing more than one thing.
- Multiple cohesive units got merged "to save a file."
- Re-exports, barrels, and orchestrators got fused into pure-logic units.
- Every future reader pays a tax to find what they need.

### Measuring pure LOC

```bash
# Quick (line-comment + blank exclusion):
awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' <file> | wc -l

# Authoritative (handles block comments correctly):
cloc --by-file <file>   # the "code" column is the number
```

### Required behavior when detected

**Creating a file that will exceed 250 pure LOC.** Split it before the first commit. Carve by responsibility, one cohesive unit per file. Use a barrel (`__init__.py`, `mod.rs`, `index.ts`) for re-exports ONLY — never for logic.

**Editing a file that already exceeds 250 pure LOC and your edit adds lines.** Refactor the unit you are touching into its own file BEFORE adding the new lines. The split is part of THIS task, not a follow-up someone will never do.

**Reading a file that exceeds 250 pure LOC while implementing a feature.** Surface the smell in your reply, propose a concrete split, and ask the user whether to split now or carry the smell.

### Forbidden escapes

- Counting comments and blank lines toward the budget. **Pure LOC means code lines.**
- Splitting by token count (`foo_1.py`, `module_part_A.rs`, `service-2.ts`). Split by what each file DOES.
- Catch-all dump files: `utils.py`, `helpers.ts`, `lib.rs` (as a logic dump), `common.py`, `shared.ts`.
- "It's generated, so it's fine." Only true if the file lives in `dist/`, `target/`, `__generated__/`.
- "It's a test file with many cases." Split by SUT or by behavior cluster.
- "230 pure LOC, close enough." A 230-LOC file about to grow is already at the limit. Split now.

### Acceptable exceptions (rare, require justification)

A file may legitimately exceed 250 pure LOC if **and only if** it is:

- A truly indivisible single-responsibility unit (e.g., a generated parser table, a state machine whose states share a single closure). Mark with `// allow: SIZE_OK — <reason>`.
- A pure data table (translation strings, error code lookup, brand color palette).

`// allow: SIZE_OK` without a justifying comment is itself slop.

### Concrete split examples

#### Python — BEFORE (`user_service.py`, 412 pure LOC)

```python
# user_service.py — DOES TOO MUCH
class UserRepository: ...        # 90 LOC of SQLAlchemy
class UserValidator: ...         # 60 LOC of Pydantic + business rules
class PasswordHasher: ...        # 40 LOC of bcrypt wrapper
class EmailSender: ...           # 50 LOC of httpx2 client
class UserService: ...           # 130 LOC orchestrating the four above
def _build_query(...): ...       # 25 LOC helper
def _format_email(...): ...      # 17 LOC helper
```

#### Python — AFTER (split by responsibility)

```
src/myapp/users/
├── __init__.py              # barrel: re-exports UserService only (5 LOC)
├── repository.py            # UserRepository                 (~95 LOC)
├── validator.py             # UserValidator                  (~65 LOC)
├── password.py              # PasswordHasher                 (~45 LOC)
├── notifier.py              # EmailSender (renamed — the role, not the verb)
├── service.py               # UserService (orchestrator)     (~135 LOC)
└── _queries.py              # _build_query (private)         (~30 LOC)
```

#### Rust — BEFORE (`auth.rs`, 380 pure LOC)

```rust
// auth.rs — DOES TOO MUCH
pub struct Session { ... }                      // 40 LOC
impl Session { ... }                            // 90 LOC of methods
pub struct TokenIssuer { ... }                  // 30 LOC
impl TokenIssuer { ... }                        // 70 LOC
pub struct RateLimiter { ... }                  // 50 LOC
impl RateLimiter { ... }                        // 70 LOC
fn parse_authorization_header(...) { ... }      // 30 LOC
```

#### Rust — AFTER

```
src/auth/
├── mod.rs              # re-exports Session, TokenIssuer, RateLimiter (8 LOC)
├── session.rs          # Session + impl                         (~130 LOC)
├── token.rs            # TokenIssuer + impl                     (~100 LOC)
├── rate_limit.rs       # RateLimiter + impl                     (~120 LOC)
└── header.rs           # parse_authorization_header             (~35 LOC)
```

#### TypeScript — BEFORE (`api/orders.ts`, 510 pure LOC)

```typescript
// api/orders.ts — DOES TOO MUCH
export const OrderSchema = z.object({ ... })          // 30 LOC
type Order = z.infer<typeof OrderSchema>
export class OrderRepository { ... }                  // 110 LOC
export class PricingEngine { ... }                    // 130 LOC
export class TaxCalculator { ... }                    // 90 LOC
export class OrderService { ... }                     // 150 LOC
```

#### TypeScript — AFTER

```
src/orders/
├── index.ts                    # barrel (6 LOC)
├── schema.ts                   # OrderSchema + Order type      (~35 LOC)
├── repository.ts               # OrderRepository               (~115 LOC)
├── pricing.ts                  # PricingEngine                 (~135 LOC)
├── tax.ts                      # TaxCalculator                 (~95 LOC)
└── service.ts                  # OrderService (orchestrator)   (~155 LOC)
```

---

## Smell 2 — Function with more than 3 parameters

### Why 3

A function's parameters are its contract with every caller. More than 3 independent inputs overwhelm the caller's working memory and signal one of two design problems:

1. **The function does too much.** It should be two functions.
2. **Related parameters belong together.** They should be a typed struct/object — a domain concept, not a parameter bag.

### Workaround detection — THESE COUNT AS THE SAME SMELL

Disguising parameter count does not fix the design. The following patterns are the same smell wearing a different hat:

**Dict/map smuggling:**
```python
# SMELL — hiding 6 args in a dict
def create_order(params: dict[str, Any]) -> Order: ...
```
```typescript
// SMELL — untyped options bag
function createOrder(opts: Record<string, unknown>): Order { ... }
```
```go
// SMELL — map instead of typed params
func CreateOrder(params map[string]any) (*Order, error) { ... }
```

**Variadic/kwargs catch-all:**
```python
# SMELL — hiding real params behind kwargs
def send_notification(recipient: str, **kwargs) -> None: ...
```
```typescript
// SMELL — rest params to avoid naming args
function sendNotification(recipient: string, ...args: unknown[]): void { ... }
```

**Config object that wraps positional args:**
```python
# SMELL — "options" object that exists only to bundle what would be positional args
@dataclass
class CreateUserOptions:
    name: str
    email: str
    password: str
    role: str
    department: str
    manager_id: int
    # 6 fields, used by exactly one function, no defaults

def create_user(opts: CreateUserOptions) -> User: ...
```

**When the options object is NOT a smell:** when it represents a genuine domain concept reused across multiple call sites with sensible defaults for most fields (e.g., `HttpClientConfig`, `DatabaseConnectionOptions`, `RetryPolicy`).

### The fix

Group related parameters into typed value objects with domain names:

```python
# CLEAN — grouped by domain concept
@dataclass(frozen=True)
class UserIdentity:
    name: str
    email: str

@dataclass(frozen=True)
class OrgPlacement:
    role: str
    department: str
    manager_id: int

def create_user(identity: UserIdentity, placement: OrgPlacement, password: str) -> User: ...
# 3 params, each a meaningful concept
```

```typescript
// CLEAN — typed grouping
interface ShippingDetails {
  readonly address: string;
  readonly city: string;
  readonly zip: string;
  readonly country: string;
}

function createOrder(customer: CustomerId, items: readonly LineItem[], shipping: ShippingDetails): Order { ... }
// 3 params, shipping is a reusable domain type
```

```go
// CLEAN — struct with domain meaning
type Placement struct {
    Role       string
    Department string
    ManagerID  UserID
}

func CreateUser(identity UserIdentity, placement Placement, password string) (*User, error) { ... }
```

If 4+ truly independent inputs are required, justify it — the justification must name WHY these inputs cannot be grouped, not just "the function needs them all."

---

## Smell 3 — Redundant verification after a destructive action

### Why this is slop

The contract of a destructive operation (delete, remove, clear, drop) IS the verification. If the operation returns without error, the thing is gone. Re-querying to "confirm" is:

1. **Dead code.** The check can never fail unless the operation itself is broken — in which case fix the operation, not the caller.
2. **Misleading.** It teaches the next reader (human or AI) that the operation is unreliable.
3. **Performance waste.** An unnecessary round-trip to the database, filesystem, or data structure.

This pattern is the hallmark of AI-generated defensive bloat. LLMs produce it because they optimize for "looking thorough" over "being correct." **Recognize it. Delete it.**

### Examples

```python
# SLOP — delete then verify deletion
db.delete(user)
db.commit()
remaining = db.query(User).filter_by(id=user.id).first()
assert remaining is None  # the ORM already guaranteed this

# CLEAN
db.delete(user)
db.commit()
```

```typescript
// SLOP — remove from array then check it's gone
items = items.filter(i => i.id !== targetId);
if (items.find(i => i.id === targetId)) {
  throw new Error("removal failed");  // impossible by construction
}

// CLEAN
items = items.filter(i => i.id !== targetId);
```

```go
// SLOP — delete row then SELECT to confirm
_, err := db.ExecContext(ctx, "DELETE FROM users WHERE id = $1", id)
if err != nil { return err }
row := db.QueryRowContext(ctx, "SELECT id FROM users WHERE id = $1", id)
if err := row.Scan(&check); err != sql.ErrNoRows {
    return fmt.Errorf("delete verification failed")
}

// CLEAN
_, err := db.ExecContext(ctx, "DELETE FROM users WHERE id = $1", id)
if err != nil { return err }
```

```rust
// SLOP — remove from HashMap then check absence
map.remove(&key);
if map.contains_key(&key) {
    panic!("removal failed");  // HashMap::remove is not broken
}

// CLEAN
map.remove(&key);
```

### Broader pattern — same smell, different disguise

Any of these are the same defect:

- Calling a **setter** then immediately calling the **getter** to "confirm" the value changed.
- **Writing** a file then **reading** it back to "verify" the write.
- **Inserting** a row then **SELECT-ing** it to "confirm" the insert.
- **Pushing** to an array then checking `.length` increased by 1.
- **Assigning** a variable then asserting the variable equals the assigned value.

**The contract of the operation IS the verification.** If you cannot trust the operation's return, the defect is in the operation — fix it there, not at the call site.

---

## Smell 4 — Negative-form names and conditions

### Why positive form wins

Every negation forces the reader to mentally invert. One negation is tolerable. Two (`if !isNotReady`) is a logic puzzle. Codebases that default to negative naming accumulate double and triple negations that nobody can review confidently.

Positive form reads in the direction of intent: "is this ready?" rather than "is this not-not-ready?"

### Naming

| Negative (SMELL) | Positive (CLEAN) |
|---|---|
| `isNotValid` | `isValid` (invert branch) |
| `isDisabled` | `isEnabled` |
| `noErrors` | `isClean` / `errorsResolved` |
| `notFound` | `found` (invert branch) |
| `isNotEmpty` | `hasItems` / `isPopulated` |
| `missingAuth` | `hasAuth` / `isAuthenticated` |
| `cannotProceed` | `canProceed` (invert branch) |

Name the **presence** of the quality you care about, not the absence of its opposite.

### Conditions

```python
# SMELL — double negative
if not is_invalid(token):
    proceed()

# CLEAN — single positive check
if is_valid(token):
    proceed()
```

```typescript
// SMELL — negated boolean in branch
if (!user.isNotVerified) {
  grantAccess();
}

// CLEAN — positive name, direct check
if (user.isVerified) {
  grantAccess();
}
```

```go
// SMELL — inverted negative
if !config.DisableLogging {
    log.Info("starting")
}

// CLEAN — positive flag
if config.LoggingEnabled {
    log.Info("starting")
}
```

```rust
// SMELL — negated negative
if !skip_validation {
    validate(&input)?;
}

// CLEAN — positive gate
if should_validate {
    validate(&input)?;
}
```

### When negation IS appropriate

- **Early returns / guard clauses:** `if !authorized { return Err(...) }` — the negative form IS the intent (reject the bad case).
- **Filtering out:** `items.filter(|x| !x.is_expired())` — the negation describes the keep/discard decision directly.
- **Error state names:** `Error`, `Failed`, `Timeout` are negative concepts by nature — do not force them into positive wrappers like `isSuccessAbsent`.

The rule is not "never use negation." The rule is: **when you have a choice between naming the presence and naming the absence, name the presence.** The branch logic follows from the name, not the other way around.
