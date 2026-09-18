# One-Liners and Disposable Scripts

Production hygiene with throwaway ergonomics. Rust scripts get the same strict lints, the same miri rule when `unsafe` is touched, the same type discipline. The difference is dependency declaration lives inline.

## `rust-script` — the recommended path

Install once:

```bash
cargo install rust-script
```

Write a script:

```rust
#!/usr/bin/env rust-script
//! Fetch a URL and print its body length.
//!
//! Usage:
//!   ./fetch.rs <url>
//!
//! ```cargo
//! [dependencies]
//! anyhow = "1"
//! reqwest = { version = "0.12", features = ["blocking"] }
//! ```

use std::env;

fn main() -> anyhow::Result<()> {
    let url = env::args().nth(1).context("usage: fetch.rs <url>")?;
    let body = reqwest::blocking::get(&url)?.error_for_status()?.text()?;
    println!("{} bytes", body.len());
    Ok(())
}
```

Make executable: `chmod +x fetch.rs`. Run: `./fetch.rs https://example.com`.

The `//! \`\`\`cargo` block is parsed as inline `Cargo.toml`. Everything else is normal Rust.

## With async

```rust
#!/usr/bin/env rust-script
//! ```cargo
//! [dependencies]
//! anyhow = "1"
//! tokio = { version = "1", features = ["full"] }
//! reqwest = "0.12"
//! ```

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let urls = [
        "https://example.com",
        "https://example.org",
    ];
    let client = reqwest::Client::new();
    let bodies = futures::future::join_all(urls.iter().map(|u| {
        let c = client.clone();
        async move { c.get(*u).send().await?.text().await }
    })).await;
    for (url, body) in urls.iter().zip(bodies) {
        match body {
            Ok(b) => println!("{url}: {} bytes", b.len()),
            Err(e) => eprintln!("{url}: error {e}"),
        }
    }
    Ok(())
}
```

## With CLI parsing

```rust
#!/usr/bin/env rust-script
//! ```cargo
//! [dependencies]
//! anyhow = "1"
//! clap = { version = "4", features = ["derive"] }
//! ```

use clap::Parser;

#[derive(Parser, Debug)]
#[command(version, about = "rename files by pattern")]
struct Cli {
    /// Glob to match
    pattern: String,
    /// Replacement template (use {n} for sequence)
    template: String,
    /// Show what would happen without doing it
    #[arg(long)]
    dry_run: bool,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let entries: Vec<_> = glob::glob(&cli.pattern)?.collect::<Result<_, _>>()?;
    for (n, entry) in entries.iter().enumerate() {
        let target = cli.template.replace("{n}", &n.to_string());
        if cli.dry_run {
            println!("{} -> {target}", entry.display());
        } else {
            std::fs::rename(entry, &target)?;
        }
    }
    Ok(())
}
```

## Caching

`rust-script` caches the compiled binary in `~/.cache/rust-script/`. First run is slow (full compile), subsequent runs are instant.

To clear: `rust-script --clear-cache`.

Pin a script's compile target into the script directory for portability:

```bash
rust-script --build-only --base-path . ./script.rs
```

This drops a `target/` next to the script with the prebuilt binary.

## `cargo-script` (RFC 3424, stable since Rust 1.85)

The official replacement that landed in cargo proper. Same idea, slightly different syntax:

```rust
#!/usr/bin/env -S cargo +nightly -Zscript
---
package:
  name = "fetch"
  edition = "2024"

dependencies:
  anyhow = "1"
  reqwest = { version = "0.12", features = ["blocking"] }
---

fn main() -> anyhow::Result<()> {
    let url = std::env::args().nth(1).context("url required")?;
    println!("{}", reqwest::blocking::get(&url)?.text()?.len());
    Ok(())
}
```

Status as of 2026-05: stabilization in progress. Use `rust-script` for production now, migrate when `cargo script` is stable everywhere your tools live.

## Strict mode for scripts

Add a lints block in the inline `Cargo.toml`:

```rust
//! ```cargo
//! [dependencies]
//! anyhow = "1"
//!
//! [lints.rust]
//! unsafe_code = "forbid"
//!
//! [lints.clippy]
//! all = "deny"
//! pedantic = "warn"
//! unwrap_used = "deny"
//! expect_used = "deny"
//! panic = "deny"
//! ```
```

Now the script gets the same strictness as the main project. If you need a one-line `unwrap()` for prototype velocity, switch the lint to `warn` for that one script - never blanket `allow`.

Run with lints visible:

```bash
RUSTFLAGS="-D warnings" rust-script ./script.rs
```

## When NOT to use a script

- It is going to live longer than a week → make it a real crate with `cargo new --bin`.
- It needs custom build scripts (`build.rs`) → real crate.
- It needs binary distribution to other machines → real crate with `cargo dist`.
- It needs to be tested → real crate (scripts can technically run `#[test]`s under `cargo test`, but the workflow is awkward).

A reasonable migration path: start as a script, when complexity grows past ~200 lines or you reach for a second `.rs` file, run `rust-script --emit ./script.rs` to dump a regular Cargo project skeleton and continue from there.

## Inline tests in a script

```rust
#!/usr/bin/env rust-script
//! ```cargo
//! [dependencies]
//! ```

fn double(x: i32) -> i32 { x * 2 }

fn main() {
    println!("{}", double(21));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_ints() {
        assert_eq!(double(5), 10);
    }
}
```

Run tests: `rust-script --test ./script.rs`.

## A useful "Rust as awk" pattern

For ad-hoc data processing on stdin:

```rust
#!/usr/bin/env rust-script
//! ```cargo
//! [dependencies]
//! serde_json = "1"
//! ```

use std::io::{self, BufRead, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line?;
        let value: serde_json::Value = serde_json::from_str(&line)?;
        if let Some(s) = value.get("level").and_then(|v| v.as_str()) {
            if s == "error" {
                writeln!(out, "{line}")?;
            }
        }
    }
    Ok(())
}
```

`cat logs.jsonl | ./filter-errors.rs` — filter JSON logs by `level == "error"`. Faster than `jq` for big files, type-safe.

For numerics:

```rust
#!/usr/bin/env rust-script
//! sum a column of numbers from stdin
use std::io::{self, BufRead};
fn main() {
    let total: f64 = io::stdin().lock().lines()
        .filter_map(|l| l.ok())
        .filter_map(|l| l.trim().parse::<f64>().ok())
        .sum();
    println!("{total}");
}
```

## The `rust-script` shebang trick on macOS

macOS does not support multi-arg shebangs without `env -S`. Use:

```rust
#!/usr/bin/env -S rust-script --
```

The `--` lets clap-style argument parsers see the user's args, not the rust-script arguments.

## Editor support

VS Code / Helix / Vim with `rust-analyzer`: open the script file as if it were `src/main.rs` of an inferred crate. Most editors auto-detect the inline manifest. If not, hand-create a `Cargo.toml` next to the script with matching deps for the duration of editing, then delete it.

## When `rust-script` is too heavy

For absolutely throwaway "one expression on stdin" use cases, a Rust REPL like `evcxr_jupyter` (Jupyter kernel) or `irust` (terminal REPL) is more appropriate:

```bash
cargo install irust
irust
```

But these are interactive playgrounds, not scriptable. For shell pipelines, stay with `rust-script`.

## The Promise

Same strict lints. Same `clippy::pedantic` enforcement. Same `unsafe`-requires-SAFETY rule. The agent does not get a free pass on a 30-line script. The whole point of strict scripts is that **production hygiene is cheap when the toolchain enforces it**.
