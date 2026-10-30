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
# ──────────────────
#
# Creates a new Rust project with strict lints, deny.toml, rustfmt.toml, and
# rust-toolchain.toml pre-configured. The generated project passes its own
# fmt + clippy gate before any code is written.

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import typer
from rich.console import Console

console = Console(stderr=True)

# ── Embedded config contents ─────────────────────────────────────────────

RUST_TOOLCHAIN_TOML = """\
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy", "rust-src"]
profile = "default"
"""

CARGO_TOML_LINTS = """
[lints.rust]
unsafe_op_in_unsafe_fn = "deny"
missing_docs = "warn"
missing_debug_implementations = "warn"
unreachable_pub = "warn"
unused_must_use = "deny"
elided_lifetimes_in_paths = "warn"
non_ascii_idents = "deny"
trivial_numeric_casts = "warn"
unused_lifetimes = "warn"
single_use_lifetimes = "warn"
unexpected_cfgs = { level = "deny", check-cfg = ["cfg(loom)"] }

[lints.clippy]
all = { level = "deny", priority = -1 }
pedantic = { level = "warn", priority = -1 }
nursery = { level = "warn", priority = -1 }
cargo = { level = "warn", priority = -1 }
undocumented_unsafe_blocks = "deny"
multiple_unsafe_ops_per_block = "deny"
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
print_stdout = "warn"
print_stderr = "warn"
allow_attributes = "deny"
allow_attributes_without_reason = "deny"
let_underscore_must_use = "deny"
indexing_slicing = "deny"
mem_forget = "deny"
clone_on_ref_ptr = "warn"
module_name_repetitions = { level = "allow" }
must_use_candidate = { level = "allow" }
"""

DENY_TOML = """\
[advisories]
yanked = "deny"

[licenses]
private = { ignore = true }  # publish = false crates carry no license field
allow = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unicode-3.0", "Zlib"]

[bans]
multiple-versions = "warn"
wildcards = "deny"

[sources]
unknown-registry = "deny"
unknown-git = "deny"
"""

MAIN_RS = """\
//! Command-line entry point.

use std::io::Write as _;

fn main() -> std::io::Result<()> {
    writeln!(std::io::stdout().lock(), "Hello, world!")
}
"""

RUSTFMT_TOML = """\
edition = "2024"
max_width = 100
use_field_init_shorthand = true
use_try_shorthand = true
"""

# ── Main ─────────────────────────────────────────────────────────────────

app = typer.Typer(add_completion=False)


@app.command()
def main(
    name: str = typer.Argument(help="Name of the new Rust project"),
    path: Path = typer.Option(
        Path.cwd(),
        "--path",
        "-p",
        help="Parent directory where the project folder is created",
    ),
) -> None:
    """Scaffold a new Rust project with strict lints and tooling configs."""
    project_dir = path / name

    # ── cargo init ───────────────────────────────────────────────────
    console.print(f"[bold green]Creating[/] project [cyan]{name}[/] at [dim]{project_dir}[/]")
    try:
        subprocess.run(
            ["cargo", "init", str(project_dir), "--name", name],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        console.print("[bold red]Error:[/] cargo not found. Install Rust via https://rustup.rs")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        console.print(f"[bold red]cargo init failed:[/]\n{exc.stderr}")
        sys.exit(1)

    # ── rust-toolchain.toml ──────────────────────────────────────────
    (project_dir / "rust-toolchain.toml").write_text(RUST_TOOLCHAIN_TOML)
    console.print("  [dim]wrote[/] rust-toolchain.toml")

    # ── Declare the MSRV and append [lints] to Cargo.toml ────────────
    cargo_toml = project_dir / "Cargo.toml"
    manifest = cargo_toml.read_text()
    if 'edition = "2024"\n' not in manifest:
        console.print("[bold red]Error:[/] cargo did not create an edition 2024 package; install Rust >= 1.85")
        sys.exit(1)
    manifest = manifest.replace(
        'edition = "2024"\n', 'edition = "2024"\nrust-version = "1.85"\npublish = false\n', 1
    )
    cargo_toml.write_text(manifest + CARGO_TOML_LINTS)
    (project_dir / "src" / "main.rs").write_text(MAIN_RS)
    console.print("  [dim]appended[/] [lints] to Cargo.toml")

    # ── deny.toml ────────────────────────────────────────────────────
    (project_dir / "deny.toml").write_text(DENY_TOML)
    console.print("  [dim]wrote[/] deny.toml")

    # ── rustfmt.toml ─────────────────────────────────────────────────
    (project_dir / "rustfmt.toml").write_text(RUSTFMT_TOML)
    console.print("  [dim]wrote[/] rustfmt.toml")

    console.print(f"\n[bold green]Done![/] cd {project_dir} && cargo check")


if __name__ == "__main__":
    app()
