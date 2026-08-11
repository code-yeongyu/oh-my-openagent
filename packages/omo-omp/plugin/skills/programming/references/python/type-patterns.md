# Type Patterns

How to use Python's type system to catch bugs at check time, not runtime.

---

## NewType — distinct primitives

Same runtime type, different meaning. The type checker prevents mixing.

```python
from typing import NewType

UserId = NewType("UserId", int)
MovieId = NewType("MovieId", int)
Email = NewType("Email", str)
Seconds = NewType("Seconds", float)
Milliseconds = NewType("Milliseconds", float)

def get_user(user_id: UserId) -> User: ...
def get_movie(movie_id: MovieId) -> Movie: ...
def sleep(duration: Seconds) -> None: ...

uid = UserId(42)
mid = MovieId(42)

get_user(uid)   # OK
get_user(mid)   # type error: MovieId is not UserId
get_user(42)    # type error: int is not UserId
sleep(Milliseconds(100.0))  # type error
```

**Use when**: IDs, indices, keys, units of measurement — any pair where swapping is a bug.
**Skip when**: ephemeral local math where branding adds noise with zero safety gain.

---

## Final — constants are const

Module-level constants declare their intent. Reassignment is a type error.

```python
from typing import Final

MAX_RETRIES: Final = 3
API_BASE_URL: Final = "https://api.example.com"
DEFAULT_TIMEOUT: Final = 30.0

MAX_RETRIES = 5  # type error: cannot assign to Final
```

If it changes at runtime, it's not a constant — make it a function parameter or config field.

---

## TypeAlias — name complex types

If a union or generic appears more than once, give it a name.

```python
# Python 3.12+
type JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
type Headers = dict[str, str]
type Middleware = Callable[[Request], Awaitable[Response]]

# Pre-3.12
from typing import TypeAlias

JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
```

---

## StrEnum / IntEnum — closed sets

Any fixed set of known values. No string literals scattered through code.

```python
from enum import StrEnum, IntEnum, unique

@unique
class Role(StrEnum):
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"

@unique
class HttpStatus(IntEnum):
    OK = 200
    NOT_FOUND = 404
    INTERNAL_ERROR = 500

# BAD
def check_role(role: str) -> bool: ...

# GOOD
def check_role(role: Role) -> bool: ...
```

`StrEnum` when values serialize as strings (API, DB). `IntEnum` for numeric codes. Plain `Enum` for pure labels.

---

## Type narrowing — let the checker follow your logic

`isinstance`, `is None`, and `match` narrow types automatically. Use them instead of `cast`.

```python
def process(value: str | int | None) -> str:
    if value is None:
        return "nothing"
    # checker knows: str | int

    if isinstance(value, str):
        return value.upper()
    # checker knows: int

    return str(value * 2)
```

### TypeGuard for custom narrowing

```python
from typing import TypeGuard

def is_valid_email(value: str) -> TypeGuard[Email]:
    return "@" in value and "." in value.split("@")[1]

def send(addr: str) -> None:
    if not is_valid_email(addr):
        raise ValueError(addr)
    # checker knows: addr is Email
    deliver(addr)
```

### TypeIs (Python 3.13+) — the strict version

`TypeIs` is stricter than `TypeGuard` — it narrows in both `if` and `else` branches.

```python
from typing import TypeIs

def is_str(value: str | int) -> TypeIs[str]:
    return isinstance(value, str)

def handle(v: str | int) -> None:
    if is_str(v):
        print(v.upper())   # checker knows: str
    else:
        print(v + 1)       # checker knows: int
```

---

## Union syntax

Always `X | Y`. Never `Union[X, Y]` or `Optional[X]`.

```python
# BAD
from typing import Union, Optional
def f(x: Optional[int]) -> Union[str, int]: ...

# GOOD
def f(x: int | None) -> str | int: ...
```

---

## Sources

- Python docs: [typing — NewType](https://docs.python.org/3/library/typing.html#newtype)
- Python docs: [typing — Final](https://docs.python.org/3/library/typing.html#typing.Final)
- Python docs: [typing — TypeGuard](https://docs.python.org/3/library/typing.html#typing.TypeGuard)
- PEP 604: [Union syntax X | Y](https://peps.python.org/pep-0604/)
- PEP 742: [TypeIs](https://peps.python.org/pep-0742/)
