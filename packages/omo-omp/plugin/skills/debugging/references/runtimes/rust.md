# Rust Debugging

Covers `cargo`, `tokio`, panics, and the fact that you usually don't actually need a debugger — Rust's type system, `dbg!`, and logging cover 80% of sessions faster than gdb would.

---

## Environment detection (Phase 0)

```bash
cargo --version
rustc --version
cat rust-toolchain.toml rust-toolchain 2>/dev/null
cat Cargo.toml | head -30

# Debuggers available
which rust-gdb
which rust-lldb
which lldb

# Async infrastructure
grep -E '"(tokio|async-std|smol)"' Cargo.toml

# Profile flags
grep -E '^\[profile' Cargo.toml
```

**The default `cargo run` builds with `dev` profile** which includes debug symbols. `cargo run --release` strips them. For debugging, stay in dev unless the bug only manifests under optimization.

---

## The Rust debugging hierarchy (use in this order)

Rust's ecosystem has a specific order that's faster than reaching for gdb first:

1. **`dbg!(expr)` macro** — for a single value at a specific spot. Prints file:line + value, returns the value unchanged so you can inline it. Faster than a debugger for 60% of bugs.
2. **`RUST_LOG=trace` with `tracing` / `env_logger`** — for flow and state across an operation. Zero code change in dev-time.
3. **`RUST_BACKTRACE=1` / `=full`** — for crashes. Almost always sufficient; you rarely need a live debugger for a panic.
4. **`rust-gdb` / `rust-lldb`** — when you need to pause execution and inspect memory, especially for unsafe code or FFI.
5. **`tokio-console`** — for async deadlocks, stuck tasks, hot loops.
6. **`cargo-expand`** — when a macro is doing something weird.

Reach for the lightest tool that answers the hypothesis.

---

## `dbg!` — the underused macro

```rust
let x = 5;
let y = dbg!(x * 2);   // prints: [src/main.rs:2] x * 2 = 10
```

Inside a complex expression:
```rust
let total = items.iter().filter(|i| i.active).map(|i| dbg!(i.cost)).sum::<u64>();
```

Multiple values at once:
```rust
dbg!(&user, &request, elapsed.as_millis());
```

`dbg!` writes to stderr, so it won't corrupt stdout-based pipelines. **Journal each `dbg!` you add**; revert at Phase 9.

---

## `RUST_LOG` for flow-level debugging

If the codebase uses `tracing` or `env_logger`:

```bash
RUST_LOG=debug cargo run
RUST_LOG=trace cargo run                          # very verbose
RUST_LOG=my_crate=trace,hyper=info cargo run      # per-module level
RUST_LOG=debug,tokio=off cargo run                # silence noisy crates
```

For `tracing`-based apps, instrument with spans:
```rust
#[tracing::instrument]
fn handle_request(req: &Request) -> Response { ... }
```

This gives you structured per-call entry/exit logs with args and timing, zero additional code in the body.

---

## `RUST_BACKTRACE` for panics

```bash
RUST_BACKTRACE=1 cargo run       # backtrace on panic
RUST_BACKTRACE=full cargo run    # include libstd/tokio frames
```

The panic itself usually tells you the file:line. The backtrace tells you how it got there. Between the two, most crash bugs are solved without a debugger.

---

## rust-gdb / rust-lldb

### Launch

```bash
# Build with debug symbols (default dev profile)
cargo build

# Attach gdb wrapper (applies Rust type pretty-printers)
rust-gdb ./target/debug/my_binary
# Or lldb:
rust-lldb ./target/debug/my_binary

# With args
rust-gdb --args ./target/debug/my_binary arg1 arg2

# Attach to running process
rust-gdb -p $(pgrep my_binary)
```

### Breakpoints

Rust symbols are mangled. Use either:

```
(gdb) b main                                  # main function
(gdb) b my_crate::module::function            # canonical path
(gdb) b src/handler.rs:42                     # file:line
(gdb) info functions my_function              # find mangled name
```

### State inspection

```
(gdb) p x                        # print value (uses Rust pretty-printer for Vec, Option, HashMap, etc.)
(gdb) p *ptr                     # deref
(gdb) info locals                # all locals in current frame
(gdb) info args                  # function args
(gdb) bt                         # backtrace
(gdb) frame <n>                  # switch to stack frame n
(gdb) watch my_var               # stop when my_var changes
(gdb) rbreak regex               # breakpoint all functions matching regex
```

**Pair with pwndbg** for better layout on native bugs — see [tools/pwndbg.md](../tools/pwndbg.md). Pwndbg works with rust-gdb too.

---

## tokio-console — async task debugging

For tokio-based async apps, this is essential when tasks are stuck or leaking.

```bash
# Add tokio-console instrumentation to the target binary
# In Cargo.toml:
#   [dependencies]
#   console-subscriber = "0.2"

# In main.rs:
#   console_subscriber::init();

# Build with tokio_unstable:
RUSTFLAGS="--cfg tokio_unstable" cargo run

# In another terminal:
tokio-console                     # connects to default port 6669
```

Shows live tasks, their state, wake counts, poll durations, parent tasks. The single fastest way to find "why is my async thing stuck".

---

## cargo-expand — when a macro is suspect

```bash
cargo install cargo-expand
cargo expand                      # expand all macros in the crate
cargo expand my::module::path     # scope to one item
```

If you suspect a macro (especially `#[derive]`, `#[tokio::main]`, `#[async_trait]`) is generating code that doesn't match your mental model, this shows you exactly what the compiler sees.

---

## Release-build gotcha

```bash
cargo build --release                        # no debug symbols by default
```

If the bug only shows up in `--release`:

```toml
# Cargo.toml
[profile.release]
debug = true                                 # add symbols, keep optimizations
```

Now `rust-gdb ./target/release/my_binary` works on release builds. This is required when optimization-enabled codegen bugs (inlining, LLVM folding) are suspected.

---

## Silent-failure patterns in Rust

| Pattern | Why it's silent |
|---|---|
| `.unwrap_or_default()` | Masks errors as the zero value |
| `.unwrap_or(fallback)` | Same, with a specific fallback |
| `let _ = fallible_operation()` | Explicitly discards the Result, no compiler warning |
| `if let Ok(x) = ... { use(x); } // no else` | Silent on Err |
| `.ok()` chaining | Converts Result to Option, throwing the error away |
| Panic inside a tokio task not `.await`ed | Task dies silently; runtime usually logs but it's quiet if logs are off |
| `eprintln!` that goes to a redirected-null stderr | Looks like nothing happened |
| `Drop` impl that panics under specific condition | Double-panic aborts process silently if no logging configured |

---

## Phase 9 cleanup specifics

```bash
# Revert dbg! macro additions
git diff | grep -E 'dbg!\('
# For any file with dbg! additions:
git checkout <file>

# Unset env vars
unset RUST_LOG RUST_BACKTRACE

# Kill any rust-gdb/lldb sessions
pkill -f 'rust-gdb' || true
pkill -f 'rust-lldb' || true
pkill -f '^lldb ' || true

# tokio-console binds 6669 by default
lsof -iTCP:6669 -sTCP:LISTEN -nP 2>/dev/null
```
