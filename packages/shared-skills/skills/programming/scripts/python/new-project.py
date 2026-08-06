#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "typer",
#     "rich",
# ]
# ///

# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run:
#      uv run new-project.py myproject
#      uv run new-project.py myproject --path ./workspace
#      uv run new-project.py myproject --lib   # library (publishable)
# ──────────────────

"""Scaffold a new Python project with ultra-strict config from pyproject-strict.md.

Creates via `uv init`, then injects basedpyright + ruff ALL + pytest config.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import typer
from rich import print as rprint

# ── Strict tool config (from pyproject-strict.md) ──

TOOL_CONFIG = '''
[dependency-groups]
dev = [
    "basedpyright>=1.21",
    "ruff>=0.8",
    "pytest>=8",
    "pytest-cov>=5",
]

[tool.basedpyright]
typeCheckingMode = "all"
pythonVersion = "3.13"
reportMissingTypeStubs = false
reportUnknownMemberType = false
reportUnknownArgumentType = false
reportUnknownVariableType = false
reportUnknownLambdaType = false
reportUnknownParameterType = false
reportMissingParameterType = false
reportUnnecessaryIsInstance = false
reportUnusedCallResult = false
reportImplicitOverride = false

[tool.ruff]
target-version = "py313"
line-length = 120

[tool.ruff.lint]
select = ["ALL"]
ignore = [
    "COM812",   # trailing comma (conflicts with formatter)
    "ISC001",   # single-line string concat (conflicts with formatter)
    "D1",       # undocumented-public-* (too noisy early on)
    "ANN101",   # deprecated: self annotation
    "ANN102",   # deprecated: cls annotation
    "S101",     # assert used (pytest needs it)
    "PLR2004",  # magic-value-comparison (test data)
    "FBT",      # boolean-trap (too strict for CLIs)
    "TD",       # flake8-todos (noisy)
    "FIX",      # fixme (noisy)
]

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["S101", "PLR2004", "SLF001", "D", "ARG", "ANN"]

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers --strict-config"
'''

GITIGNORE = """\
__pycache__/
*.py[cod]
*.so
.venv/
dist/
*.egg-info/
.coverage
htmlcov/
.basedpyright/
.ruff_cache/
"""


def main(
    name: str = typer.Argument(help="Project name"),
    path: Path = typer.Option(Path("."), "--path", "-p", help="Parent directory"),
    lib: bool = typer.Option(False, "--lib", help="Create as publishable library (uv init --lib)"),
) -> None:
    """Create a new Python project with ultra-strict config."""
    project_dir = path / name

    if project_dir.exists():
        rprint(f"[red]Error:[/red] {project_dir} already exists")
        raise SystemExit(1)

    # Run uv init
    cmd = ["uv", "init", "--lib" if lib else "--app", str(project_dir)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        rprint(f"[red]uv init failed:[/red] {result.stderr}")
        raise SystemExit(1)

    # Read existing pyproject.toml
    pyproject_path = project_dir / "pyproject.toml"
    content = pyproject_path.read_text()

    # Remove the default [dependency-groups] if uv init created one
    # (we'll replace it with our strict version)
    lines = content.splitlines(keepends=True)
    filtered: list[str] = []
    skip = False
    for line in lines:
        if line.strip().startswith("[dependency-groups]"):
            skip = True
            continue
        if skip and line.strip().startswith("["):
            skip = False
        if not skip:
            filtered.append(line)

    content = "".join(filtered).rstrip("\n") + "\n"

    # Append strict tool config
    content += TOOL_CONFIG

    pyproject_path.write_text(content)

    # Add dev dependencies
    subprocess.run(
        ["uv", "add", "--dev", "basedpyright", "ruff", "pytest", "pytest-cov"],
        cwd=project_dir,
        capture_output=True,
    )

    # Create tests directory
    tests_dir = project_dir / "tests"
    tests_dir.mkdir(exist_ok=True)
    (tests_dir / "__init__.py").touch()

    # Overwrite .gitignore
    (project_dir / ".gitignore").write_text(GITIGNORE)

    # Create py.typed marker for libraries
    if lib:
        src_dir = project_dir / "src" / name.replace("-", "_")
        if src_dir.exists():
            (src_dir / "py.typed").touch()

    rprint(f"[green]✓[/green] Created: [bold]{project_dir}[/bold]")
    rprint(f"  cd {name} && uv sync && uv run basedpyright . && uv run ruff check .")


if __name__ == "__main__":
    typer.run(main)
