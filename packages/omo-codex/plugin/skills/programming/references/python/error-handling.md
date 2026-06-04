# Error Handling

Typed errors, exhaustive matching, union returns, and resource safety.

---

## Typed errors — no bare strings

Error types carry structured data. Pattern matching works. Callers know exactly what can go wrong.

```python
from dataclasses import dataclass
from typing import NewType

UserId = NewType("UserId", int)

@dataclass(frozen=True, slots=True)
class UserNotFoundError(Exception):
    user_id: UserId

    def __str__(self) -> str:  # REQUIRED — see note below
        return f"user {self.user_id} not found"

@dataclass(frozen=True, slots=True)
class PermissionDeniedError(Exception):
    user_id: UserId
    required_role: str

    def __str__(self) -> str:
        return f"user {self.user_id} needs role {self.required_role}"
```

**`__str__` is mandatory** on dataclass exceptions. `@dataclass` replaces `Exception.__init__`, so `self.args` is always `()`. Without `__str__`, `str(e)` returns an empty string and logging/monitoring breaks.

```python
# BAD
raise ValueError("user not found")
raise ValueError("permission denied")

# GOOD
raise UserNotFoundError(user_id=uid)
raise PermissionDeniedError(user_id=uid, required_role="admin")
```

---

## Union returns — expected failures without exceptions

For failures that are **expected** (not found, validation error, permission denied), return a union instead of raising. Exceptions are for **unexpected** failures (network down, OOM, corrupted data).

### Define the outcome types

```python
@dataclass(frozen=True, slots=True)
class User:
    id: UserId
    name: str

@dataclass(frozen=True, slots=True)
class UserNotFound:
    id: UserId

@dataclass(frozen=True, slots=True)
class PermissionDenied:
    id: UserId
    reason: str

type GetUserResult = User | UserNotFound | PermissionDenied
```

### Handle exhaustively

```python
from typing import assert_never

def handle_result(result: GetUserResult) -> str:
    match result:
        case User(name=name):
            return f"Found: {name}"
        case UserNotFound(id=uid):
            return f"No user with id {uid}"
        case PermissionDenied(reason=reason):
            return f"Denied: {reason}"
        case _ as unreachable:
            assert_never(unreachable)
```

`assert_never` in the default case: if you add a new variant to `GetUserResult` without handling it here, the type checker errors. No silent fall-through.

### When to use which

**The heuristic**: caller is 1-2 levels away and MUST handle it → union return. Error should propagate up many layers to a boundary → exception.

| Scenario | Pattern | Why |
|---|---|---|
| Repository → service (caller handles it) | Union return (`User \| UserNotFound`) | Caller is right there, must handle both |
| Validation at boundary (parsing input) | Exception (typed, with fields) | Propagates up to HTTP/CLI handler |
| Infrastructure failure (network, OOM) | Exception | Can't handle locally, must propagate |
| Service → service (deep internal) | Exception (typed) | Union boilerplate across many layers is worse than exceptions |
| HTTP handler → response | Catch exceptions, convert to response | Boundary code catches and translates |

**Practical tradeoff**: union returns are safest (type checker forces handling) but create boilerplate when every caller in a chain must `match`. If the error would just propagate through 3+ layers unchanged, use a typed exception instead.

---

## Exhaustive match — every match needs a default

Every `match` statement ends with `case _: assert_never(x)`. No exceptions.

```python
from enum import StrEnum
from typing import assert_never

class Status(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    DELETED = "deleted"

def describe(status: Status) -> str:
    match status:
        case Status.PENDING:
            return "waiting"
        case Status.ACTIVE:
            return "live"
        case Status.DELETED:
            return "gone"
        case _ as unreachable:
            assert_never(unreachable)
```

Add a new enum member? The type checker tells you every `match` that needs updating.

---

## Context managers — resource safety

If it has `.close()`, `.shutdown()`, `.disconnect()`, or `.release()`, wrap it in `with`.

```python
# BAD
f = open("data.txt")
data = f.read()
f.close()  # forgotten? leaked

# GOOD
from pathlib import Path

data = Path("data.txt").read_text()
```

### Async resources

```python
import httpx

async def fetch_users() -> list[User]:
    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.example.com/users")
        response.raise_for_status()
        return [User(**u) for u in response.json()]
```

### Custom context manager

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

@asynccontextmanager
async def managed_connection(url: str) -> AsyncIterator[Connection]:
    conn = await connect(url)
    try:
        yield conn
    finally:
        await conn.close()

async with managed_connection("postgres://...") as conn:
    await conn.execute("SELECT 1")
# conn is closed here, guaranteed
```

---

## Exception hierarchy — when you do raise

Keep exception hierarchies shallow and specific.

```python
class AppError(Exception):
    """Base for all application errors."""

@dataclass(frozen=True, slots=True)
class NotFoundError(AppError):
    entity: str
    id: int

    def __str__(self) -> str:
        return f"{self.entity} {self.id} not found"

@dataclass(frozen=True, slots=True)
class ConflictError(AppError):
    entity: str
    field: str
    value: str

    def __str__(self) -> str:
        return f"{self.entity}.{self.field} = {self.value!r} already exists"
```

Callers catch `AppError` at the boundary, or specific subtypes where they can do something useful.

---

## Sources

- Python docs: [typing — assert_never](https://docs.python.org/3/library/typing.html#typing.assert_never)
- Python docs: [contextlib](https://docs.python.org/3/library/contextlib.html)
- Python docs: [match statement](https://docs.python.org/3/reference/compound_stmts.html#the-match-statement)
