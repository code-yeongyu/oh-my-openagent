# One-liner Scripts (PEP 723 + uv)

Self-contained Python scripts with declared dependencies, run with no environment setup. The combination eliminates the historical reason to write small tools in Go or Bash.

**Rule: EVERY `.py` script — even throwaway — MUST use PEP 723 inline metadata with the usage comment block.** No venv, no requirements.txt, no setup.py. The script IS the environment spec.

## The two patterns

### Pattern 1: inline `uv run` invocation

```bash
uv run --with httpx2 --with rich python -c "
import httpx2
from rich import print
print(httpx2.get('https://api.github.com').json())
"
```

Use for terminal one-shots that you don't want to save. `--with PKG` may be repeated.

### Pattern 2: PEP 723 script with shebang (THE CANONICAL PATTERN)

A regular `.py` file with metadata in a comment block. uv reads the metadata, materialises a disposable venv (cached), and runs the script.

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "httpx2[http2,brotli,zstd]",
#     "rich",
# ]
# ///

# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run directly (no venv, no pip install needed):
#      uv run my_script.py
# 3. Or make executable and run:
#      chmod +x my_script.py && ./my_script.py
# ──────────────────

from __future__ import annotations

import httpx2
from rich import print as rprint


def main() -> None:
    with httpx2.Client(http2=True, follow_redirects=True) as client:
        resp = client.get("https://api.github.com")
        resp.raise_for_status()
        rprint(resp.json())


if __name__ == "__main__":
    main()
```

### Mandatory elements

Every PEP 723 script MUST include these, in order:

1. **Shebang**: `#!/usr/bin/env -S uv run --script`
2. **PEP 723 metadata block**: `# /// script` ... `# ///` with `requires-python` and `dependencies`
3. **Usage comment block**: How to install uv + how to run the script. Copy the template above verbatim.
4. **`from __future__ import annotations`**: Always first import.
5. **`if __name__ == "__main__": main()`**: Entry point guard.

### The usage comment block (NON-NEGOTIABLE)

```python
# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run directly (no venv, no pip install needed):
#      uv run <SCRIPT_NAME>.py [ARGS]
# 3. Or make executable and run:
#      chmod +x <SCRIPT_NAME>.py && ./<SCRIPT_NAME>.py
# ──────────────────
```

Replace `<SCRIPT_NAME>` with the actual filename. Add argument descriptions if the script takes CLI args. This block goes immediately after the `# ///` closing line, before any imports.

**Why mandatory**: Anyone who receives this script — colleague, CI, future you — must know how to run it without reading docs. The comment IS the docs.

## Template generator

Use `scripts/new-script.py` to scaffold a new PEP 723 script with all boilerplate pre-filled:

```bash
# Generate to temp directory (default)
uv run scripts/new-script.py my_tool

# Generate to specific path
uv run scripts/new-script.py my_tool --output ./scripts/my_tool.py

# With extra dependencies
uv run scripts/new-script.py my_tool --deps "polars" "duckdb" "rich"
```

## Common dependency sets

| Use case | Dependencies line |
|---|---|
| API client | `"httpx2[http2,brotli,zstd]"` |
| Data processing | `"polars"`, `"duckdb"` |
| CLI tool | `"typer"`, `"rich"` |
| Web scraping | `"httpx2[http2,brotli,zstd]"`, `"selectolax"` |
| File watcher | `"watchfiles"` |
| JSON pretty | `"rich"` |
| AI / LLM | `"pydantic-ai"`, `"httpx2[http2,brotli,zstd]"` |

## Real-world examples

### Fetch + print JSON

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "httpx2[http2,brotli,zstd]",
#     "rich",
# ]
# ///

# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run: uv run fetch_json.py https://api.github.com/repos/pydantic/httpx2
# ──────────────────

from __future__ import annotations

import sys

import httpx2
from rich import print as rprint


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://api.github.com"
    with httpx2.Client(http2=True, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        rprint(resp.json())


if __name__ == "__main__":
    main()
```

### CSV → Parquet conversion

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "polars",
#     "typer",
#     "rich",
# ]
# ///

# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run: uv run csv2parquet.py input.csv output.parquet
# ──────────────────

from __future__ import annotations

from pathlib import Path

import polars as pl
import typer
from rich import print as rprint


def main(input_path: Path, output_path: Path | None = None) -> None:
    """Convert CSV to Parquet."""
    out = output_path or input_path.with_suffix(".parquet")
    df = pl.read_csv(input_path)
    df.write_parquet(out)
    rprint(f"[green]✓[/green] {input_path} → {out} ({len(df)} rows)")


if __name__ == "__main__":
    typer.run(main)
```

### Quick benchmark

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "httpx2[http2,brotli,zstd]",
#     "rich",
#     "anyio",
# ]
# ///

# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run: uv run bench.py https://api.example.com/health 50
# ──────────────────

from __future__ import annotations

import socket
import sys
import time

import anyio
import httpx2
from rich import print as rprint


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://api.github.com"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    limits = httpx2.Limits(max_connections=200, max_keepalive_connections=40, keepalive_expiry=30.0)
    timeout = httpx2.Timeout(connect=5.0, read=30.0, write=10.0, pool=10.0)
    transport = httpx2.AsyncHTTPTransport(
        http2=True, retries=3, limits=limits,
        socket_options=[(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)],
    )

    async with httpx2.AsyncClient(transport=transport, timeout=timeout, follow_redirects=True) as client:
        # warmup
        for _ in range(3):
            await client.get(url)

        start = time.perf_counter()
        for _ in range(n):
            r = await client.get(url)
            assert r.status_code == 200
        elapsed = time.perf_counter() - start

    avg_ms = (elapsed / n) * 1000
    rprint(f"[bold]{url}[/bold]: {avg_ms:.1f}ms avg over {n} requests ({elapsed:.2f}s total, {r.http_version})")


if __name__ == "__main__":
    anyio.run(main)
```

## Anti-patterns

| ❌ Don't | ✅ Do |
|---|---|
| `pip install httpx2 && python script.py` | `uv run script.py` |
| `requirements.txt` alongside script | PEP 723 inline metadata |
| `python -m venv .venv && ...` | `uv run --script` handles it |
| Script without usage comment | Always include the "How to run" block |
| `import asyncio; asyncio.run(main())` | `import anyio; anyio.run(main)` |
| Bare `httpx2.AsyncClient()` | Full production defaults (see `references/httpx2-optimization.md`) |

## Sources

- PEP 723 - Inline script metadata: <https://peps.python.org/pep-0723/>
- uv `run --script` docs: <https://docs.astral.sh/uv/guides/scripts/>
- Original article: <https://www.cottongeeks.com/articles/2025-06-24-fun-with-uv-and-pep-723>
- Simon Willison on one-shot Python tools: <https://simonwillison.net/2024/Dec/19/one-shot-python-tools/>
