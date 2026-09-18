# Data Modeling

Which container to use, how to structure data, and why frozen is the default.

---

## Decision flowchart

```
Is it a fixed set of named constants?
  YES → StrEnum / IntEnum
  NO ↓
Is it just branding a primitive (int, str, float)?
  YES → NewType("X", base)
  NO ↓
Is it an interface / contract ("this thing can do X")?
  ├─ Shape only, no shared code → Protocol
  └─ Shared method implementation needed → ABC
  NO ↓
Does the data cross a trust boundary (user input, API, file, external DB)?
  YES → pydantic.BaseModel (frozen=True) — validates + serializes
  NO ↓
Is it a dict shape needed for JSON compat / **kwargs typing?
  YES → TypedDict
  NO ↓
Is it structured data with named fields?
  YES → @dataclass(frozen=True, slots=True)
  NO ↓
Is it a tuple with positional semantics (x, y coords / DB row)?
  YES → NamedTuple
  NO → you probably don't need a new type
```

---

## Container reference

### @dataclass — internal value object

The default for structured data inside your codebase. Zero overhead, no framework coupling.

```python
from dataclasses import dataclass
from typing import NewType

UserId = NewType("UserId", int)

@dataclass(frozen=True, slots=True)
class User:
    id: UserId
    name: str
    email: str

@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float
```

Always `frozen=True, slots=True`. Mutable only when mutation is the documented purpose — opt out with `# noqa: MUTABLE_OK`.

### Pydantic BaseModel — trust boundary guardian

Use when data enters or leaves your system. Validates at construction, serializes to JSON, generates OpenAPI schema.

```python
from pydantic import BaseModel, ConfigDict, EmailStr

class CreateUserRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    email: EmailStr
    age: int

class UserResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: int
    name: str
    email: str
```

**The one rule**: data crosses a trust boundary → Pydantic. Everything else → dataclass.
Never use Pydantic for internal-only data just because it's convenient. The validation cost is real.

### TypedDict — dict that knows its shape

Use when the value must stay a `dict` at runtime — JSON blobs, `**kwargs`, third-party APIs expecting dicts.

```python
from typing import TypedDict, NotRequired

class Headers(TypedDict):
    content_type: str
    authorization: NotRequired[str]

def make_request(url: str, headers: Headers) -> None: ...

make_request("https://api.example.com", {"content_type": "application/json"})
```

### Protocol — structural interface

"Anything that has method X" — no inheritance required.

```python
from typing import Protocol

class Renderable(Protocol):
    def render(self) -> str: ...

class Saveable(Protocol):
    async def save(self) -> None: ...

@dataclass(frozen=True, slots=True)
class MarkdownDoc:
    content: str
    def render(self) -> str:
        return self.content

def publish(doc: Renderable) -> None:
    print(doc.render())  # MarkdownDoc works — no inheritance needed
```

Default to Protocol for interfaces. ABC only when you need shared method implementations.

### ABC — interface with shared code

Only when Protocol isn't enough.

```python
from abc import ABC, abstractmethod

class BaseRepository(ABC):
    @abstractmethod
    async def get(self, id: int) -> Model | None: ...

    @abstractmethod
    async def save(self, model: Model) -> None: ...

    async def get_or_raise(self, id: int) -> Model:
        result = await self.get(id)
        if result is None:
            msg = f"{type(self).__name__}: id {id} not found"
            raise LookupError(msg)
        return result
```

### NamedTuple — positional + named (rare)

Only when you need tuple protocol (unpacking, indexing).

```python
from typing import NamedTuple

class Coordinate(NamedTuple):
    x: float
    y: float

x, y = Coordinate(1.0, 2.0)  # tuple unpacking
```

99% of the time, `@dataclass(frozen=True, slots=True)` is better.

---

## Quick lookup

| Situation | Use | Why |
|---|---|---|
| User input, API request/response | `Pydantic BaseModel` | Validation, JSON schema, serialization |
| DB row ↔ Python (ORM) | SQLAlchemy `Mapped[]` model | ORM integration, async session |
| Internal value object | `@dataclass(frozen=True, slots=True)` | Zero overhead, no validation needed |
| Multiple outcomes from function | Union of frozen dataclasses | Distinct types for `match` |
| Dict shape for JSON / `**kwargs` | `TypedDict` | Stays a dict at runtime |
| Fixed constants | `StrEnum` / `IntEnum` | Exhaustive match, no typos |
| Distinct primitive | `NewType("X", int)` | Zero runtime cost, type-level only |
| Contract / capability | `Protocol` | Structural typing, no inheritance |
| Contract + shared impl | `ABC` | When Protocol isn't enough |

---

## Comparison matrix

| Feature | dataclass | Pydantic | TypedDict | Protocol | NamedTuple | NewType | Enum |
|---|---|---|---|---|---|---|---|
| Validation | - | ✓ | - | - | - | - | - |
| JSON serialization | manual | built-in | native dict | - | - | - | `.value` |
| Immutable | frozen=True | frozen=True | - (dict) | N/A | always | N/A | always |
| Runtime cost | ~zero | validation | zero | zero | ~zero | zero | ~zero |
| `match` support | ✓ | ✓ | - | - | ✓ | - | ✓ |
| `slots` support | ✓ | - | - | - | - | - | - |

---

## Parse, don't validate

Validate at the boundary. Inside the boundary, types are proof of validity.

```python
# BAD — validate then pass raw data
def process_email(email: str) -> None:
    if "@" not in email:
        raise ValueError("invalid email")
    # still a raw str everywhere downstream

# GOOD — parse into typed value at boundary
from typing import NewType

Email = NewType("Email", str)

def parse_email(raw: str) -> Email:
    if "@" not in raw or "." not in raw.split("@")[1]:
        msg = f"invalid email: {raw}"
        raise ValueError(msg)
    return Email(raw.lower().strip())

# Downstream only sees Email, never raw str
def send_welcome(email: Email) -> None: ...
```

With Pydantic this happens automatically — `EmailStr` is already a parsed type. Once constructed, `.email` is always valid. No re-validation needed.

---

## Sources

- Python docs: [dataclasses](https://docs.python.org/3/library/dataclasses.html)
- Pydantic v2: [docs.pydantic.dev](https://docs.pydantic.dev/latest/)
- Python docs: [typing — Protocol](https://docs.python.org/3/library/typing.html#typing.Protocol)
- Python docs: [typing — TypedDict](https://docs.python.org/3/library/typing.html#typing.TypedDict)
- Alexis King: [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
