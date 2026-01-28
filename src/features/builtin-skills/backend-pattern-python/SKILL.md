---
name: backend-pattern-python
description: Python backend patterns (FastAPI, Django)
triggers:
  - python backend
  - fastapi
  - django
---

# Python Backend Patterns

## Patterns
- **Type Hints with Pydantic**: Use Pydantic models for request/response validation and serialization. Leverage Python 3.10+ type hinting features.
- **Async/Await Patterns**: Use `async` and `await` for I/O-bound operations in FastAPI. Be careful not to block the event loop with synchronous calls.
- **Dependency Injection**: Leverage FastAPI's dependency injection system for managing database sessions, authentication, and external services.
- **Testing with Pytest**: Use `pytest` for unit and integration testing. Utilize fixtures for setup/teardown and `pytest-asyncio` for async tests.
- **Project Structure**: Follow a modular structure. For FastAPI, use `routers/`, `schemas/`, `models/`, and `services/`. For Django, stick to the app-based structure but keep logic in services.
- **Environment Management**: Use `python-dotenv` or Pydantic's `BaseSettings` for configuration management via environment variables.
