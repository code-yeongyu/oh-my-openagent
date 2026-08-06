# Miri, Sanitizers, Loom, and Fuzzing — The UB Detection Arsenal

Miri is the **primary weapon**. Everything else is supplementary for the gaps Miri cannot reach.

---

## Miri — The First and Last Line of Defense

### What Miri Is

Miri is an interpreter for Rust's MIR (Mid-level IR). It executes your test suite inside a virtual machine that tracks every byte of memory for validity, provenance, alignment, initialization, and aliasing. It is **deterministic** — same inputs, same result — and it can find UB that no amount of testing on real hardware will ever trigger.

### Why Miri Is Non-Negotiable

- Detects 12 of 14 UB categories (see `ub-taxonomy.md`).
- Catches aliasing violations that compile and run correctly on every platform today but are UB that future compiler optimizations will exploit.
- Catches data races under a configurable scheduling model.
- Catches provenance violations that are impossible to observe on real hardware.
- **Zero false positives** — if Miri says it is UB, it is UB. Period.

### Installation

```bash
rustup install nightly
rustup component add miri rust-src --toolchain nightly
```

Verify:
```bash
cargo +nightly miri --version
```

### Running Miri

**Default run (Stacked Borrows, standard checks):**
```bash
cargo +nightly miri test
```

**With nextest (recommended for projects already using nextest):**
```bash
cargo +nightly miri nextest run
```

**Specific test:**
```bash
cargo +nightly miri test -- test_name
```

**Run a binary:**
```bash
cargo +nightly miri run
```

### MIRIFLAGS — The Dial-Up Knobs

These flags are set via the `MIRIFLAGS` environment variable. The agent should use ALL of the strictness flags during a UB audit.

#### Aliasing Model

```bash
# Default: Stacked Borrows (strict)
cargo +nightly miri test

# Tree Borrows (newer, more permissive — use as a second pass)
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri test
```

**Protocol:** Run Stacked Borrows first. If it fails, fix it. Then run Tree Borrows to confirm. Code that passes Stacked Borrows is sound under both models.

#### Strict Provenance

```bash
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test
```

Catches `ptr as usize as *const T` roundtrips where provenance is lost. **Should be ON for every audit.**

#### Symbolic Alignment Checks

```bash
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri test
```

Catches alignment UB that happens to be aligned on your machine but is not guaranteed by the type system.

#### Data Race Detection Tuning

```bash
# Increase preemption rate to stress-test race conditions
MIRIFLAGS="-Zmiri-preemption-rate=0.5" cargo +nightly miri test

# Disable preemption (sequential scheduling — fewer races found but deterministic)
MIRIFLAGS="-Zmiri-preemption-rate=0" cargo +nightly miri test
```

#### The Full Paranoia Sweep (Use This for Audits)

```bash
MIRIFLAGS="\
  -Zmiri-strict-provenance \
  -Zmiri-symbolic-alignment-check \
  -Zmiri-preemption-rate=0.1 \
  -Zmiri-backtrace=full \
  -Zmiri-disable-isolation" \
cargo +nightly miri test
```

Then a second pass with Tree Borrows:
```bash
MIRIFLAGS="\
  -Zmiri-tree-borrows \
  -Zmiri-strict-provenance \
  -Zmiri-symbolic-alignment-check \
  -Zmiri-preemption-rate=0.1 \
  -Zmiri-backtrace=full \
  -Zmiri-disable-isolation" \
cargo +nightly miri test
```

#### Isolation and I/O

Miri runs in isolation by default — no file I/O, no network, no system calls. If your tests need the filesystem:
```bash
MIRIFLAGS="-Zmiri-disable-isolation" cargo +nightly miri test
```

Use sparingly — isolation is a feature, not a limitation. Tests that need I/O should have a separate `#[cfg(not(miri))]` path.

### Miri Limitations

| Cannot do | Workaround |
|-----------|-----------|
| Execute FFI / C code | ASAN, MSAN, Valgrind |
| Run I/O-heavy tests (default) | `-Zmiri-disable-isolation` or `#[cfg(not(miri))]` |
| Exhaustive interleaving exploration | loom |
| Find performance bugs | criterion, flamegraph |
| Run inline assembly | skip with `#[cfg(not(miri))]` |
| Test OS-specific behavior | real hardware + sanitizers |

### Miri in CI

```yaml
# GitHub Actions example
miri:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@nightly
      with:
        components: miri, rust-src
    - name: Miri test (Stacked Borrows + strict provenance)
      run: |
        MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-symbolic-alignment-check -Zmiri-backtrace=full" \
        cargo +nightly miri test
    - name: Miri test (Tree Borrows)
      run: |
        MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-strict-provenance -Zmiri-symbolic-alignment-check -Zmiri-backtrace=full" \
        cargo +nightly miri test
```

### Miri-Incompatible Test Gating

```rust
#[test]
#[cfg_attr(miri, ignore)]  // Miri cannot run this (FFI, I/O, inline asm)
fn test_requires_real_hardware() {
    // ...
}

// Or conditionally compile the test body:
#[test]
fn test_with_miri_fallback() {
    #[cfg(miri)]
    {
        // Simplified version that avoids FFI
    }
    #[cfg(not(miri))]
    {
        // Full version with FFI
    }
}
```

---

## Sanitizers — Where Miri Cannot Reach

Sanitizers are compiler instrumentation passes. They run your actual binary on real hardware with extra checks injected. Use them for FFI, I/O-heavy code, and integration tests.

### AddressSanitizer (ASAN)

Detects: use-after-free, buffer overflow, stack-use-after-return, double-free, memory leaks.

```bash
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

On macOS:
```bash
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test -Zbuild-std --target aarch64-apple-darwin
```

### ThreadSanitizer (TSAN)

Detects: data races on non-atomic accesses across threads.

```bash
RUSTFLAGS="-Zsanitizer=thread" cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

**When to use over Miri:** Integration tests involving real threads + real I/O + FFI. Miri's data-race detector is superior for pure-Rust code.

### MemorySanitizer (MSAN)

Detects: reads of uninitialized memory.

```bash
RUSTFLAGS="-Zsanitizer=memory -Zsanitizer-memory-track-origins" cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

**When to use over Miri:** FFI code where C/C++ may return uninitialized memory into Rust.

### UndefinedBehaviorSanitizer (UBSAN)

Detects: integer overflow, misaligned access, null dereference, and other C/C++-style UB at the LLVM level.

```bash
RUSTFLAGS="-Zsanitizer=undefined" cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

### Sanitizer Limitations

- Require nightly + `-Zbuild-std` (rebuilds the standard library with instrumentation).
- MSAN requires ALL dependencies (including C libs) to be instrumented — practically hard.
- Cannot catch aliasing violations (that is Miri's domain).
- Significant runtime overhead (2-15x slower).
- Linux has the best support; macOS works for ASAN; Windows support is minimal.

---

## Loom — Exhaustive Concurrency Testing

Loom explores all possible thread interleavings of a bounded concurrent program. It is mandatory for lock-free and wait-free primitives.

### When to Use Loom

- Any `unsafe` code involving atomics with ordering weaker than `SeqCst`.
- Custom lock implementations.
- Lock-free queues, stacks, or other concurrent data structures.
- Any code where you chose `Relaxed`, `Acquire`, or `Release` ordering.

### When NOT to Use Loom

- Code using only `Mutex`/`RwLock` from std or `parking_lot` — the locks are sound, your usage is the question, and Miri + TSAN cover that.
- Async code (loom does not model async runtimes — use `tokio::test` + Miri instead).

### Setup

```toml
[dev-dependencies]
loom = "0.7"
```

### Loom Test Pattern

```rust
#[cfg(loom)]
mod loom_tests {
    use loom::sync::atomic::{AtomicUsize, Ordering};
    use loom::sync::Arc;
    use loom::thread;

    #[test]
    fn concurrent_increment_is_sound() {
        loom::model(|| {
            let counter = Arc::new(AtomicUsize::new(0));

            let threads: Vec<_> = (0..2).map(|_| {
                let c = counter.clone();
                thread::spawn(move || {
                    c.fetch_add(1, Ordering::SeqCst);
                })
            }).collect();

            for t in threads {
                t.join().unwrap();
            }

            assert_eq!(counter.load(Ordering::SeqCst), 2);
        });
    }
}
```

### Conditional Compilation for Loom

```rust
#[cfg(loom)]
use loom::sync::atomic::{AtomicUsize, Ordering};
#[cfg(not(loom))]
use std::sync::atomic::{AtomicUsize, Ordering};
```

### Running Loom Tests

```bash
# Loom tests only (use cfg flag)
RUSTFLAGS="--cfg loom" cargo test --lib -- loom_tests

# With release optimizations (loom is slow)
RUSTFLAGS="--cfg loom" cargo test --lib --release -- loom_tests
```

### Loom + Miri Interaction

Loom and Miri solve different problems:
- **Miri** checks a single execution for UB (aliasing, validity, provenance).
- **Loom** checks all interleavings for correctness (ordering, atomicity).

Run BOTH on lock-free code:
```bash
# Step 1: loom for interleaving correctness
RUSTFLAGS="--cfg loom" cargo test --lib --release -- loom_tests

# Step 2: Miri for UB in each path
cargo +nightly miri test -- concurrent_tests
```

---

## Cargo-Fuzz — Property-Based UB Hunting

Fuzzing generates random inputs to maximize code coverage and find crashes, panics, and UB.

### Setup

```bash
cargo install cargo-fuzz
cargo fuzz init
```

### Fuzz Target

```rust
// fuzz/fuzz_targets/parse_input.rs
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Your parsing/deserialization/processing code here.
    // If it panics or triggers UB, the fuzzer catches it.
    let _ = my_crate::parse(data);
});
```

### Running

```bash
# Run until interrupted
cargo +nightly fuzz run parse_input

# Run with ASAN (catches memory bugs in unsafe code)
cargo +nightly fuzz run parse_input -- -rss_limit_mb=4096

# Minimize a crashing input
cargo +nightly fuzz tmin parse_input artifacts/parse_input/crash-xxxxx
```

### Fuzz + Miri Pipeline

When the fuzzer finds a crashing input:
1. Minimize it with `cargo fuzz tmin`.
2. Add it as a regression test.
3. Run the regression test under Miri to classify whether it is a panic (safe) or UB (must fix).

```bash
# After adding the input as a test case:
cargo +nightly miri test -- test_fuzz_regression_001
```

---

## Tool Selection Decision Tree

```
Start
  │
  ├── Is it pure Rust (no FFI, no I/O)?
  │     YES → Miri (full paranoia flags)
  │     │     └── Also: loom (if atomics/lock-free)
  │     │     └── Also: proptest (if parsing/serialization)
  │     │     └── Also: cargo-fuzz (if untrusted input)
  │     │
  │     NO → Does it involve FFI?
  │           YES → ASAN + MSAN on integration tests
  │           │     └── Miri on the Rust-side handling
  │           │     └── cbindgen in CI for layout verification
  │           │
  │           NO → Is it I/O-heavy?
  │                 YES → TSAN for thread safety
  │                 │     └── Miri with -Zmiri-disable-isolation where possible
  │                 │
  │                 NO → Miri (full paranoia flags)
  │
  └── Always: Miri is the default. Other tools supplement.
```

## The One Rule

> **When in doubt, run Miri.** If Miri cannot run it, write a version it can run, and test that under Miri. Then test the real version under sanitizers. Never ship `unsafe` code that has not passed Miri.
