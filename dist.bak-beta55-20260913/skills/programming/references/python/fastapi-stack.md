# FastAPI + SQLAlchemy 2.x async + Postgres + Pydantic v2

The canonical web API stack. Async end-to-end, type-safe end-to-end, OpenAPI-generated end-to-end.

## Project layout

```
myapi/
├── pyproject.toml
├── alembic.ini
├── migrations/
│   └── env.py
├── src/
│   └── myapi/
│       ├── __init__.py
│       ├── main.py            # FastAPI app + lifespan
│       ├── config.py          # pydantic-settings
│       ├── db.py              # engine, session factory, dependency
│       ├── models.py          # SQLAlchemy declarative models
│       ├── schemas.py         # Pydantic request/response models
│       └── routers/
│           ├── __init__.py
│           └── users.py
└── tests/
    ├── conftest.py
    └── test_users.py
```

## Dependencies

```bash
uv add fastapi 'sqlalchemy[asyncio]>=2.0' asyncpg 'pydantic[email]>=2' pydantic-settings 'uvicorn[standard]' orjson
uv add --dev httpx pytest alembic
```

`orjson` is mandatory: set `default_response_class=ORJSONResponse` on the FastAPI app. Pydantic-typed responses bypass it (Pydantic v2's `model_dump_json` is already Rust-backed); raw `dict` / `list` returns are accelerated. For SSE / NDJSON streams, call `orjson.dumps(...)` per chunk inside `StreamingResponse`. See `orjson-stack.md` for the decision tree, flag reference, and benchmarks.

## Configuration (`config.py`)

```python
from functools import lru_cache

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="MYAPI_")

    database_url: PostgresDsn
    debug: bool = False
    cors_origins: list[str] = Field(default_factory=list)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # pydantic populates from env
```

Wait — that comment violates the no-excuse rule. Use proper field defaults instead. Real version:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="MYAPI_")
    database_url: PostgresDsn
    debug: bool = False
    cors_origins: list[str] = Field(default_factory=list)
```

Construct via `Settings(_env_file=".env")` if needed in tests; in production it reads from env.

## Database (`db.py`)

```python
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from myapi.config import get_settings


def make_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        str(settings.database_url),
        echo=settings.debug,
        pool_pre_ping=True,
    )


_engine = make_engine()
_SessionFactory = async_sessionmaker(_engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with _SessionFactory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
```

`expire_on_commit=False` is essential for FastAPI - otherwise attribute access after commit triggers an implicit refresh and errors out under async.

## Models (`models.py`)

```python
from datetime import datetime, UTC
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    MappedAsDataclass,
    mapped_column,
)


class Base(MappedAsDataclass, DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        init=False,
    )
```

`MappedAsDataclass` makes `User(email=..., name=...)` work as a real dataclass constructor. `init=False` excludes the auto-generated columns (`id`, `created_at`) from `__init__`.

## Schemas (`schemas.py`)

```python
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # SQLAlchemy → Pydantic

    id: int
    email: EmailStr
    name: str
    created_at: datetime
```

Always have a separate `*Create` (input) and `*Read` (output) model. Never expose your ORM model as the API model.

## Routers (`routers/users.py`)

```python
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from myapi.db import SessionDep
from myapi.models import User
from myapi.schemas import UserCreate, UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: SessionDep) -> User:
    user = User(email=payload.email, name=payload.name)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: int, session: SessionDep) -> User:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("", response_model=list[UserRead])
async def list_users(session: SessionDep, limit: int = 100) -> list[User]:
    result = await session.execute(select(User).limit(limit))
    return list(result.scalars().all())
```

## Application (`main.py`)

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI

from myapi.config import get_settings
from myapi.routers import users


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Startup: warm up engine pool, run migrations check, etc.
    yield
    # Shutdown: close engine
    from myapi.db import _engine
    await _engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="My API",
        debug=settings.debug,
        lifespan=lifespan,
    )
    app.include_router(users.router)
    return app


app = create_app()
```

Run with:

```bash
uv run uvicorn myapi.main:app --host 0.0.0.0 --port 8000 --reload
```

## Migrations (Alembic + async)

```bash
uv run alembic init -t async migrations
```

In `migrations/env.py` replace the `target_metadata` line:

```python
from myapi.models import Base
target_metadata = Base.metadata
```

Set `sqlalchemy.url` in `alembic.ini` to your async URL or override via `env.py`:

```python
from myapi.config import get_settings
config.set_main_option("sqlalchemy.url", str(get_settings().database_url))
```

Generate and apply:

```bash
uv run alembic revision --autogenerate -m "create users"
uv run alembic upgrade head
```

## Tests (`tests/test_users.py`)

```python
import pytest
from httpx import ASGITransport, AsyncClient

from myapi.main import app


@pytest.mark.anyio
async def test_create_and_get_user() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        create_response = await client.post(
            "/users",
            json={"email": "alice@example.com", "name": "Alice"},
        )
        assert create_response.status_code == 201
        user_id = create_response.json()["id"]

        get_response = await client.get(f"/users/{user_id}")
        assert get_response.status_code == 200
        assert get_response.json()["email"] == "alice@example.com"
```

For database-backed tests, run a Postgres container in CI (`testcontainers-python` or `docker-compose`) and apply migrations against a test schema. SQLite-as-test-db breaks once you use Postgres-specific types (`JSONB`, `tsvector`, arrays).

## Common pitfalls

| Pitfall | Fix |
|---|---|
| `MissingGreenlet` exception when accessing relationships after commit | `expire_on_commit=False` on the session factory |
| Connection pool exhausted under load | Set `pool_size`, `max_overflow` in `create_async_engine` |
| Pydantic v1 syntax (`from pydantic import ...; class X(BaseModel): class Config: orm_mode = True`) | v2 uses `model_config = ConfigDict(from_attributes=True)` |
| Returning ORM objects without `response_model` | FastAPI serialises with `from_attributes=True` automatically; declare `response_model` so OpenAPI is correct |
| `await session.execute(...)` returning Sequence | Wrap with `list(result.scalars().all())` to satisfy strict types |
| `func.now()` returning naive datetime | Use `DateTime(timezone=True)` and `created_at: Mapped[datetime]` with `UTC`-aware default |

## Sources

- FastAPI: <https://fastapi.tiangolo.com>
- SQLAlchemy 2.x async: <https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html>
- SQLAlchemy MappedAsDataclass: <https://docs.sqlalchemy.org/en/20/orm/dataclasses.html>
- asyncpg: <https://magicstack.github.io/asyncpg/current/>
- Pydantic v2 migration: <https://docs.pydantic.dev/latest/migration/>
- Alembic async: <https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic>
