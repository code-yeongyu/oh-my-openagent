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
#      uv run new-script.py my_tool
#      uv run new-script.py my_tool --output ./scripts/my_tool.py
#      uv run new-script.py my_tool --deps 'httpx2[http2,brotli,zstd]' --deps rich --deps polars
#      uv run new-script.py my_tool --py 3.13
# ──────────────────

"""Generate a PEP 723 Python script with all boilerplate pre-filled.

Creates a new .py file with:
  - uv shebang
  - PEP 723 inline metadata (requires-python + dependencies)
  - Mandatory "How to run" comment block
  - from __future__ import annotations
  - main() + if __name__ guard

By default writes to a temp directory and prints the path.
"""

from __future__ import annotations

import os
import stat
import sys
import tempfile
from pathlib import Path

import typer
from rich import print as rprint


TEMPLATE = '''\
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">={python_version}"
# dependencies = [
{deps_block}# ]
# ///

# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run directly (no venv, no pip install needed):
#      uv run {filename} {args_hint}
# 3. Or make executable and run:
#      chmod +x {filename} && ./{filename}
# ──────────────────

from __future__ import annotations


def main() -> None:
    """TODO: implement."""


if __name__ == "__main__":
    main()
'''


def main(
    name: str = typer.Argument(help="Script name (without .py extension)"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output path. Default: OS temp directory."),
    deps: list[str] = typer.Option([], "--deps", "-d", help="Dependencies to include (repeat --deps for each)."),
    py: str = typer.Option("3.13", "--py", help="Minimum Python version."),
) -> None:
    """Generate a new PEP 723 script with all boilerplate pre-filled."""
    filename = f"{name}.py" if not name.endswith(".py") else name
    stem = filename.removesuffix(".py")

    if output is not None:
        dest = Path(output)
    else:
        tmp_dir = Path(tempfile.gettempdir()) / "uv-scripts"
        tmp_dir.mkdir(exist_ok=True)
        dest = tmp_dir / filename

    dep_list = deps or []
    if dep_list:
        deps_block = "".join(f'#     "{d}",\n' for d in dep_list)
    else:
        deps_block = '#     # add deps here, e.g.: "httpx2[http2,brotli,zstd]"\n'

    content = TEMPLATE.format(
        python_version=py,
        deps_block=deps_block,
        filename=filename,
        args_hint="",
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content)

    # Make executable on Unix
    if sys.platform != "win32":
        st = dest.stat()
        dest.chmod(st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    rprint(f"[green]✓[/green] Created: [bold]{dest}[/bold]")
    rprint(f"  Run: [cyan]uv run {dest}[/cyan]")


if __name__ == "__main__":
    typer.run(main)
