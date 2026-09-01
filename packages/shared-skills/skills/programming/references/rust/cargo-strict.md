# Cargo Strict Configuration

The exact knobs every new Rust project gets. Drop these in unmodified.

## `rust-toolchain.toml`

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy", "rust-src"]
profile = "default"
```

Pin nightly separately when miri runs:

```bash
rustup install nightly
rustup component add miri rust-src --toolchain nightly
```

## `Cargo.toml` — `[lints]` section

```toml
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

[lints.clippy]
# Groups
all = { level = "deny", priority = -1 }
pedantic = { level = "warn", priority = -1 }
nursery = { level = "warn", priority = -1 }
cargo = { level = "warn", priority = -1 }

# Hard denies - turn warnings into errors for sharp tools
undocumented_unsafe_blocks = "deny"
multiple_unsafe_ops_per_block = "deny"
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
unreachable = "deny"
indexing_slicing = "deny"
mem_forget = "deny"
arithmetic_side_effects = "warn"
cast_possible_truncation = "warn"
cast_possible_wrap = "warn"
cast_precision_loss = "warn"
cast_sign_loss = "warn"
as_underscore = "deny"
as_ptr_cast_mut = "deny"
ptr_as_ptr = "warn"
borrow_as_ptr = "warn"
fn_to_numeric_cast_any = "deny"
clone_on_ref_ptr = "warn"
mutex_atomic = "warn"
rc_buffer = "warn"
rc_mutex = "warn"
exit = "warn"
allow_attributes_without_reason = "warn"
dbg_macro = "warn"
print_stderr = "warn"
print_stdout = "warn"
use_debug = "warn"

# Stylistic relaxations (project-wide opinions only)
module_name_repetitions = "allow"
must_use_candidate = "allow"
missing_errors_doc = "allow"  # we use anyhow::Result with .context() everywhere; doc rule is noisy

# Restriction lints - opt-in soundness rails
unreachable = "deny"
mod_module_files = "warn"      # prefer foo.rs over foo/mod.rs
empty_drop = "warn"
empty_structs_with_brackets = "warn"
empty_enum = "warn"
exhaustive_enums = "warn"      # public enums should consider #[non_exhaustive]
exhaustive_structs = "warn"
```

The `priority = -1` trick: group-level levels are weak; specific lints below them win. This lets us deny `unwrap_used` while still allowing `pedantic` group warnings instead of denies.

## `Cargo.toml` — release profile

```toml
[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
strip = "symbols"
panic = "abort"        # smaller, faster - if you need unwinding (FFI catch), set "unwind"
debug = "line-tables-only"

[profile.dev]
opt-level = 0
debug = true
incremental = true
codegen-units = 256
split-debuginfo = "unpacked"

# A profile for miri - opt-level 1 keeps simulation bearable while still
# exercising real codegen patterns. miri ignores most profile keys but reads
# overflow-checks.
[profile.miri]
inherits = "test"
opt-level = 1
overflow-checks = true
```

## `Cargo.toml` — workspace level

```toml
[workspace]
resolver = "3"

[workspace.package]
edition = "2024"
rust-version = "1.83"   # bump only when a needed feature lands
license = "Apache-2.0 OR MIT"

[workspace.lints]
# Then in each member crate:
# [lints]
# workspace = true
```

## `rustfmt.toml`

```toml
edition = "2024"
max_width = 100
imports_granularity = "Module"
group_imports = "StdExternalCrate"
reorder_imports = true
reorder_modules = true
newline_style = "Unix"
use_field_init_shorthand = true
use_try_shorthand = true
unstable_features = false
```

Most options come from stable rustfmt. `imports_granularity` and `group_imports` are nightly-only but ignored cleanly on stable; CI runs `cargo +nightly fmt --check` for the import grouping.

## `clippy.toml`

```toml
# Reduce cognitive load thresholds.
cognitive-complexity-threshold = 25
type-complexity-threshold = 250
too-many-arguments-threshold = 6
too-many-lines-threshold = 100

# msrv - keeps clippy from suggesting features past our MSRV
msrv = "1.83"

# Avoid `panic` lint complaining about derived Debug impls calling unreachable_unchecked etc.
allow-unwrap-in-tests = true
allow-expect-in-tests = true
allow-panic-in-tests = true
allow-dbg-in-tests = true
allow-print-in-tests = true

# Force named arguments above N params
single-char-binding-names-threshold = 4
```

## `deny.toml` (cargo-deny)

```toml
[advisories]
db-path = "~/.cargo/advisory-db"
db-urls = ["https://github.com/rustsec/advisory-db"]
yanked = "deny"
ignore = []

[licenses]
allow = [
    "MIT",
    "Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Unicode-DFS-2016",
    "Unicode-3.0",
    "Zlib",
    "MPL-2.0",
    "CC0-1.0",
]
confidence-threshold = 0.93
exceptions = []

[bans]
multiple-versions = "warn"
wildcards = "deny"
highlight = "all"
deny = [
    # Pin out unmaintained alternatives
    { name = "async-std", reason = "use tokio" },
    { name = "actix-web", reason = "use axum" },
    { name = "chrono", reason = "use jiff" },
]

[sources]
unknown-registry = "deny"
unknown-git = "warn"
allow-registry = ["https://github.com/rust-lang/crates.io-index"]
```

## CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

env:
  CARGO_TERM_COLOR: always
  RUST_BACKTRACE: 1

jobs:
  fmt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@nightly
        with:
          components: rustfmt
      - run: cargo +nightly fmt --all -- --check

  clippy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo clippy --all-targets --all-features --workspace -- -D warnings

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: taiki-e/install-action@nextest
      - run: cargo nextest run --all-targets --all-features --workspace

  miri:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@nightly
        with:
          components: miri, rust-src
      - uses: Swatinem/rust-cache@v2
      - uses: taiki-e/install-action@nextest
      - env:
          MIRIFLAGS: "-Zmiri-strict-provenance -Zmiri-symbolic-alignment-check"
        run: cargo +nightly miri nextest run --all-features --workspace

  machete:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: bnjbvr/cargo-machete@main

  deny:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: EmbarkStudios/cargo-deny-action@v2
        with:
          command: check all

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rustsec/audit-check@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

## Project bootstrap

```bash
cargo new --bin my-app --edition 2024
cd my-app
cargo install cargo-nextest cargo-machete cargo-deny cargo-edit cargo-watch
rustup install nightly
rustup component add miri --toolchain nightly
# drop the configs above
git add . && git commit -m "chore: bootstrap strict toolchain"
```

After every change:

```bash
cargo fmt --all -- --check && \
cargo clippy --all-targets --all-features -- -D warnings && \
cargo nextest run && \
cargo +nightly miri nextest run    # only if unsafe is involved
```
