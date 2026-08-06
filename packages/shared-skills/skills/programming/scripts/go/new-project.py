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
#      uv run new-project.py myservice
#      uv run new-project.py myservice --module github.com/your-org/myservice
# ──────────────────
#
# Creates a new Go project with the canonical strict layout:
#   - go.mod with go 1.23
#   - .golangci.yml (v2, strict bundle)
#   - Taskfile.yml (fmt + lint + test + build)
#   - cmd/server/main.go entrypoint
#   - internal/{cmd,config,api,domain,obs} skeletons
#   - .github/workflows/ci.yml
#
# Templates live in ./templates/ — keep this script under 250 pure LOC.

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from string import Template

import typer
from rich.console import Console

console = Console(stderr=True)

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _render(template_file: str, **subs: str) -> str:
    """Read a template file and apply $placeholder substitutions.

    Uses string.Template ($name) so Go/YAML curly braces stay literal.
    """
    raw = (TEMPLATES_DIR / template_file).read_text()
    if not subs:
        return raw
    return Template(raw).substitute(**subs)


# (template-file → relative output path; is_format = .format() is run)
FILES: list[tuple[str, str, bool]] = [
    (".golangci.yml",   ".golangci.yml",                   False),
    ("Taskfile.yml",    "Taskfile.yml",                    False),
    (".editorconfig",   ".editorconfig",                   False),
    ("gitignore",       ".gitignore",                      False),
    ("ci.yml",          ".github/workflows/ci.yml",        False),
    ("run.go",          "internal/cmd/run.go",             False),
    ("config.go",       "internal/config/config.go",       False),
    ("main.go.tmpl",    "cmd/server/main.go",              True),
    ("AGENTS.md.tmpl",  "AGENTS.md",                       True),
    ("README.md.tmpl",  "README.md",                       True),
]


def _init_go_module(project_dir: Path, module: str) -> None:
    try:
        subprocess.run(
            ["go", "mod", "init", module],
            cwd=project_dir,
            check=True,
            capture_output=True,
        )
        console.print(f"  [dim]ran[/] go mod init {module}")
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        console.print(f"  [yellow]warn[/] go mod init failed ({e}); writing fallback go.mod")
        (project_dir / "go.mod").write_text(f"module {module}\n\ngo 1.23\n")


def _create_layout(project_dir: Path) -> None:
    """Create the canonical internal/ tree."""
    subdirs = [
        "cmd/server",
        "internal/cmd",
        "internal/config",
        "internal/api",
        "internal/domain",
        "internal/obs",
        ".github/workflows",
    ]
    for sd in subdirs:
        (project_dir / sd).mkdir(parents=True)


def _write_files(project_dir: Path, name: str, module: str, purpose: str) -> None:
    """Render every template into the project tree."""
    for tmpl_name, out_rel, is_format in FILES:
        subs = (
            {"name": name, "module": module, "short_purpose": purpose}
            if is_format
            else {}
        )
        content = _render(tmpl_name, **subs)
        out_path = project_dir / out_rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(content)
        console.print(f"  [dim]wrote[/] {out_rel}")


def main(
    name: str,
    path: str = typer.Option(".", help="Parent dir"),
    module: str = typer.Option("", help="Go module path; default: <name>"),
    purpose: str = typer.Option("HTTP", help="Short purpose for AGENTS.md"),
) -> None:
    """Scaffold a new Go project with the strict toolchain."""
    project_dir = Path(path) / name
    if project_dir.exists():
        console.print(f"[red]✗[/red] {project_dir} already exists")
        sys.exit(1)

    module_path = module or name

    project_dir.mkdir(parents=True)
    _create_layout(project_dir)
    _init_go_module(project_dir, module_path)
    _write_files(project_dir, name, module_path, purpose)

    console.print(f"\n[bold green]Done![/] cd {project_dir}")
    console.print("  go get github.com/caarlos0/env/v11")
    console.print("  task        # fmt + lint + test")


if __name__ == "__main__":
    typer.run(main)
