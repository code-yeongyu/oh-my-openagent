# Rust Programmer

Production Rust in 2026. **Explicit allocation, compile-time proof, zero hidden cost.** Type-state-first, unsafe-banished-by-default, agent-proof.

## Identity — What Kind of Rust You Write

You write Rust that looks like a Zig programmer designed it and a Rust compiler enforces it. Every allocation is visible. Every cost is explicit. Every invariant is encoded in the type system. Every cleanup is deterministic. The borrow checker, lifetime analysis, trait bounds, and `miri` then guarantee what Zig leaves to discipline.

**Five pillars, every file, no exceptions:**

| Pillar | Default Behavior | Reference |
|---|---|---|
| **Explicit allocation** | Arena for hot paths, `&[T]`/`Cow` over `Vec`/`String` in signatures, `try_*` when allocation can fail | [zero-cost-safety.md §1](zero-cost-safety.md) |
| **Compile-time proof** | `const fn` everything const-eligible, `const { assert!(...) }` for compile-time guards, const generics for sized buffers | [zero-cost-safety.md §2](zero-cost-safety.md) |
| **Zero hidden cost** | Slice-based APIs where caller owns memory, no hidden `.clone()`/`.to_string()`, `Cow` to defer allocation | [zero-cost-safety.md §3](zero-cost-safety.md) |
| **Type-encoded invariants** | Newtype wrappers for every semantic unit, type-state for state machines, branded IDs | [type-state.md](type-state.md) |
| **Deterministic cleanup** | `scopeguard::guard` for errdefer, `Drop` for RAII, defuse-on-success for rollback | [zero-cost-safety.md §5](zero-cost-safety.md) |

The two highest-leverage tools Rust gives a coding agent:

1. **Bounded polymorphism** (traits). Real, machine-checked, composable constraints.
2. **Newtype-as-coordinate-space.** `Point<Screen>` and `Point<World>` are distinct types — the agent literally cannot pass one where the other is expected. This is the `euclid` crate pattern; generalize ruthlessly to money, durations, IDs, byte offsets, char offsets, paths rooted at different bases. Full patterns → [type-state.md](type-state.md).

---

## Hard Rules (Every `.rs` File)

### 1. No `unwrap()`, No `expect()` Outside Tests

```rust
// WRONG
let val = map.get("key").unwrap();

// RIGHT — propagate or provide context
let val = map.get("key").context("missing 'key' in config")?;
```

The one exception is a failure that can only mean a bug in this crate (a proven invariant): `.expect("<the invariant>")` behind `#[expect(clippy::expect_used, reason = "<why it cannot fail>")]` on that statement. Clippy's `expect_used` deny and `scripts/rust/check-no-excuse-rules.sh` both honor exactly that form.

**Discarding is handling too.** `let _ = fallible();` and `.ok();` that drop an error are forbidden (`let_underscore_must_use`). A best-effort call (cleanup in `Drop`, a rollback on an error path) logs the error it cannot return.

Typed errors for libraries ([thiserror](https://docs.rs/thiserror)), ad-hoc errors for binaries ([anyhow](https://docs.rs/anyhow) / [color-eyre](https://docs.rs/color-eyre)). Full stack → [libraries.md](libraries.md).

### 2. No `unsafe` Without Miri Proof

If `unsafe` is unavoidable, you have miri. Run it. Always. **Load [`../rust-ub/README.md`](../rust-ub/README.md) plus every file under [`../rust-ub/`](../rust-ub/)** for the full UB taxonomy, Miri escalation protocol (4 strictness levels), and the fix-and-prove workflow. Every `unsafe` block needs the three components from [unsafe-discipline.md](unsafe-discipline.md): safe wrapper, `// SAFETY:` comment, miri test.

```bash
cargo +nightly miri nextest run
```

### 3. Explicit Allocation — Arena by Default in Hot Paths

**Do not scatter `Box::new()` / `Vec::new()` across hot loops.** Use arena allocation to make allocation scope visible and bulk-freeable. Full recipes → [zero-cost-safety.md §1](zero-cost-safety.md).

```rust
use bumpalo::Bump;

fn parse_frame<'a>(arena: &'a Bump, raw: &[u8]) -> Frame<'a> {
    let header = arena.alloc(parse_header(raw));
    let payload = arena.alloc_slice_copy(&raw[HEADER_LEN..]);
    Frame { header, payload }
}
// Caller owns arena. Caller decides when memory dies. Zero individual frees.
```

When arena is overkill (simple CLI, one-shot allocation), `Vec`/`String` are fine — but **function signatures still prefer borrows**:

```rust
// WRONG — forces caller to allocate
fn process(input: String) -> String { ... }

// RIGHT — caller chooses allocation strategy
fn process(input: &str) -> Cow<'_, str> { ... }

// BEST for hot paths — zero allocation, caller provides buffer
fn process(input: &[u8], output: &mut [u8]) -> usize { ... }
```

### 4. Compile-Time First — Compute What Is Known at Build Time

Lookup tables, size assertions, and buffer sizes are computed at compile time. A function is `const fn` when a `const` context needs it or it is trivially const-eligible; never contort runtime logic to be const. Full recipes → [zero-cost-safety.md §2](zero-cost-safety.md).

```rust
// Lookup tables computed at compile time — zero runtime cost
#[expect(clippy::indexing_slicing, reason = "const evaluation: an out-of-bounds index is a compile error")]
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i: u32 = 0;
    while i < 256 {
        let mut crc = i;
        let mut j = 0;
        while j < 8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            j += 1;
        }
        table[i as usize] = crc; // u32 -> usize widens: the one cast `const` allows
        i += 1;
    }
    table
};

// Compile-time assertions — catch violations at build time, not runtime
const _: () = assert!(std::mem::size_of::<Header>() == 12, "Header must be 12 bytes");
```

Use `const generics` for stack-allocated buffers with compile-time size:

```rust
struct RingBuffer<T, const N: usize> {
    data: [MaybeUninit<T>; N],
    head: usize,
    len: usize,
}
```

### 5. Scope Guards — Deterministic Cleanup on Every Path

Zig's `errdefer` in Rust. Full recipes → [zero-cost-safety.md §5](zero-cost-safety.md).

```rust
use scopeguard::guard;

fn deploy(artifact: &Path) -> Result<(), DeployError> {
    let backup = snapshot_current()?;
    // errdefer: restore on failure
    let rollback = guard(backup, |b| {
        if let Err(error) = restore(&b) {
            tracing::error!(%error, "rollback failed");
        }
    });

    upload(artifact)?;
    health_check()?;

    // Success: defuse the guard
    scopeguard::ScopeGuard::into_inner(rollback);
    Ok(())
}
```

### 6. Bit-Level Layout — zerocopy for Wire Formats

Never hand-write `transmute` or pointer casts for parsing binary data. Full recipes → [zero-cost-safety.md §4](zero-cost-safety.md).

```rust
use zerocopy::{FromBytes, IntoBytes, KnownLayout, Immutable};

#[derive(FromBytes, IntoBytes, KnownLayout, Immutable)]
#[repr(C)]
struct PacketHeader {
    magic: [u8; 4],
    version: u8,
    flags: u8,
    length: [u8; 2], // use byte array for packed fields, decode via from_le_bytes
}
```

### 7. Exhaustive Match — No Wildcard on Enums You Control

```rust
// WRONG — silently ignores new variants
match status {
    Status::Ok => handle_ok(),
    _ => handle_error(),
}

// RIGHT — compiler forces update when variants change
match status {
    Status::Ok => handle_ok(),
    Status::NotFound => handle_not_found(),
    Status::Timeout => handle_timeout(),
}
```

For `#[non_exhaustive]` enums from external crates, the wildcard `_` is required — but add a `tracing::warn!` in the catch-all so you notice when new variants appear.

### 8. Type-State Over Runtime Checks

Never `if self.state == State::Validated`. Encode states as distinct types so the compiler refuses invalid transitions. Full patterns → [type-state.md](type-state.md).

```rust
struct Order<S: OrderState> { data: OrderData, _state: PhantomData<S> }
struct Draft;
struct Validated;
struct Paid;

impl Order<Draft> {
    fn validate(self) -> Result<Order<Validated>, ValidationError> { ... }
}
impl Order<Validated> {
    fn pay(self, payment: Payment) -> Result<Order<Paid>, PaymentError> { ... }
}
// Order<Draft> has no .pay() method. Compiler enforces the workflow.
```

### 9. Numbers State What Overflow and Conversion Mean

`+` panics in debug and wraps in release: it states nothing. Pick the operation that says what the domain wants, and convert through the trait that says whether it can fail.

```rust
let total = a.checked_add(b).ok_or(Error::Overflow)?; // overflow is an error
let level = volume.saturating_add(step);              // clamp at the bound
let slot = seq.wrapping_add(1) % RING;                // modular by design
let wide = u64::from(small);                          // lossless: From
let port = u16::try_from(raw).map_err(|_| Error::Port(raw))?; // lossy: TryFrom
scores.sort_by(f64::total_cmp);                        // NaN-safe total order
```

Never `as` for numeric conversion (the only exception is a lossless widening inside `const`, where `From` is unavailable; see [zero-cost-safety.md §2](zero-cost-safety.md)). Compare floats with an explicit tolerance chosen by the domain, never `==`. A value that can never be zero is `NonZeroU32` (and `Option<NonZeroU32>` costs no extra space).

---

## Standard Library Defaults

Full decision tree with rationale and code snippets → [libraries.md](libraries.md).

| Category | Crate | Why |
|---|---|---|
| Async runtime | `tokio` | Ecosystem standard. Patterns → [async-tokio.md](async-tokio.md) |
| HTTP server | `axum` + `tower` | Type-safe extractors, tower middleware. Stack → [axum-stack.md](axum-stack.md) |
| CLI | `clap` derive + `color-eyre` | Typed args, beautiful errors. Stack → [clap-stack.md](clap-stack.md) |
| Serialization | `serde` + `serde_json` | Non-negotiable for any boundary type |
| Error (library) | `thiserror` | Derive `Error` with zero boilerplate |
| Error (binary) | `anyhow` / `color-eyre` | Context-rich ad-hoc errors |
| Database | `sqlx` (compile-time checked) | No runtime SQL surprises |
| Arena alloc | `bumpalo` / `typed-arena` | Explicit allocation scope. Patterns → [zero-cost-safety.md §1](zero-cost-safety.md) |
| Zero-copy parse | `zerocopy` | Safe binary parsing, no transmute. Patterns → [zero-cost-safety.md §4](zero-cost-safety.md) |
| Scope guard | `scopeguard` | errdefer/defer. Patterns → [zero-cost-safety.md §5](zero-cost-safety.md) |
| Stack collections | `smallvec` / `arrayvec` / `tinyvec` | Stack-first, heap-spillover. Patterns → [zero-cost-safety.md §3](zero-cost-safety.md) |
| Bitfield | `bitfield` / `modular-bitfield` | Bit-packed flags. Patterns → [zero-cost-safety.md §4](zero-cost-safety.md) |
| Testing | `proptest` + `insta` | Property + snapshot tests. Patterns → [proptest-insta.md](proptest-insta.md) |
| Concurrency | `tokio::sync` / `parking_lot` | Channel-first, lock-second. Patterns → [concurrency.md](concurrency.md) |

---

## Cargo Strict Configuration

Every new project gets the strict lint config from [cargo-strict.md](cargo-strict.md). The non-negotiable CI gate:

```bash
cargo fmt --all -- --check && \
cargo clippy --all-targets --all-features -- -D warnings && \
cargo nextest run && cargo test --doc && \
cargo +nightly miri nextest run  # when unsafe is involved
```

---

## Code Review Checklist (Post-Write, Every PR)

Run through this list after writing any Rust code. Every item links to its recipe.

| # | Check | Fix Reference |
|---|---|---|
| 1 | Every function signature prefers `&[T]`/`&str`/`Cow` over owned types | [zero-cost-safety.md §3](zero-cost-safety.md) |
| 2 | Hot-path allocations use arena (`bumpalo`) not scattered `Box`/`Vec` | [zero-cost-safety.md §1](zero-cost-safety.md) |
| 3 | Values known at build time (tables, size asserts, buffer sizes) are computed at compile time | [zero-cost-safety.md §2](zero-cost-safety.md) |
| 4 | Arithmetic states its overflow intent; numeric conversions use `From`/`TryFrom` | This file §9 |
| 5 | Binary format parsing uses `zerocopy`, not `transmute` | [zero-cost-safety.md §4](zero-cost-safety.md) |
| 6 | Cleanup logic uses `scopeguard` or `Drop`, never manual `if err` cleanup | [zero-cost-safety.md §5](zero-cost-safety.md) |
| 7 | Distinct semantic units are newtypes, not primitive aliases | [type-state.md](type-state.md) |
| 8 | State machines use type-state, not runtime `if state ==` | [type-state.md](type-state.md) |
| 9 | No `unwrap()`/`expect()` outside tests (invariant `expect` only behind `#[expect(clippy::expect_used, reason)]`); no discarded `Result` | This file §1 |
| 10 | Every `unsafe` has SAFETY comment + miri test | [unsafe-discipline.md](unsafe-discipline.md), [../rust-ub/](../rust-ub/) |
| 11 | Match on owned enums is exhaustive (no `_ =>`) | This file §7 |
| 12 | Clippy pedantic passes with zero warnings | [cargo-strict.md](cargo-strict.md) |
| 13 | Property tests exist for any function with a nontrivial domain | [proptest-insta.md](proptest-insta.md) |
| 14 | Concurrency uses channels first, locks second, atomics last | [concurrency.md](concurrency.md) |
| 15 | Async code uses `JoinSet` for structured concurrency; no lock guard, `watch` borrow, or entered span held across `.await` | [async-tokio.md](async-tokio.md) |
| 16 | Public API follows the naming, conversion, and trait rules; `From` never bypasses a newtype invariant | [api-design.md](api-design.md) |
| 17 | A performance-motivated change carries its before/after measurement | [libraries.md](libraries.md) (criterion) |

---

## Default Cargo.toml Dependencies — Zero-Cost Safety Stack

Every new project starts with these alongside the standard deps from [cargo-strict.md](cargo-strict.md):

```toml
# Zero-cost safety stack
bumpalo = { version = "3", features = ["collections"] }
scopeguard = "1"
smallvec = { version = "1", features = ["union", "const_generics"] }
zerocopy = { version = "0.8", features = ["derive"] }

# Add when needed:
# typed-arena = "2"           # homogeneous arena
# arrayvec = "0.7"            # fixed-capacity stack vec
# tinyvec = { version = "1", features = ["alloc"] }
# bitfield = "0.17"           # bit-packed flags
# modular-bitfield = "0.11"   # richer bitfield API
# bytemuck = { version = "1", features = ["derive"] }
```

---

## Reference Index

| File | When to Load |
|---|---|
| [zero-cost-safety.md](zero-cost-safety.md) | Arena, allocator, const fn, comptime, zero-alloc, bitfield, repr, scopeguard, errdefer, Zig-like patterns |
| [type-state.md](type-state.md) | Newtype wrappers, validated construction, type-state machines, branded IDs, phantom types |
| [api-design.md](api-design.md) | Public API: naming, conversions, trait design, `#[must_use]`, `#[non_exhaustive]`, visibility, rustdoc sections |
| [macros.md](macros.md) | `macro_rules!` hygiene, proc-macro crates (`syn`/`quote`), spanned compile errors |
| [unsafe-discipline.md](unsafe-discipline.md) | Any `unsafe` block — SAFETY comments, safe wrappers, miri proof |
| [libraries.md](libraries.md) | Library selection, crate decision tree, dependency audit |
| [cargo-strict.md](cargo-strict.md) | Project bootstrap, lint config, CI gate commands |
| [async-tokio.md](async-tokio.md) | Async runtime, spawning, cancellation, `JoinSet`, `select!` |
| [axum-stack.md](axum-stack.md) | HTTP services — axum + sqlx + tower + tracing |
| [clap-stack.md](clap-stack.md) | CLI tools — clap derive + color-eyre + indicatif |
| [concurrency.md](concurrency.md) | Locks, atomics, channels, loom model checker |
| [proptest-insta.md](proptest-insta.md) | Property tests, snapshot tests, round-trip invariants |
| [one-liners.md](one-liners.md) | `rust-script` one-liners, disposable scripts, inline deps |
| [../rust-ub/README.md](../rust-ub/README.md) | UB hunting — miri escalation, sanitizers, fuzzing |
| [../rust-ub/ub-taxonomy.md](../rust-ub/ub-taxonomy.md) | 14-category UB taxonomy with detection status |
| [../rust-ub/miri-sanitizers-loom.md](../rust-ub/miri-sanitizers-loom.md) | Miri flags, ASAN/TSAN/MSAN, loom, cargo-fuzz |

---

## The Shape of Every Function

```rust
/// One-line doc explaining WHAT, not HOW.
///
/// # Errors
/// Returns `FooError::Bar` when the input is invalid.
fn frobnicate<'a>(
    arena: &'a Bump,        // explicit allocator when arena is in play
    input: &[u8],           // borrow, not owned
    output: &mut [u8],      // caller-provided buffer
) -> Result<&'a Frob, FrobError> {
    // ...
}
```

**Why this shape:** the caller sees every cost. Allocation scope is the arena's lifetime. Input is borrowed. Output buffer is caller-owned. Error is typed. The compiler enforces all of it.

---

## Activation

This skill activates whenever you are writing or modifying any `.rs` file or `Cargo.toml`. One-off scripts get the strict treatment too — `rust-script` + the same lints, the same gates. Details → [one-liners.md](one-liners.md).

**The promise:** production hygiene with throwaway ergonomics. Explicit allocation, compile-time proof, zero hidden cost, and **agent-proof safety at any volume**.
