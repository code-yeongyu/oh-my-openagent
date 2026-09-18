# CLI Stack — clap + color-eyre + tracing + indicatif + dialoguer

The default for any new CLI tool. Strict typing on arguments, beautiful errors, progress feedback, interactive prompts when needed.

## Cargo.toml

```toml
[package]
name = "mytool"
version = "0.1.0"
edition = "2024"

[dependencies]
clap = { version = "4", features = ["derive", "env", "wrap_help", "color", "unicode"] }
clap_complete = "4"
color-eyre = "0.6"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }
anyhow = "1"
indicatif = { version = "0.17", features = ["tokio"] }
dialoguer = { version = "0.11", features = ["fuzzy-select"] }
console = "0.15"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "fs", "process", "signal"] }

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
strip = "symbols"
panic = "abort"
```

## Command structure

```rust
// src/cli.rs
use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "mytool",
    author,
    version,
    about = "A short description",
    long_about = "A longer description that appears in --help",
    arg_required_else_help = true,
)]
pub struct Cli {
    /// Configuration file path
    #[arg(short, long, env = "MYTOOL_CONFIG", default_value = "config.toml", global = true)]
    pub config: PathBuf,

    /// Increase verbosity (-v info, -vv debug, -vvv trace)
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,

    /// Suppress all non-error output
    #[arg(short, long, global = true, conflicts_with = "verbose")]
    pub quiet: bool,

    /// Force colored output even when stdout is not a terminal
    #[arg(long, global = true, value_enum, default_value_t = ColorChoice::Auto)]
    pub color: ColorChoice,

    /// Output format
    #[arg(short, long, global = true, value_enum, default_value_t = OutputFormat::Pretty)]
    pub format: OutputFormat,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, ValueEnum)]
pub enum ColorChoice { Auto, Always, Never }

#[derive(Debug, Clone, ValueEnum)]
pub enum OutputFormat { Pretty, Json, Plain }

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Build the thing
    Build(BuildArgs),
    /// Watch and rebuild
    Watch(WatchArgs),
    /// Generate shell completions
    Completions { #[arg(value_enum)] shell: clap_complete::Shell },
}

#[derive(Debug, clap::Args)]
pub struct BuildArgs {
    /// Target directory
    #[arg(short, long, default_value = "target")]
    pub target: PathBuf,
    /// Build mode
    #[arg(short, long, value_enum, default_value_t = Mode::Release)]
    pub mode: Mode,
    /// Specific files to build (default: all)
    pub files: Vec<PathBuf>,
}

#[derive(Debug, clap::Args)]
pub struct WatchArgs {
    /// Glob pattern to watch
    #[arg(short, long, default_value = "**/*.rs")]
    pub pattern: String,
}

#[derive(Debug, Clone, ValueEnum)]
pub enum Mode { Debug, Release }
```

Key clap derive patterns:

- `env = "VAR"` — falls back to env var if flag not given.
- `global = true` — flag inherits to subcommands.
- `arg_required_else_help = true` — running with no args prints help instead of erroring.
- `value_enum` on an enum — case-insensitive parsing + auto-completion.
- `action = clap::ArgAction::Count` — `-v` is 1, `-vv` is 2, etc.
- `conflicts_with` — incompatible flags.

## Main + tracing init

```rust
// src/main.rs
use clap::Parser;
use mytool::cli::{Cli, Command, ColorChoice};
use tracing::Level;
use tracing_subscriber::EnvFilter;

fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;
    let cli = Cli::parse();
    init_tracing(&cli);

    if matches!(cli.color, ColorChoice::Always) {
        console::set_colors_enabled(true);
    } else if matches!(cli.color, ColorChoice::Never) {
        console::set_colors_enabled(false);
    }

    match cli.command {
        Command::Build(args) => mytool::commands::build::run(&cli, args),
        Command::Watch(args) => mytool::commands::watch::run(&cli, args),
        Command::Completions { shell } => {
            let mut cmd = <Cli as clap::CommandFactory>::command();
            clap_complete::generate(shell, &mut cmd, "mytool", &mut std::io::stdout());
            Ok(())
        }
    }
}

fn init_tracing(cli: &Cli) {
    let level = if cli.quiet {
        Level::ERROR
    } else {
        match cli.verbose {
            0 => Level::WARN,
            1 => Level::INFO,
            2 => Level::DEBUG,
            _ => Level::TRACE,
        }
    };
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("mytool={level}")));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .without_time()
        .compact()
        .with_writer(std::io::stderr)
        .init();
}
```

Tracing on a CLI:
- **Write to stderr.** stdout is for the tool's actual output (which the user might pipe). Logs and progress bars go to stderr.
- **Verbosity from `-v`, not from `RUST_LOG`.** Users expect `-v` on a CLI; `RUST_LOG` is a developer escape hatch (kept, but secondary).

## Progress bars — `indicatif`

```rust
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::time::Duration;

let mp = MultiProgress::new();
let pb = mp.add(ProgressBar::new(files.len() as u64));
pb.set_style(
    ProgressStyle::with_template(
        "{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} ({eta}) {msg}"
    )?
    .progress_chars("=>-")
);

for file in files {
    pb.set_message(file.display().to_string());
    process(&file)?;
    pb.inc(1);
}
pb.finish_with_message("done");
```

For unbounded operations:

```rust
let spinner = ProgressBar::new_spinner();
spinner.enable_steady_tick(Duration::from_millis(80));
spinner.set_message("connecting…");
let result = connect().await?;
spinner.finish_and_clear();
```

With multiple parallel tasks:

```rust
let mp = MultiProgress::new();
let bars: Vec<_> = (0..workers).map(|i| {
    let pb = mp.add(ProgressBar::new(unit));
    pb.set_style(ProgressStyle::with_template("worker {prefix}: {pos}/{len}")?);
    pb.set_prefix(i.to_string());
    pb
}).collect();
```

`MultiProgress` keeps bars stacked and redraws cleanly even with concurrent updates from multiple tasks.

When stdout is not a terminal, indicatif silently disables animation. Force on/off with `pb.set_draw_target(ProgressDrawTarget::stdout())` / `hidden()`.

## Interactive prompts — `dialoguer`

```rust
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Password, Select, FuzzySelect, MultiSelect};

let name: String = Input::with_theme(&ColorfulTheme::default())
    .with_prompt("Project name")
    .validate_with(|input: &String| -> Result<(), &str> {
        if input.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            Ok(())
        } else {
            Err("alphanumeric, dash, underscore only")
        }
    })
    .interact_text()?;

let secret = Password::with_theme(&ColorfulTheme::default())
    .with_prompt("API key")
    .with_confirmation("Repeat", "passwords don't match")
    .interact()?;

let go: bool = Confirm::with_theme(&ColorfulTheme::default())
    .with_prompt(format!("Delete {}? This cannot be undone.", path.display()))
    .default(false)
    .interact()?;
if !go { return Ok(()); }

let items = ["yes", "no", "maybe"];
let idx = Select::with_theme(&ColorfulTheme::default())
    .with_prompt("Pick one")
    .items(&items)
    .default(0)
    .interact()?;

let picks = MultiSelect::with_theme(&ColorfulTheme::default())
    .with_prompt("Toggle features")
    .items(&["alpha", "beta", "gamma"])
    .defaults(&[true, false, false])
    .interact()?;
```

Detect non-TTY before prompting:

```rust
if !console::user_attended() {
    return Err(anyhow::anyhow!("input required but stdin is not a terminal"));
}
```

For automated tests, expose a `--non-interactive` flag and gate all prompts behind it.

## Structured output

```rust
match cli.format {
    OutputFormat::Json => {
        serde_json::to_writer(std::io::stdout().lock(), &result)?;
        println!();
    }
    OutputFormat::Plain => {
        for row in &result.rows {
            println!("{}\t{}\t{}", row.a, row.b, row.c);
        }
    }
    OutputFormat::Pretty => {
        use console::{style, Term};
        let term = Term::stdout();
        for row in &result.rows {
            term.write_line(&format!(
                "{} {} {}",
                style(&row.a).green(),
                style(&row.b).yellow(),
                style(&row.c).dim(),
            ))?;
        }
    }
}
```

Always offer `--format json` for piping into `jq`, scripts, and other tools.

## Shell completions

Already shown in the `Completions` subcommand above. Distribute completions by adding to the install script:

```bash
mytool completions bash > /etc/bash_completion.d/mytool
mytool completions fish > ~/.config/fish/completions/mytool.fish
mytool completions zsh  > "${fpath[1]}/_mytool"
```

## Signal handling

```rust
// In an async CLI command
use tokio::signal::ctrl_c;

tokio::select! {
    _ = ctrl_c() => {
        tracing::warn!("interrupted, cleaning up");
        cleanup().await?;
        std::process::exit(130);  // standard exit code for SIGINT
    }
    result = long_running_task() => {
        result
    }
}
```

For sync CLIs, install a one-shot handler with `ctrlc` crate:

```rust
let interrupted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
let i = interrupted.clone();
ctrlc::set_handler(move || i.store(true, std::sync::atomic::Ordering::SeqCst))?;

while !interrupted.load(std::sync::atomic::Ordering::Relaxed) {
    do_step()?;
}
```

## Error reporting with color-eyre

```rust
fn main() -> color_eyre::Result<()> {
    color_eyre::config::HookBuilder::default()
        .display_env_section(false)        // hide SPANTRACE/BACKTRACE env hints by default
        .display_location_section(false)   // hide file:line section
        .panic_section("If this is a bug, please report at https://github.com/me/mytool/issues")
        .install()?;
    real_main()
}
```

Errors with `.wrap_err("...")` from `eyre::WrapErr` (compatible with anyhow's `.context`) show as a numbered chain. `RUST_BACKTRACE=1` shows the full trace; `RUST_SPANTRACE=1` shows tracing spans where the error fired.

## Distribution

- Add `cargo dist init` for prebuilt binary release pipeline (cross-platform tarballs + installers).
- Publish to Homebrew tap, AUR, scoop, Chocolatey via dist.
- Sign Linux binaries with `cosign` if your audience is enterprise.
- Build single static binary on Linux with `--target x86_64-unknown-linux-musl` (or `aarch64-unknown-linux-musl`).
- For wasm-runnable CLIs (`wasi-cli`), add `--target wasm32-wasip1`.

## Common mistakes

1. **Mixing stdout and stderr.** Tool output goes to stdout; logs and progress go to stderr.
2. **No `--non-interactive` flag.** Interactive prompts block automation.
3. **Printing colored output unconditionally.** Honor `NO_COLOR` env var, detect TTY with `console::user_attended()`.
4. **`println!` for errors.** Use `tracing::error!` so logs go to stderr automatically and respect verbosity.
5. **`unwrap()` on `Cli::parse()`.** clap returns clean errors with `--help` text; `parse()` exits on its own.
6. **Long subcommand handlers in `main.rs`.** Split into `src/commands/<name>.rs` per command.
7. **Missing exit code semantics.** Use `std::process::exit(1)` (general error), `2` (usage), `130` (SIGINT) appropriately. Or return `Result` and let main map.

## Testing CLIs

```rust
// tests/cli.rs
use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn shows_help() {
    Command::cargo_bin("mytool").unwrap()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Usage:"));
}

#[test]
fn rejects_unknown_subcommand() {
    Command::cargo_bin("mytool").unwrap()
        .arg("nope")
        .assert()
        .failure()
        .stderr(predicate::str::contains("unrecognized subcommand"));
}
```

`assert_cmd` builds the binary once per test run and gives a fluent assertion API.
