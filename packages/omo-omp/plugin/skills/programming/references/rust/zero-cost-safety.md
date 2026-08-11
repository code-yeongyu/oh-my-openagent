# Zero-Cost Safety — Zig Ergonomics in Rust

Rust already owns memory safety. This reference adds the patterns that give you Zig's *ergonomic* safety — explicit allocation control, compile-time computation, zero-hidden-cost APIs, bit-level layout, and deterministic cleanup — without leaving the Rust toolchain.

**When to load this file:** arena, allocator, bumpalo, const fn, const generics, comptime, zero-alloc, no-alloc, slice-based API, `#[repr]`, packed struct, bitfield, scopeguard, errdefer, RAII cleanup, Zig-like patterns.

---

## 1. Explicit Allocators — Arena Pattern

Zig passes `allocator: Allocator` to every function. Rust's stable equivalent: arena crates that make allocation scope visible and bulk-freeable.

### bumpalo — The Default Arena

```rust
use bumpalo::Bump;

fn parse_tokens<'a>(arena: &'a Bump, input: &[u8]) -> Vec<&'a str> {
    // All allocations go into `arena`. Caller controls lifetime.
    // When `arena` drops, everything frees in one shot.
    let token = arena.alloc_str("hello");
    let slice = arena.alloc_slice_copy(&[1u8, 2, 3]);
    vec![token] // Vec itself is on heap; contents point into arena
}

// Usage: caller owns the arena, decides when memory dies.
let arena = Bump::new();
let tokens = parse_tokens(&arena, b"...");
drop(arena); // all arena memory freed, zero individual deallocations
```

**When to use:** parsers, compilers, game frame allocators, request-scoped web handlers, any hot loop where individual `Box`/`Vec` alloc+free overhead matters.

### typed-arena — Homogeneous Arena

```rust
use typed_arena::Arena;

struct AstNode { kind: u8, children: Vec<&'static AstNode> } // simplified

let node_arena: Arena<AstNode> = Arena::new();
let root = node_arena.alloc(AstNode { kind: 0, children: vec![] });
// All nodes share arena lifetime. No individual free.
```

**When to use:** tree/graph structures where all nodes have the same type and same lifetime.

### allocator_api (nightly) — Full Zig Parity

```rust
#![feature(allocator_api)]
use std::alloc::Global;

// Vec parameterized by allocator — exactly like Zig.
let v: Vec<u8, &Bump> = Vec::new_in(&arena);

// Custom allocator for tracking, limiting, or redirecting allocation
struct CountingAlloc { inner: Global, count: AtomicUsize }
unsafe impl Allocator for CountingAlloc { /* ... */ }
```

**When to use:** when you need allocator-generic data structures on nightly. For stable code, prefer `bumpalo` directly.

### Decision Tree

```
Need arena allocation?
├── All items same type, same lifetime → typed-arena
├── Mixed types, same lifetime → bumpalo
├── Need allocator-generic containers → allocator_api (nightly)
└── Just need fewer allocations → SmallVec / ArrayVec / tinyvec (stack-first)
```

### Cargo.toml

```toml
bumpalo = { version = "3", features = ["collections"] }
typed-arena = "2"
smallvec = { version = "1", features = ["union", "const_generics"] }
tinyvec = { version = "1", features = ["alloc"] }
```

---

## 2. Compile-Time Computation — const fn, const generics, proc macros

Zig's `comptime` runs arbitrary code at compile time. Rust splits this across three mechanisms.

### const fn — Compile-Time Pure Functions

```rust
const fn fibonacci(n: usize) -> usize {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

const FIB_20: usize = fibonacci(20); // computed at compile time: 6765

// Use in array sizes
const LOOKUP: [u8; 256] = {
    let mut table = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        table[i] = (i as u8).wrapping_mul(7);
        i += 1;
    }
    table
};
```

**Stable since Rust 1.82:** `const fn` supports `match`, loops, `if`, references, mutable locals — nearly full Rust. Use `const { }` blocks (Rust 1.79+) for inline compile-time assertions.

```rust
fn process<const N: usize>(data: &[u8; N]) {
    const { assert!(N > 0, "N must be positive") }; // compile-time panic if N == 0
    // ...
}
```

### const generics — Type-Level Values

```rust
struct Buffer<const N: usize> {
    data: [u8; N],
    len: usize,
}

impl<const N: usize> Buffer<N> {
    const fn new() -> Self {
        Self { data: [0; N], len: 0 }
    }

    fn push(&mut self, byte: u8) -> Result<(), BufferFullError> {
        if self.len >= N { return Err(BufferFullError); }
        self.data[self.len] = byte;
        self.len += 1;
        Ok(())
    }
}

// Compiler enforces: Buffer<16> and Buffer<32> are distinct types.
let small: Buffer<16> = Buffer::new();
let large: Buffer<1024> = Buffer::new();
```

### proc macros — Code Generation (Zig comptime type creation)

When `const fn` is not enough (generating struct fields, impl blocks, or derive logic), proc macros fill the gap.

```rust
// In a proc-macro crate:
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(Builder)]
pub fn derive_builder(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    // ... generate builder struct and impl
    TokenStream::from(quote! {
        impl #name {
            pub fn builder() -> #name##Builder { /* ... */ }
        }
    })
}
```

**Decision tree:**

```
Need compile-time value computation? → const fn
Need type parameterized by value?    → const generics
Need to generate new types/impls?    → proc macro (derive or attribute)
Need compile-time string processing? → proc macro
Need typenum-level arithmetic?       → typenum / generic-array (rare)
```

---

## 3. Zero-Allocation API Design — No Hidden Costs

Zig's philosophy: no operator overloading, no hidden allocation, every cost visible. Rust achieves this with discipline.

### Slice-Based APIs — Caller Owns Memory

```rust
// BAD: hidden allocation in return type
fn process(input: &str) -> String {
    input.to_uppercase() // allocates
}

// GOOD: caller provides output buffer, zero allocation
fn process(input: &[u8], output: &mut [u8]) -> usize {
    let len = input.len().min(output.len());
    for i in 0..len {
        output[i] = input[i].to_ascii_uppercase();
    }
    len // returns bytes written
}

// GOOD: return borrowed data when possible
fn find_token<'a>(input: &'a str) -> Option<&'a str> {
    input.split_whitespace().next() // no allocation — borrows from input
}
```

### try_* APIs — Fallible Allocation

```rust
// Allocation can fail explicitly (like Zig's allocator returning error)
let mut v = Vec::new();
v.try_reserve(1_000_000)?; // returns Result, not panic

// For Box:
let b = Box::try_new(42)?; // nightly, or use allocator_api
```

### SmallVec / ArrayVec — Stack-First Collections

```rust
use smallvec::SmallVec;
use arrayvec::ArrayVec;

// SmallVec: stack for small counts, heap spillover for large
let mut tags: SmallVec<[u8; 8]> = SmallVec::new();
tags.push(1); // on stack if <= 8 elements

// ArrayVec: purely stack, fixed capacity, no heap ever
let mut buf: ArrayVec<u8, 64> = ArrayVec::new();
buf.try_push(42).map_err(|_| "full")?; // returns error instead of panic
```

### Cow — Defer Allocation Until Mutation

```rust
use std::borrow::Cow;

fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains('\t') {
        Cow::Owned(input.replace('\t', "    ")) // allocates only when needed
    } else {
        Cow::Borrowed(input) // zero-cost pass-through
    }
}
```

### The #![no_std] Discipline

For maximum allocation control, go `#![no_std]`:

```rust
#![no_std]
extern crate alloc; // opt-in to heap when needed

use alloc::vec::Vec;      // explicit: I chose to allocate
use alloc::string::String; // explicit: I chose to allocate
```

Even in `std` code, the *mindset* applies: prefer `&[T]` over `Vec<T>` in function signatures, `&str` over `String`, `&Path` over `PathBuf`.

### Clippy Lints for Hidden Allocations

```toml
# Cargo.toml — catch accidental allocations
[lints.clippy]
# These warn on patterns that allocate when a borrow would suffice:
unnecessary_to_owned = "warn"       # .to_string() / .to_vec() when borrow works
redundant_clone = "warn"            # .clone() that's immediately consumed
large_stack_arrays = "warn"         # accidental large stack usage
vec_init_then_push = "warn"         # Vec::new() + push instead of vec![]
```

---

## 4. Bit-Level Layout — repr, Packed Structs, Bitfields

Zig: `packed struct` with bit-level field control. Rust matches with `#[repr]` attributes and bitfield crates.

### #[repr(C)] — Guaranteed C-Compatible Layout

```rust
#[repr(C)]
struct Header {
    magic: [u8; 4],
    version: u16,
    flags: u16,
    length: u32,
}
// Layout is C ABI: fields in declaration order, C padding rules.
// Safe to transmute from/to byte arrays via zerocopy.
```

### #[repr(C, packed)] — No Padding

```rust
#[repr(C, packed)]
struct WireHeader {
    tag: u8,
    length: u16, // NOT aligned to 2-byte boundary
    checksum: u32,
}
// Total size: exactly 7 bytes. No padding.
// WARNING: taking &self.length is UB if unaligned. Use read_unaligned or zerocopy.
```

**Safe access pattern:**

```rust
use std::ptr;

impl WireHeader {
    fn length(&self) -> u16 {
        // SAFETY: packed field may be unaligned; ptr::read_unaligned handles this.
        unsafe { ptr::read_unaligned(ptr::addr_of!(self.length)) }
    }
}

// Better: use zerocopy to avoid manual unsafe entirely
use zerocopy::{FromBytes, IntoBytes, KnownLayout, Immutable};

#[derive(FromBytes, IntoBytes, KnownLayout, Immutable)]
#[repr(C, packed)]
struct WireHeader {
    tag: u8,
    length: [u8; 2], // manual byte array avoids alignment issues
    checksum: [u8; 4],
}

impl WireHeader {
    fn length(&self) -> u16 { u16::from_le_bytes(self.length) }
    fn checksum(&self) -> u32 { u32::from_le_bytes(self.checksum) }
}
```

### bitfield — Bit-Level Flag Packing

```rust
use bitfield::bitfield;

bitfield! {
    pub struct Permissions(u8);
    impl Debug;
    pub bool, readable,  set_readable:  0;
    pub bool, writable,  set_writable:  1;
    pub bool, executable, set_executable: 2;
    pub u8,   level,     set_level:     5, 3; // bits 3-5
}

let mut p = Permissions(0);
p.set_readable(true);
p.set_level(5);
assert!(p.readable());
assert_eq!(p.level(), 5);
```

### modular-bitfield — Richer Bitfield API

```rust
use modular_bitfield::prelude::*;

#[bitfield(bits = 16)]
#[derive(Debug)]
pub struct StatusWord {
    ready: bool,           // 1 bit
    error_code: B4,        // 4 bits
    #[skip] __: B3,        // 3 bits padding
    priority: B8,          // 8 bits
}
```

### zerocopy — Safe Zero-Copy Parsing

```rust
use zerocopy::{FromBytes, IntoBytes, KnownLayout, Immutable, Ref};

#[derive(FromBytes, IntoBytes, KnownLayout, Immutable)]
#[repr(C)]
struct Packet {
    header: [u8; 4],
    payload_len: u32,
}

fn parse(bytes: &[u8]) -> Option<&Packet> {
    Ref::<_, Packet>::from_prefix(bytes).map(|(pkt, _rest)| pkt.into_ref()).ok()
}
// Zero-copy, zero-allocation, fully safe. No transmute, no pointer cast.
```

### Cargo.toml

```toml
zerocopy = { version = "0.8", features = ["derive"] }
bitfield = "0.17"
modular-bitfield = "0.11"
bytemuck = { version = "1", features = ["derive"] }  # alternative to zerocopy
```

---

## 5. Scope Guards — errdefer / Deterministic Cleanup

Zig's `errdefer` runs cleanup only on error paths. Rust's `Drop` always runs, but `scopeguard` gives fine-grained control.

### scopeguard — The errdefer Equivalent

```rust
use scopeguard::{defer, guard};
use std::fs;

fn create_and_process(path: &str) -> std::io::Result<()> {
    let file = fs::File::create(path)?;
    // If anything below fails, clean up the file.
    // This is exactly Zig's errdefer.
    let _cleanup = guard((), |_| {
        let _ = fs::remove_file(path);
    });

    write_data(&file)?;
    validate_data(path)?;

    // Success: defuse the guard so it does NOT run cleanup.
    std::mem::forget(_cleanup);
    Ok(())
}
```

### defer! — Always-Run Cleanup (like Zig's defer)

```rust
use scopeguard::defer;

fn with_temp_dir() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    defer! {
        // Runs when scope exits, success or failure.
        println!("Cleaning up {}", dir.path().display());
        // dir's Drop also cleans up, but this shows the pattern.
    }

    do_work(dir.path())?;
    Ok(())
}
```

### Drop as RAII Cleanup

```rust
struct TempFile { path: std::path::PathBuf }

impl TempFile {
    fn new(path: impl Into<std::path::PathBuf>) -> std::io::Result<Self> {
        let path = path.into();
        std::fs::File::create(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// Usage: file is auto-cleaned when `tmp` goes out of scope.
let tmp = TempFile::new("/tmp/scratch.dat")?;
```

### The errdefer Pattern — Defuse on Success

The key insight from Zig's `errdefer`: you want cleanup on error but NOT on success. In Rust:

```rust
use scopeguard::ScopeGuard;

fn deploy(artifact: &Path) -> Result<(), DeployError> {
    let backup = backup_current()?;

    // errdefer: restore backup if anything fails
    let rollback = guard(backup.clone(), |b| {
        let _ = restore_from_backup(&b);
    });

    upload(artifact)?;
    health_check()?;

    // Success path: defuse the rollback guard
    ScopeGuard::into_inner(rollback);
    Ok(())
}
```

### Cargo.toml

```toml
scopeguard = "1"
tempfile = "3"  # idiomatic RAII temp files/dirs
```

---

## Summary: Zig Advantage → Rust Pattern

| Zig Feature | Rust Equivalent | Difficulty | Reference |
|---|---|---|---|
| Explicit allocator passing | `bumpalo` / `typed-arena` / `allocator_api` | Easy | §1 |
| `comptime` value computation | `const fn` + `const { }` blocks | Easy | §2 |
| `comptime` type generation | proc macros (derive / attribute) | Medium | §2 |
| No hidden allocations | `#![no_std]` / slice-based APIs / `Cow` | Style choice | §3 |
| `packed struct` / bitfields | `#[repr(C, packed)]` / `bitfield` / `zerocopy` | Easy | §4 |
| `errdefer` | `scopeguard::guard` + defuse on success | Easy | §5 |
| `defer` | `scopeguard::defer!` / `Drop` | Easy | §5 |

All achievable within Rust's single toolchain. You get Zig's explicitness **plus** the borrow checker, lifetime analysis, trait bounds, and `miri`. The combination is strictly more powerful than either alone.

## When NOT to Use These Patterns

- **Arena allocation** overkill for simple CLI tools that allocate once and exit.
- **Zero-alloc APIs** hurt readability when the function naturally produces owned data. Don't force `&mut [u8]` output buffers on a function that logically returns `String`.
- **`#[repr(packed)]`** only for wire formats and FFI. Never for regular domain types.
- **Scope guards** unnecessary when `Drop` on the value itself handles cleanup (e.g., `tempfile::NamedTempFile` already does this).
- **`const fn`** everything? No — only when the value is genuinely needed at compile time or the function is trivially const-eligible. Don't contort logic just to be const.

The goal is **visible costs and explicit control**, not asceticism. Use `String` and `Vec` freely when they're the right tool. Reach for these patterns when allocation behavior matters for correctness or performance.
