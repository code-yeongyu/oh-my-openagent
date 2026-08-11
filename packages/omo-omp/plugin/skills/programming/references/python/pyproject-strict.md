# Strict pyproject.toml (basedpyright + ruff + uv)

The canonical "super strict but sane" config for modern Python projects. Copy-paste, then add your own dependencies.

## Bootstrap

```bash
# Application
uv init --app myproject
cd myproject

# Library (publishable to PyPI)
uv init --lib mylibrary
cd mylibrary

# Add dev tools
uv add --dev basedpyright ruff pytest
```

`uv init` creates `pyproject.toml`, `.python-version`, and `src/` layout. Replace its `pyproject.toml` `[tool.*]` sections with the block below.

## The full pyproject.toml

```toml
[project]
name = "myproject"
version = "0.1.0"
description = "..."
readme = "README.md"
requires-python = ">=3.13"
dependencies = []

[dependency-groups]
dev = [
    "basedpyright>=1.21",
    "ruff>=0.8",
    "pytest>=8",
    "pytest-cov>=5",
]

# ─────────────────────────────────────────────────────────────────
# basedpyright - typeCheckingMode = "all" sets every report flag to error
# Source: https://docs.basedpyright.com/latest/configuration/config-files/
# ─────────────────────────────────────────────────────────────────
[tool.basedpyright]
typeCheckingMode = "all"
pythonVersion = "3.13"
pythonPlatform = "All"          # default in basedpyright; explicit for clarity
include = ["src", "tests"]
exclude = ["**/__pycache__", "**/.venv", "**/build", "**/dist"]

# Strict enforcement extras (most are already "error" under "all" mode,
# but listing them explicitly documents the intent)
reportUnusedCallResult = "warning"       # flag ignored return values
reportUnnecessaryTypeIgnoreComment = "error"  # stale type: ignore comments must die
reportUnusedVariable = "error"           # unused variables are errors
reportMissingParameterType = "error"     # every parameter must have a type
reportMissingReturnType = "error"        # every function must declare its return type
reportPrivateUsage = "error"             # respect _private convention

# Optional: gradual adoption baseline
# baselineFile = "./.basedpyright/baseline.json"

# ─────────────────────────────────────────────────────────────────
# ruff - select = ["ALL"] enables every rule, then we ignore the
# small set that conflicts with the formatter or is not useful.
# Source: https://docs.astral.sh/ruff/linter/#rule-selection
# ─────────────────────────────────────────────────────────────────
[tool.ruff]
target-version = "py313"
line-length = 88                # ruff/black default; 100 or 120 also fine
src = ["src", "tests"]

[tool.ruff.lint]
select = ["ALL"]
ignore = [
    # Formatter conflicts (ruff itself tells you to ignore these)
    "COM812",   # missing trailing comma
    "ISC001",   # implicit string concat
    # Docstyle conflicts (pick D211 over D203, D212 over D213)
    "D203",
    "D213",
    # Project-specific noise
    "CPY001",   # missing copyright notice
    "FBT001",   # boolean positional arg in def
    "FBT002",   # boolean positional default in def
    "TD002",    # missing TODO author
    "TD003",    # missing TODO link
    "FIX002",   # line contains TODO (TODOs are allowed)
]
fixable = ["ALL"]
unfixable = []

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = [
    "S101",     # `assert` is the entire point of pytest
    "ARG",      # unused args (fixtures appear unused)
    "PLR2004",  # magic numbers in test data
    "SLF001",   # tests need access to private members
    "D",        # docstrings not required in tests
]
"scripts/**/*.py" = [
    "T201",     # `print` allowed in scripts
    "INP001",   # implicit namespace package
]

[tool.ruff.lint.pydocstyle]
convention = "google"  # or "numpy" / "pep257"

[tool.ruff.lint.flake8-bugbear]
# typer / fastapi rely on call-as-default for parameter metadata.
# Without this, ruff B008 ("function call in default") fires on every typer/fastapi route.
extend-immutable-calls = [
    "typer.Argument",
    "typer.Option",
    "fastapi.Depends",
    "fastapi.Query",
    "fastapi.Path",
    "fastapi.Body",
    "fastapi.Header",
    "fastapi.Cookie",
    "fastapi.File",
    "fastapi.Form",
]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
docstring-code-format = true
docstring-code-line-length = "dynamic"

# ─────────────────────────────────────────────────────────────────
# pytest
# ─────────────────────────────────────────────────────────────────
[tool.pytest.ini_options]
minversion = "8.0"
testpaths = ["tests"]
addopts = [
    "-ra",
    "--strict-config",
    "--strict-markers",
]
filterwarnings = ["error"]

# ─────────────────────────────────────────────────────────────────
# coverage
# ─────────────────────────────────────────────────────────────────
[tool.coverage.run]
source = ["src"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if typing.TYPE_CHECKING:",
    "raise NotImplementedError",
    "@(abc\\.)?abstractmethod",
]
```

## Why these settings

### basedpyright `typeCheckingMode = "all"`

basedpyright's modes, strictest first:

| Mode | Behavior |
|---|---|
| `"all"` | Every diagnostic at `error` |
| `"recommended"` | Same rules; less severe ones at `warning`; `failOnWarnings = true` makes CI still fail |
| `"strict"` | pyright's strict mode |
| `"standard"` | Default |
| `"basic"` / `"off"` | Loose / disabled |

`"all"` enables basedpyright-exclusive rules pyright lacks: `reportImplicitOverride`, `reportImplicitStringConcatenation`, `reportIncompatibleUnannotatedOverride`, `reportUnannotatedClassAttribute`. No need to opt-in to additional flags.

`pythonPlatform = "All"` is basedpyright's default (better than pyright's host-OS default) - it errors on platform-specific imports that fail on other OSes.

### ruff `select = ["ALL"]`

The official docs say *"Use ALL with discretion. Enabling ALL will implicitly enable new rules whenever you upgrade."* For a strict skill that is the intended behavior - every new ruff rule should be considered an error until you justify ignoring it.

The minimal ignore set:

| Rule | Reason |
|---|---|
| `COM812`, `ISC001` | Conflict with `ruff format` (ruff itself documents this) |
| `D203` vs `D211`, `D213` vs `D212` | Mutually-exclusive docstring conventions; pick the modern one |
| `CPY001` | Most projects don't need a copyright header on every file |
| `FBT001`, `FBT002` | Boolean flags are ergonomic for CLI/typer; ban makes typer awkward |
| `TD002`, `TD003`, `FIX002` | TODOs without a JIRA link are fine in solo / internal code |

`ANN101` and `ANN102` were **removed in ruff 0.8.0** (Nov 2024). Do NOT include them in `ignore` - ruff errors on unknown rule codes.

`per-file-ignores` for `tests/**` is the standard pattern from real-world repos like `community-of-python/auto-typing-final` and `Preston-Landers/concurrent-log-handler`.

## CI gate

```bash
# In CI, fail on any violation:
uv run basedpyright
uv run ruff check
uv run ruff format --check
uv run pytest
```

A single `make ci` target combining the four works fine.

## Enforcement summary

The config above, combined with `scripts/check-no-excuse-rules.py`, enforces:

| What | How |
|---|---|
| Exhaustive match | basedpyright `all` mode + `assert_never` |
| No `Any` | basedpyright `all` mode + script `cast-any` rule |
| Ignored return values | `reportUnusedCallResult = "warning"` |
| Immutable default | Script `mutable-dataclass` + `missing-slots` rules |
| No null surprise | basedpyright strict `None` analysis |
| Constants are const | basedpyright catches `Final` reassignment |
| Unused variables | `reportUnusedVariable = "error"` |

## Sources

- basedpyright modes: <https://docs.basedpyright.com/latest/configuration/config-files/#type-check-diagnostics-settings>
- basedpyright `"all"` vs `"recommended"`: <https://docs.basedpyright.com/latest/configuration/config-files/#recommended-and-all>
- basedpyright better defaults: <https://docs.basedpyright.com/latest/benefits-over-pyright/better-defaults/>
- ruff rule selection: <https://docs.astral.sh/ruff/linter/#rule-selection>
- ruff ANN101/ANN102 removed: <https://github.com/astral-sh/ruff/pull/14384>
- Real-world ALL config: <https://github.com/community-of-python/auto-typing-final/blob/main/pyproject.toml>
- PEP 735 dependency-groups: <https://peps.python.org/pep-0735/>
