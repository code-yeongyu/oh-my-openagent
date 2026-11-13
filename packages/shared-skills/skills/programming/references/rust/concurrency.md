# Concurrency Primitives

Locks, atomics, channels, and the loom model checker. The decision tree that keeps the agent out of soundness trouble.

## The pyramid

```
Highest level          tokio::sync::mpsc / broadcast / watch
                       (message passing — default for new code)

                       Arc<Mutex<T>> / Arc<RwLock<T>>
                       (shared mutable state — common, easy to get right)

                       std::sync / parking_lot::{Mutex, RwLock, Condvar}
                       (sync locks for critical sections without .await)

                       Atomics (AtomicUsize, AtomicBool, AtomicPtr)
                       (single-word lock-free state)

Lowest level           UnsafeCell + unsafe + loom + miri
                       (custom lock-free / wait-free primitives)
```

**Always start at the top.** Drop a level only when you have measured a real bottleneck.

## Decision tree

```
Need to share state between tasks?
├── State is configuration (read-only after start)
│   └── Arc<Config>  (no lock needed)
├── State is a queue of work
│   └── tokio::sync::mpsc::channel(cap)
├── State is "latest value" published to many readers
│   └── tokio::sync::watch::channel(initial)
├── State is broadcast (every consumer sees every value)
│   └── tokio::sync::broadcast::channel(cap)
├── State is request-response within one task tree
│   └── tokio::sync::oneshot::channel()
├── State is a counter
│   └── AtomicU64 (or AtomicUsize)
├── State is a flag / set-once
│   └── AtomicBool / OnceLock<T> / OnceCell<T>
├── State needs mutation across many tasks/threads, cheap critical sections
│   ├── async context           → tokio::sync::Mutex<T>
│   └── sync context (no .await held) → std::sync::Mutex<T> / parking_lot::Mutex<T>
├── State needs mutation, many readers, few writers
│   ├── async context           → tokio::sync::RwLock<T>
│   └── sync context            → std::sync::RwLock<T> / parking_lot::RwLock<T>
└── State is a custom lock-free primitive (channels, hazard pointers)
    └── UnsafeCell + atomics + loom-tested + miri-tested + a co-author
```

## Atomics — when and how

Use atomics for:
- Counters incremented from many threads (`AtomicU64`).
- Single-shot flags (`AtomicBool`).
- Pointer publication (`AtomicPtr<T>`).

### Memory orderings

```rust
use std::sync::atomic::{AtomicUsize, Ordering};

let c = AtomicUsize::new(0);

// Just need a count, no synchronization with other data
c.fetch_add(1, Ordering::Relaxed);

// Reading a counter that was incremented from elsewhere
let n = c.load(Ordering::Relaxed);
```

| Ordering | When |
|---|---|
| `Relaxed` | Standalone counters, no other memory needs to be synchronized. |
| `Acquire` (loads) / `Release` (stores) | Publish/consume pattern: you write some data then release a flag, readers acquire the flag then read the data. |
| `AcqRel` | RMW that both reads-and-publishes (e.g., `fetch_add` on a sequence number). |
| `SeqCst` | Total ordering across all `SeqCst` ops. Strongest, slowest. Use when in doubt and switch to a weaker ordering after testing under loom. |

**Default to `SeqCst` if unsure.** Performance difference is usually negligible. Going weaker requires loom.

### Publish-then-load pattern

Write data, then `store(true, Release)` a flag; a reader that `load(Acquire)`s `true` is guaranteed to see the data written before the store. Do not hand-roll it around a `static mut` (the 2024 edition denies references to one, and every access is `unsafe`): `OnceLock<T>` is exactly this pattern behind a safe API.

```rust
static CONFIG: std::sync::OnceLock<Config> = std::sync::OnceLock::new();

// Producer, once:  CONFIG.set(cfg) returns Err(cfg) if already set.
// Consumer:        CONFIG.get() is Some only after the publishing set completed.
```

## Std vs parking_lot vs tokio for locks

| | std::sync::Mutex | parking_lot::Mutex | tokio::sync::Mutex |
|---|---|---|---|
| Speed | Fast (futex-based since 1.62) | Fast (adaptive spinning, smaller) | Slower (await-aware) |
| Poisoning | Yes (`PoisonError`) | No | No |
| Hold across `.await` | Dangerous (deadlock under current-thread runtime) | Dangerous | Safe |
| Drop guard releases | Yes | Yes | Yes |
| RAII | Yes (`MutexGuard`) | Yes | Yes |
| Const constructor | Yes (since 1.63) | Yes | No |
| Async | No | No | Yes |

**Rule of thumb:**

- Short critical section, no await inside → `std::sync::Mutex`, or `parking_lot::Mutex` when the crate already depends on it or you want no poisoning. Neither is universally faster; measure before switching for speed.
- Shared state held across `.await` → `tokio::sync::Mutex`.
- Static init / app config → `OnceLock` or `LazyLock`.
- A `PoisonError` from `std` means another thread panicked mid-update; propagate it or recover the data deliberately with `into_inner()`, never `unwrap()` it away.

### Common deadlock — async + sync mutex

```rust
let m = parking_lot::Mutex::new(0u64);
let mut guard = m.lock();
something_async().await;  // WRONG: guard is held across await
*guard += 1;
```

Under `current_thread` runtime this deadlocks (the future suspends while holding the lock; another future on the same thread tries to acquire, blocks the executor). Under `multi_thread` it works but serializes the system.

Fix:

```rust
{
    let mut guard = m.lock();
    *guard += 1;
}  // guard released
something_async().await;
```

Or switch to `tokio::sync::Mutex` whose guard is `Send` across awaits.

## Channels

### Mpsc — the workhorse

```rust
let (tx, mut rx) = tokio::sync::mpsc::channel::<Job>(256);

tokio::spawn(async move {
    while let Some(job) = rx.recv().await {
        process(job).await;
    }
});

tx.send(Job::new()).await?;  // backpressure: awaits if full
```

Capacity is the backpressure budget. **Never `unbounded_channel()`** unless you have a hard upper bound elsewhere; otherwise it is a slow-leak memory bomb.

### Watch — latest-value pubsub

```rust
let (tx, mut rx) = tokio::sync::watch::channel(Config::default());

// Producer:
tx.send(new_config)?;

// Consumer:
loop {
    rx.changed().await?;
    let cfg = rx.borrow_and_update().clone(); // release the read lock before any .await
    apply(&cfg).await;
}
```

Receivers see only the latest value (older updates are dropped). Perfect for config reload, leadership changes, "current time" propagation. The `borrow()` guard blocks the sender while held; never keep it across an `.await`.

### Broadcast — fanout queue

```rust
let (tx, _) = tokio::sync::broadcast::channel::<Event>(1024);
let mut rx1 = tx.subscribe();
let mut rx2 = tx.subscribe();

while let Ok(event) = rx1.recv().await {
    // ...
}
```

Each subscriber has its own buffer. If a subscriber falls behind by more than the buffer size, it gets `RecvError::Lagged(n)` and skips messages. Decide explicitly: log + continue, or drop the subscriber and reconnect.

### Oneshot — single value

```rust
let (tx, rx) = tokio::sync::oneshot::channel::<Response>();
worker.send(Request { reply: tx }).await?;
let response = rx.await?;
```

The standard request/response pattern over an actor.

## Semaphores

Bound concurrent operations:

```rust
let sem = Arc::new(tokio::sync::Semaphore::new(10));
let mut set = tokio::task::JoinSet::new();

for task in tasks {
    let permit = Arc::clone(&sem).acquire_owned().await?;
    set.spawn(async move {
        let _hold = permit;       // released when task exits
        process(task).await
    });
}
```

Use cases:
- "Max 10 outbound HTTP requests in flight."
- "Max 3 DB connections doing writes."
- "Max N tokio tasks running heavy CPU."

A semaphore with `permits=1` is a mutex. Use the actual `Mutex` for that — clearer intent.

## Arc and Rc

`Arc<T>` for cross-thread shared ownership, `Rc<T>` for single-thread (never spans threads).

```rust
let shared = Arc::new(BigData::new());
let mut set = tokio::task::JoinSet::new();
for _ in 0..workers {
    let s = Arc::clone(&shared);
    set.spawn(async move { use_data(&s).await });
}
```

`Arc::clone(&s)` is just a reference-count increment; the data is not copied. Write it as `Arc::clone(&x)`, never `x.clone()` (`clone_on_ref_ptr`), so a deep clone never hides behind the same spelling.

**Do not clone in hot loops** if you can pass a reference. `&Arc<T>` is fine to pass; only call `Arc::clone` when you need to move ownership across a thread/task boundary.

`Weak<T>` for back-references in graphs / parent pointers to avoid cycles.

## Once-init primitives

```rust
use std::sync::LazyLock;

// Lazy initialization of an infallible value, computed on first read
static WORD_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    #[expect(clippy::expect_used, reason = "literal pattern; covered by a unit test")]
    regex::Regex::new(r"\w+").expect("valid regex literal")
});

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Fallible setup happens in main, where `?` reports it; pass the result down
    // as a parameter instead of reaching for a global.
    let config = Config::load_from_env()?;
    let pool = sqlx::PgPool::connect(&config.database_url).await?;
    run(&config, &pool).await
}
```

`LazyLock` runs its closure on first access, where no caller can handle an error, so it holds only values that cannot fail at runtime. `OnceLock` and `LazyLock` are in `std::sync` (1.70 / 1.80); avoid `once_cell` and `lazy_static!` for new code.

## Loom — model-checking lock-free code

When `unsafe` participates in a concurrent algorithm, miri's single-thread model is insufficient. Loom exhaustively explores thread interleavings.

`Cargo.toml`:

```toml
[target.'cfg(loom)'.dev-dependencies]
loom = "0.7"
```

In code, switch between real and loom primitives:

```rust
#[cfg(loom)]
use loom::sync::atomic::{AtomicUsize, Ordering};
#[cfg(not(loom))]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(loom)]
use loom::sync::Arc;
#[cfg(not(loom))]
use std::sync::Arc;
```

Write a test:

```rust
#[cfg(loom)]
mod loom_tests {
    use super::*;
    use loom::thread;

    #[test]
    fn concurrent_push_pop_preserves_order() {
        loom::model(|| {
            let queue = Arc::new(MyQueue::new());
            let q1 = Arc::clone(&queue);
            let q2 = Arc::clone(&queue);
            let h1 = thread::spawn(move || q1.push(1));
            let h2 = thread::spawn(move || q2.pop());
            h1.join().unwrap();
            h2.join().unwrap();
            // Assert the invariant: queue is in a coherent state.
        });
    }
}
```

Run:

```bash
RUSTFLAGS="--cfg loom" cargo test --release -- --test-threads 1
```

Loom systematically explores the thread interleavings its model allows (bounded by `LOOM_MAX_PREEMPTIONS`), including those a real scheduler would rarely produce, and replays a failing schedule deterministically. It is strong evidence within that bound, not a proof over unbounded executions.

### Loom's limits

- Slow. Each `loom::model` invocation explores many schedules; keep tests tiny (2-3 threads, a few operations each).
- Single-machine only. Doesn't model distributed systems.
- Doesn't catch UB inside `unsafe` blocks the way miri does. **Run both: miri for memory safety, loom for thread schedules.**
- Doesn't handle `tokio` directly. Loom replaces stdlib's sync primitives; tokio's are independent.

## Scoped threads and per-thread state

For a fixed number of short-lived threads that borrow local data, `std::thread::scope` joins every thread before it returns, so no `Arc` or `'static` bound is needed:

```rust
let (left, right) = data.split_at(data.len() / 2);
let (a, b) = std::thread::scope(|s| {
    let a = s.spawn(|| checksum(left));
    let b = s.spawn(|| checksum(right));
    (a.join(), b.join())
});
// a and b are Result<_, panic payload>: a panicked thread surfaces here
```

For data-parallel work over a collection, `rayon`'s `par_iter()` is simpler. Per-thread scratch state (a reusable buffer, a per-thread RNG) is `thread_local!` with `Cell` / `RefCell`, never a `static mut`:

```rust
thread_local! {
    static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}
SCRATCH.with_borrow_mut(|buf| { buf.clear(); encode_into(buf, msg) });
```

## Send and Sync — what they mean

- `T: Send` — `T` can be moved between threads safely.
- `T: Sync` — `&T` can be shared between threads safely.

These are auto-derived for composite types if all components implement them. Manual `unsafe impl Send/Sync` is required only for raw pointer types and FFI handles.

```rust
struct MyHandle { raw: *mut FfiObject }

// SAFETY: FfiObject's documented contract states that move-between-threads
// is safe as long as concurrent use is externally synchronized. We do not
// implement Sync because the FFI object is single-threaded once obtained.
unsafe impl Send for MyHandle {}
// Do NOT impl Sync — the FFI is not thread-safe.
```

When the compiler complains that "T: Send is not satisfied", the cause is usually a raw pointer, an `Rc` (not `Arc`), or a `RefCell` (use `Mutex`).

## Common mistakes

1. **Holding a `std::sync::Mutex` guard across `.await`.** Compiles, deadlocks at runtime under `current_thread`.
2. **`Arc::clone` in a tight loop.** Refcount bump is cheap but not free; pass `&Arc<T>` when possible.
3. **`Mutex<HashMap<K, V>>` for hot reads.** Switch to `RwLock` or `Arc<dashmap::DashMap>`.
4. **Atomic operations with `Ordering::Relaxed` for happens-before publication.** You need `Release`/`Acquire`. Run under loom to be sure.
5. **Unbounded channels.** Always set capacity. If you "know it won't backlog", you don't, and it will.
6. **Spawning detached tokio tasks for fire-and-forget cleanup.** Use `JoinSet` so panics surface.
7. **`std::mem::transmute` to fake `Send`/`Sync`.** Use `unsafe impl` with a SAFETY comment instead. Transmute breaks Stacked Borrows and miri.
8. **Locking order inversion across two mutexes.** Always acquire in a globally consistent order. For more than three locks, switch to a single mutex around a struct.

## When to escape to lock-free

You should reach for atomics + `UnsafeCell` only when:
1. The hot path is **measured** to be bottlenecked on lock contention.
2. There is no existing library (crossbeam, atomic-queue, hazardous) that solves your problem.
3. You can write loom tests that pass.
4. You can write miri tests that pass.
5. You have at least one other engineer who can review the algorithm.

Practically all "I want to write a lock-free queue" projects fail (3) or (4). When in doubt, take the lock and move on.
