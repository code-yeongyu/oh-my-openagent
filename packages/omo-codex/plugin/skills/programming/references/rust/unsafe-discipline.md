# Unsafe Discipline

The reason Chris Allen's "implementing a persistent memory arena in Rust was not hard" works: the unsafe surface area is microscopic, it lives behind one newtype with one constructor, and every block has a SAFETY comment that names a specific invariant. Coding agents follow the pattern mechanically once the shape is established.

## The Three Required Components

Every `unsafe` block needs all three. No exceptions.

1. **Safe wrapper.** No `unsafe fn` or raw pointer types in the crate's public API. If a caller needs to construct an instance, the constructor either does the work safely or is `unsafe` with a documented contract.
2. **SAFETY comment.** A `// SAFETY:` line within 5 lines above the `unsafe { ... }` block, stating which invariant is upheld and where it comes from. Generic phrases ("this is safe because we checked") fail review.
3. **miri proof.** A test that exercises the unsafe path under `cargo +nightly miri nextest run`. If the path cannot be exercised under miri (FFI, syscalls), provide an alternate proof and gate behind a feature flag ending in `-skip-miri`.

## The Wrapper Pattern (`NonNull<T>` style)

Reference the screenshot Chris Allen quoted - `std::ptr::NonNull<T>`. Mirror this shape for every raw pointer, raw slice, raw transmute, or uninit memory operation in your own code.

```rust
use core::marker::PhantomData;
use core::ptr::NonNull;

/// A non-null, properly aligned, initialized pointer that does not alias.
///
/// All invariants are upheld by [`Self::new`] (checked) or [`Self::new_unchecked`]
/// (delegated to the caller's contract). Once you hold an `InitPtr<T>`, every
/// public method on it is safe to call.
#[derive(Debug)]
#[repr(transparent)]
pub struct InitPtr<T> {
    inner: NonNull<T>,
    _marker: PhantomData<T>,
}

// Send/Sync are NOT automatic for raw-pointer-bearing types. Decide deliberately.
// SAFETY: `InitPtr<T>` owns no concurrency state of its own; whether it is
// Send/Sync depends on `T`. The bounds below mirror `Box<T>`.
unsafe impl<T: Send> Send for InitPtr<T> {}
unsafe impl<T: Sync> Sync for InitPtr<T> {}

impl<T> InitPtr<T> {
    /// Wrap a raw pointer after checking alignment and non-null. The
    /// initialization invariant is not statically checkable here; callers must
    /// only feed pointers to memory that was written before this call.
    pub fn new(ptr: *mut T) -> Option<Self> {
        if !ptr.is_aligned() {
            return None;
        }
        // SAFETY: alignment checked above; `NonNull::new` filters null. The
        // caller is documented to provide an initialized location.
        NonNull::new(ptr).map(|inner| Self { inner, _marker: PhantomData })
    }

    /// Wrap a raw pointer the caller asserts is valid.
    ///
    /// # Safety
    ///
    /// - `ptr` is non-null.
    /// - `ptr` is aligned to `align_of::<T>()`.
    /// - `*ptr` is initialized at the time of this call.
    /// - For the lifetime of the returned value, no other `&T` or `&mut T`
    ///   aliases `*ptr`.
    pub unsafe fn new_unchecked(ptr: *mut T) -> Self {
        // SAFETY: caller upholds non-null per the function contract.
        Self { inner: unsafe { NonNull::new_unchecked(ptr) }, _marker: PhantomData }
    }

    pub fn as_ref(&self) -> &T {
        // SAFETY: the constructor's invariants guarantee `inner` points at an
        // initialized, aligned, non-aliased `T`. Reborrowing through `&self`
        // ties the resulting lifetime to `self`, enforcing the rest via
        // standard borrow rules.
        unsafe { self.inner.as_ref() }
    }

    pub fn as_mut(&mut self) -> &mut T {
        // SAFETY: `&mut self` proves no other reference can alias `inner` for
        // the lifetime of the returned `&mut T`; remaining invariants come
        // from construction.
        unsafe { self.inner.as_mut() }
    }
}
```

The list of features this single shape gives you:

- The agent cannot construct `InitPtr<T>` without going through a checked path or accepting the `unsafe` obligation explicitly.
- The agent cannot leak the raw pointer; `as_ref` / `as_mut` return safe references with proper lifetimes.
- The agent cannot accidentally Send/Sync where it shouldn't - the `unsafe impl` is explicit per-bound.
- `#[repr(transparent)]` means the type is layout-compatible with `*mut T` for FFI, without exposing the raw pointer.

## SAFETY Comment Grammar

Every comment maps one-to-one to an invariant. Format:

```rust
// SAFETY: <which invariant is upheld>: <how it is established here>.
```

Anti-examples (do not pass review):

```rust
// SAFETY: this is fine
// SAFETY: we know what we're doing
// SAFETY: the caller will not pass null
// SAFETY: tested
```

Good examples:

```rust
// SAFETY: `len <= self.capacity` was checked at line 87 and `self.ptr` was
// allocated by the same allocator we are reading through.

// SAFETY: `read_volatile` requires alignment and non-null; both hold because
// `self.inner` is an `InitPtr<T>` whose constructor enforced them.

// SAFETY: We hold `&mut self`, so no concurrent reader exists. The slice
// reference is dropped before the next `&self` borrow because we shrink the
// returned scope manually.
```

## Persistent Memory Arena Pattern (the Chris Allen example)

A persistent memory arena (PMA) is an `mmap`-backed bump allocator that survives process restarts. It is the classic "lots of unsafe under one safe surface" project.

Shape:

```rust
pub struct Arena {
    map: Mmap,          // wraps `mmap(2)` - safe wrapper from `memmap2` crate
    head: AtomicUsize,  // current bump offset, atomic for multi-writer if needed
}

impl Arena {
    pub fn open(path: &Path, capacity: usize) -> std::io::Result<Self> { /* mmap, init header */ }

    pub fn alloc<T>(&self, value: T) -> Result<Handle<T>, ArenaFull> {
        let layout = Layout::new::<T>();
        let aligned = align_up(self.head.load(Acquire), layout.align());
        let next = aligned.checked_add(layout.size()).ok_or(ArenaFull)?;
        if next > self.map.len() { return Err(ArenaFull); }
        // CAS the head forward; retry on contention.
        // ... omitted for brevity ...

        // SAFETY: `aligned + layout.size() <= self.map.len()` was just proven.
        // The mmap region is exclusively owned by this arena while we hold the
        // bump. `aligned` is aligned to `layout.align()` by `align_up`. No
        // other writer can have observed this offset because the CAS above
        // returned `Ok`.
        let ptr = unsafe { self.map.as_mut_ptr().add(aligned) as *mut T };
        // SAFETY: `ptr` is non-null (mmap base + offset), aligned (above),
        // exclusively owned (CAS), and we are about to initialize it.
        unsafe { ptr::write(ptr, value) };

        // SAFETY: same invariants; we wrap the now-initialized pointer in the
        // safe handle which encapsulates further accesses.
        Ok(unsafe { Handle::new_unchecked(ptr, self) })
    }
}

pub struct Handle<'a, T> {
    inner: InitPtr<T>,
    _arena: PhantomData<&'a Arena>,
}
```

Three `unsafe` blocks, three SAFETY comments, one safe handle type emerging on the other side. The agent now uses `Handle<T>` everywhere - never `*mut T`.

## Miri Invocation

```bash
# install once
rustup install nightly
rustup component add miri rust-src --toolchain nightly

# run on every change that touches unsafe
MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-symbolic-alignment-check" \
  cargo +nightly miri nextest run --all-features
```

What miri catches that the borrow checker cannot:

- Use-after-free
- Double-free
- Reads of uninitialized memory
- Pointer-from-integer reconstruction that violates strict provenance
- Alignment lies (transmuting unaligned data)
- Stacked borrows / Tree borrows aliasing violations
- Data races (single-threaded model, but catches concurrent access through `UnsafeCell` misuse)
- Atomic ordering bugs in some patterns
- Memory leaks (with `-Zmiri-track-pointer-tag`)

## When Miri Cannot Run

Certain paths are off-limits for miri: most syscalls beyond a curated allowlist, real network I/O, `std::process` calls, OS-specific FFI, hardware-dependent intrinsics on non-x86. Strategy:

1. **Isolate.** Put the un-mirifiable code in its own module behind `#[cfg(feature = "ffi-real")]` or similar.
2. **Mock at the boundary.** For everything below the FFI boundary, write a safe Rust fake (a `Vec<u8>`-backed "disk", a fake clock, an in-memory socket pair). Expose it as a trait the production code consumes.
3. **Test the fake under miri.** The fake implementation exercises the same logic minus the syscall. If the logic is unsafe (raw pointer manipulation in the fake "disk" buffer), miri catches the bug.
4. **Test the real path under regular `cargo test`.** With `cargo nextest run --features ffi-real`. No miri, but the surface area is now just the syscall boundary.
5. **Document.** A `# Safety` section in the rustdoc names the obligations the FFI puts on us, and a `# Testing` section explains the mock-vs-real split.

## Loom for Concurrency

When `unsafe` participates in a concurrent algorithm (lock-free queue, hazard pointers, custom Arc), miri's single-thread model is insufficient. Use `loom`:

```rust
#[cfg(loom)]
use loom::sync::atomic::{AtomicUsize, Ordering};
#[cfg(not(loom))]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(loom)]
    fn concurrent_push_pop() {
        loom::model(|| {
            let queue = std::sync::Arc::new(MyQueue::new());
            let q1 = queue.clone();
            let q2 = queue.clone();
            let h1 = loom::thread::spawn(move || q1.push(1));
            let h2 = loom::thread::spawn(move || q2.pop());
            h1.join().unwrap();
            h2.join().unwrap();
        });
    }
}
```

Run: `RUSTFLAGS="--cfg loom" cargo test --release`. Loom exhaustively explores thread interleavings for the test scope. Combined with miri on the single-thread paths, you have machine-checked soundness over the full state space.

## The Forbidden List

Reject in code review, automatic CI fail:

- `unsafe { ... }` with no SAFETY comment within 5 lines above.
- `unsafe { unsafe_op_a(); unsafe_op_b(); }` (multiple unsafe ops in one block - split them, one SAFETY each). Clippy: `multiple_unsafe_ops_per_block`.
- `unsafe fn` exposed publicly without a documented `# Safety` section in rustdoc.
- `std::mem::transmute` for anything but lifetime extension on the same layout (and that should usually be `core::mem::transmute_copy` or `bytemuck::cast` if the relayout is well-defined).
- `std::ptr::read_unaligned` / `write_unaligned` without a comment explaining why aligned access is impossible.
- `from_raw_parts` / `from_raw_parts_mut` without proving the source pointer's provenance covers the entire slice.
- `Arc::get_mut_unchecked`, `Box::leak` to bypass ownership, `MaybeUninit::assume_init` on partially-initialized data.
- `unsafe impl Send`, `unsafe impl Sync` on types containing raw pointers, without a comment naming exactly which interior-mutability rule is upheld.
- Any `unsafe` block whose justification depends on "in practice this never happens".

## The One-Line Summary

> Wrap once. Prove once. Test under miri. Never let `unsafe` escape.
