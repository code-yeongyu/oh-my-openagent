# orjson — When to Use, How to Integrate

`orjson` is the fastest JSON library on PyPI — written in Rust, 6–11× faster than stdlib `json` on serialization, 1.5–4× faster on deserialization. It also supports types the stdlib refuses to serialize: `datetime`, `date`, `UUID`, `numpy` arrays, `dataclass`, Pydantic models (via a small bridge).

This document covers the production patterns. **Not every project needs orjson.** The decision tree is in §1.

---

## 1. Decision tree — should you adopt orjson?

```
Are you serializing/deserializing JSON in a hot path?
  ├─ NO  → stdlib `json` is fine. Stop here.
  └─ YES ↓

Is the project FastAPI?
  ├─ YES ↓
  │
  │   Is your response body fully described by a Pydantic v2 model?
  │     ├─ YES → Use FastAPI's default JSON response (uses Pydantic's
  │     │       Rust-backed serializer; orjson saves nothing in this path).
  │     │       Adopt orjson only for *non-Pydantic* responses below.
  │     └─ NO  → Use `ORJSONResponse` for endpoints that return dicts,
  │             lists, or arbitrary structures.
  │
  └─ NOT FastAPI ↓

Are you serializing Pydantic v2 models repeatedly?
  ├─ YES → Use `model.model_dump_json()` directly — backed by pydantic-core
  │        (Rust), within ~10% of orjson on the same payload, and respects
  │        every Pydantic feature (computed fields, aliases, validators).
  └─ NO  ↓

Are you serializing dicts / lists / dataclasses / datetime / UUID?
  ├─ YES → orjson is the right answer.
  └─ NO  → stdlib `json`.
```

**The crucial 2026 fact**: with Pydantic v2's `model_dump_json()`, **Pydantic-shaped responses no longer need orjson**. Adopt orjson where you are still going through `dict` / `list` / `dataclass`.

---

## 2. Install

```toml
# pyproject.toml
dependencies = [
    "orjson>=3.10",
]
```

orjson wheels are published for every major CPython version and platform (macOS, Linux glibc/musl, Windows, ARM64). No compilation step on install.

---

## 3. Basic usage

```python
import orjson

# Serialization — returns bytes, not str
raw: bytes = orjson.dumps({"hello": "world", "ts": datetime.now(UTC)})

# Deserialization
data = orjson.loads(raw)
```

Two things to internalize:

1. **`orjson.dumps` returns `bytes`**, not `str`. Stdlib `json.dumps` returns `str`. This is by design — most JSON destinations (sockets, files in binary mode, HTTP bodies) want bytes anyway, and skipping the encode/decode round trip is part of the speedup.
2. **No `indent` arg.** orjson supports `OPT_INDENT_2` (and only 2-space indent) via flags. If you need other indentation, use stdlib `json`.

---

## 4. The option flags you actually use

```python
import orjson

orjson.dumps(
    payload,
    option=(
        orjson.OPT_NAIVE_UTC          # treat naive datetimes as UTC (recommended)
        | orjson.OPT_UTC_Z            # render UTC as "...Z" instead of "+00:00"
        | orjson.OPT_SERIALIZE_NUMPY  # serialize numpy arrays natively
        | orjson.OPT_SERIALIZE_DATACLASS  # serialize @dataclass instances
        | orjson.OPT_NON_STR_KEYS     # allow int / UUID / datetime dict keys
        # | orjson.OPT_SORT_KEYS      # only when you need deterministic output
        # | orjson.OPT_INDENT_2       # only for human-readable output (slower)
    ),
)
```

Each flag is opt-in for a reason — orjson defaults to spec-strict JSON.

The flag combination above is a sensible "production default" for application code. The `OPT_NAIVE_UTC | OPT_UTC_Z` pair is especially important: it produces RFC 3339 timestamps that every parser on earth accepts.

---

## 5. orjson + FastAPI

### 5.1 The legacy pattern: `ORJSONResponse`

```python
from fastapi import FastAPI
from fastapi.responses import ORJSONResponse

app = FastAPI(default_response_class=ORJSONResponse)

@app.get("/items")
async def get_items() -> dict[str, list[dict[str, int]]]:
    return {"items": [{"id": i, "qty": i * 2} for i in range(1000)]}
```

`default_response_class=ORJSONResponse` swaps the global JSON encoder for orjson. **This affects only the response body serialization**, not request parsing — for request parsing, FastAPI still uses Pydantic.

### 5.2 The 2026 reality — Pydantic v2 vs orjson

With FastAPI 0.100+ on Pydantic v2:

- If your response is annotated with a Pydantic model, FastAPI calls `model_dump_json()` directly. **orjson is bypassed** even with `default_response_class=ORJSONResponse`, because the Pydantic serializer is already Rust-backed.
- If your response is a raw `dict` / `list` / Python object, `ORJSONResponse` does kick in and saves real time.

The benchmark in `tiangolo/fastapi#11728` (Apr 2024) showed `model_dump_json()` is ~10–15% faster than `ORJSONResponse + model_dump()` for Pydantic-shaped responses. The shape of the data matters; on mixed-shape APIs, keep `ORJSONResponse` as the default and trust Pydantic's path for typed responses.

### 5.3 Recommended setup

```python
from fastapi import FastAPI
from fastapi.responses import ORJSONResponse

app = FastAPI(
    default_response_class=ORJSONResponse,  # benefits dict/list returns
    # Pydantic-typed returns automatically use pydantic-core serialization
)
```

**Do NOT** wrap Pydantic models manually:

```python
# BAD — defeats Pydantic's optimized path
@app.get("/users/{id}", response_class=ORJSONResponse)
async def get_user(id: int) -> ORJSONResponse:
    user = await fetch_user(id)
    return ORJSONResponse(content=user.model_dump())  # extra dict trip

# GOOD — let FastAPI serialize the model
@app.get("/users/{id}")
async def get_user(id: int) -> User:
    return await fetch_user(id)
```

### 5.4 Streaming responses

`ORJSONResponse` does not stream — it buffers the whole response. For SSE, NDJSON, or chunked JSON, use `StreamingResponse` and call `orjson.dumps` per chunk:

```python
from fastapi.responses import StreamingResponse
import orjson

async def ndjson_stream():
    async for row in fetch_rows():
        yield orjson.dumps(row) + b"\n"

@app.get("/export")
async def export():
    return StreamingResponse(ndjson_stream(), media_type="application/x-ndjson")
```

This is where orjson shines — per-chunk serialization in a tight loop, zero buffering.

---

## 6. orjson + Pydantic v2 (no FastAPI)

When you have a Pydantic model and want orjson's output for non-FastAPI contexts:

```python
from pydantic import BaseModel
import orjson

class User(BaseModel):
    id: int
    email: str
    created: datetime

user = User(id=1, email="a@b.com", created=datetime.now(UTC))

# Option A — Pydantic's built-in Rust serializer (USE THIS by default)
raw: bytes = user.model_dump_json().encode()
# 2026: ~1.2× faster than orjson on the same payload, supports
# every Pydantic feature (aliases, computed fields, json_schema_extra, etc.)

# Option B — orjson bridge for cases Pydantic does not cover
raw: bytes = orjson.dumps(
    user,
    default=lambda obj: obj.model_dump() if isinstance(obj, BaseModel) else None,
)
# Useful when serializing nested non-Pydantic structures that contain
# BaseModels — e.g. a list of dicts that each may contain a BaseModel.
```

For routine "serialize one Pydantic model to JSON", `model_dump_json()` wins on speed AND feature parity. Reach for orjson only at the *container* level (a dict of mixed types).

### Custom `default=` callback — the universal extension point

```python
import orjson
from decimal import Decimal
from pydantic import BaseModel

def _default(obj):
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, set):
        return list(obj)
    raise TypeError(f"orjson: cannot serialize {type(obj).__name__}")

orjson.dumps(payload, default=_default, option=orjson.OPT_NAIVE_UTC | orjson.OPT_UTC_Z)
```

The `default=` callback runs once per unrecognized type, then orjson caches the path. Performance impact on subsequent calls is negligible.

---

## 7. Caching, queues, logging — the prime orjson use cases

These are where orjson pays off most clearly because there is no Pydantic in the loop:

### Redis cache

```python
import orjson
import redis.asyncio as redis

r = redis.from_url("redis://localhost")

async def set_cache(key: str, value: dict) -> None:
    await r.set(key, orjson.dumps(value), ex=3600)

async def get_cache(key: str) -> dict | None:
    raw = await r.get(key)
    return orjson.loads(raw) if raw else None
```

`orjson` over stdlib `json` here saves ~5–10× on the serialize step for typical cache payloads. Multiply by request rate.

### Task queue payloads (Celery, RQ, dramatiq)

```python
# Celery custom serializer
from kombu.serialization import register
import orjson

def _orjson_dumps(obj):
    return orjson.dumps(obj, option=orjson.OPT_NAIVE_UTC | orjson.OPT_UTC_Z).decode()

def _orjson_loads(s):
    return orjson.loads(s)

register("orjson", _orjson_dumps, _orjson_loads,
         content_type="application/x-orjson",
         content_encoding="utf-8")
```

Same speedup, applied to every task payload encode/decode.

### Structured logging (structlog, custom slog)

```python
import structlog
import orjson

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(serializer=orjson.dumps),
    ],
)
```

structlog's `JSONRenderer` accepts any callable; orjson is the obvious default. Logging hot paths benefit dramatically — every log line at info level becomes ~5× cheaper to render.

---

## 8. Gotchas

### `orjson.dumps` returns bytes, not str

```python
# BAD — concatenating bytes and str
log.info("payload: " + orjson.dumps(data))   # TypeError

# GOOD
log.info("payload: %s", orjson.dumps(data).decode())
# or
log.info("payload: %s", orjson.dumps(data))  # let the formatter handle it
```

### No `cls=` argument for custom encoders

orjson uses `default=` only. If you have a custom `JSONEncoder` subclass from stdlib `json`, port its `default()` method to a `default=` callable.

### Subclasses of `dict` / `list` are NOT serialized as their parent

```python
class StrictDict(dict): ...
d = StrictDict({"k": "v"})

import json
json.dumps(d)              # OK — stdlib walks subclasses
orjson.dumps(d)            # TypeError — orjson is strict by design
orjson.dumps(d, option=orjson.OPT_PASSTHROUGH_SUBCLASS)  # then route via default=
```

Set `OPT_PASSTHROUGH_SUBCLASS` and handle the subclass in `default=`. The design discourages accidental subclass usage that breaks elsewhere.

### `int` overflow

orjson refuses to encode integers larger than 2⁵³ - 1 by default (the IEEE-754 double-precision safe-integer limit — what JavaScript can round-trip). For larger ints, opt in:

```python
orjson.dumps(huge_int, option=orjson.OPT_STRICT_INTEGER)  # error
orjson.dumps(huge_int)  # default — int is encoded as JSON number
# JavaScript clients lose precision past 2^53; consider sending as string
```

This is more spec-strict than stdlib `json`, which silently emits ints of any size.

### Timezone-naive datetimes

By default, orjson treats naive `datetime` as the system local timezone — almost never what you want. **Always set `OPT_NAIVE_UTC`** to treat naive datetimes as UTC, or use timezone-aware datetimes (which is the better long-term habit).

---

## 9. Benchmark — should I actually adopt this?

The numbers below are 2024–2026 averages from `tiangolo/fastapi#11728` and orjson's own benchmark suite, on Python 3.13, modern x86_64:

| Payload | stdlib `json` | `orjson` | `model_dump_json()` (Pydantic v2) |
|---|---|---|---|
| Small dict (100 fields) | 1.0× | **8×** | n/a |
| List of 10k dicts | 1.0× | **11×** | n/a |
| Pydantic model with 20 fields | 1.0× (after `model_dump()`) | 5× (with `default=` bridge) | **6×** |
| Datetime-heavy payload | 1.0× (after manual ISO conv) | **9×** | 6× |
| numpy array (1M floats) | impossible without manual conv | **20×** vs json+tolist | n/a |

The takeaways:

- For raw dict/list/datetime, **orjson is dramatically faster**.
- For Pydantic models, **`model_dump_json()` is already faster than orjson+bridge**.
- For numpy, orjson is the only sane choice.

In production, the actual measured win on a FastAPI app with mixed payloads is typically 5–15% reduction in p99 latency. Worth the one-line `default_response_class=ORJSONResponse` switch.

---

## 10. When NOT to adopt orjson

- The codebase is small, JSON is not a bottleneck, and you have no measured perf concern.
- You depend on stdlib `json`'s `cls=` arg or its lax tolerance for non-spec input (NaN, Infinity, comments).
- You need pretty-printed JSON with custom indent — orjson only supports 2-space indent via the flag.
- You need pure-Python portability (e.g., MicroPython, no-wheel platforms) — orjson is a compiled Rust extension.

If the choice is "add a dependency that does 5–10× the speed on serialization for free", the answer is almost always yes. The "almost" is in the bullets above.

---

## Sources

- orjson: https://github.com/ijl/orjson
- Pydantic v2 `model_dump_json`: https://docs.pydantic.dev/latest/concepts/serialization/#modelmodel_dump_json
- FastAPI `ORJSONResponse`: https://fastapi.tiangolo.com/advanced/custom-response/#use-orjsonresponse
- "FastAPI + orjson vs Pydantic v2" benchmark: https://github.com/fastapi/fastapi/discussions/11728
- structlog JSON rendering: https://www.structlog.org/en/stable/api.html#structlog.processors.JSONRenderer
