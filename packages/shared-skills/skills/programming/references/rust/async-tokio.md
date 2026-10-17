# Async with Tokio

Structured concurrency, cancellation, blocking-work isolation, channel selection. The patterns the agent should reach for by default.

## Runtime selection

```rust
// Default for services and CLIs that do real work: multi-thread, one worker per core
#[tokio::main]
async fn main() -> anyhow::Result<()> { ... }

// For tiny CLIs or wasm where you measured single-thread is enough
#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> { ... }
```

Keep the default worker count. Set `worker_threads` only for a measured reason or a deployment constraint (a container CPU quota the runtime cannot see, a desktop tool sharing the machine). CPU-heavy work does not get more workers; it leaves the runtime (see Blocking work).

## Spawning

`tokio::spawn` returns a `JoinHandle<T>`. The future runs to completion even if the handle is dropped (detached). To enforce structured concurrency, use `JoinSet`:

```rust
use tokio::task::JoinSet;

let mut set = JoinSet::new();
for url in urls {
    let client = client.clone();
    set.spawn(async move { fetch(&client, &url).await });
}

let mut results = Vec::new();
while let Some(joined) = set.join_next().await {
    match joined {
        Ok(Ok(body)) => results.push(body),
        Ok(Err(error)) => tracing::warn!(%error, "fetch failed"),
        Err(panicked) if panicked.is_panic() => {
            tracing::error!(?panicked, "worker panicked");
            // Choose: re-raise, or continue with degraded result set.
        }
        Err(other) => tracing::error!(?other, "worker join error"),
    }
}
```

`JoinSet`:
- Knows when all spawned tasks finish.
- Dropping the set aborts every still-running task.
- Lets you handle failures one by one rather than all-or-nothing.

For a fixed set of independent futures, `join!` waits for all; for fallible ones, `try_join!` returns on the first `Err`:

```rust
let (a, b, c) = tokio::try_join!(load_a(), load_b(), load_c())?;
```

On that first error `try_join!` drops the other futures mid-flight. Dropping is cancellation, not rollback: side effects they already started stay started (see Cancellation).

For first-of-many, `select!`:

```rust
tokio::select! {
    biased;  // bias to top-to-bottom checking when ordering matters
    _ = shutdown.recv() => {
        tracing::info!("shutdown signal");
        return Ok(());
    }
    request = listener.accept() => {
        handle_request(request?).await?;
    }
}
```

Without `biased`, branches are polled in random order each iteration (good for fairness). Use `biased` only when you need deterministic priority (shutdown signal first, etc).

## Cancellation

A future is cancelled when it is dropped (e.g., the `select!` arm wins another branch). **Always think: if this future is dropped mid-await, what state is left behind?**

Cancel-safe futures (you can drop them without losing data):
- `recv()` on channels, `accept()` on listeners
- `changed()` / `wait_for` on `watch::Receiver`
- `AsyncReadExt::read` / `read_buf`: bytes land in your buffer only when the call completes

Cancel-unsafe futures (dropping mid-way loses data or leaves partial state):
- `read_exact`, `read_to_end`, `read_to_string`: bytes already read are gone
- `write_all` / `write_all_buf`: an unknown prefix was already written
- Custom futures that perform side effects before suspending

Tokio documents cancel safety per method; check it for every future used as a `select!` branch in a loop. When an operation is cancel-unsafe, keep its progress outside the future (a buffer that lives across loop iterations) or move it into its own task. If your own function is cancel-unsafe, document it in a rustdoc `# Cancel Safety` section.

Cooperative cancellation of a whole task tree uses `tokio_util::sync::CancellationToken`: tasks watch the token and exit at a point they choose, so cleanup runs.

```rust
use tokio_util::sync::CancellationToken;

let token = CancellationToken::new();
let child = token.child_token();
tokio::spawn(async move {
    tokio::select! {
        _ = child.cancelled() => { /* clean up */ }
        result = work() => { /* normal */ }
    }
});
// later
token.cancel();
```

Pass child tokens down the call tree so the whole tree can be cancelled together.

## Timeouts

```rust
use tokio::time::{timeout, Duration};

match timeout(Duration::from_secs(5), fetch(url)).await {
    Ok(Ok(body)) => Ok(body),
    Ok(Err(error)) => Err(error.into()),
    Err(_elapsed) => Err(anyhow::anyhow!("timed out fetching {url}")),
}
```

Set timeouts on every external I/O boundary. Defaults of "wait forever" are bugs.

## Blocking work

NEVER block inside an async task. Symptoms: deadlock, every future stalled, latency cliffs.

Heavy CPU or sync I/O → `spawn_blocking`:

```rust
let result = tokio::task::spawn_blocking(|| {
    // CPU-bound: parsing, hashing, image processing
    // Or sync I/O: rusqlite, OS APIs without async wrappers
    expensive_pure_computation()
}).await?;
```

Sustained CPU parallelism → a dedicated pool (`rayon`), not tokio's blocking pool, which is sized for many short blocking calls. The same rule covers the blocking std APIs that look harmless inside `async fn`: `std::thread::sleep` (use `tokio::time::sleep`), `std::fs::*` (use `tokio::fs`, or batch it into one `spawn_blocking`), and `blocking_recv` / `blocking_lock` (they panic inside a runtime).

## Channels

| Need | Use |
|---|---|
| 1-many producers → 1 consumer, async | `tokio::sync::mpsc::channel(cap)` |
| Same as above, both sync + async | `flume::bounded(cap)` |
| 1 → many fan-out, latest-value semantics | `tokio::sync::watch::channel(initial)` |
| 1 → many fan-out, queued | `tokio::sync::broadcast::channel(cap)` |
| One-shot reply | `tokio::sync::oneshot::channel()` |
| Backpressure-driven stream of items | `tokio::sync::mpsc::Receiver` + `ReceiverStream` |

Mpsc pattern:

```rust
let (tx, mut rx) = tokio::sync::mpsc::channel::<Job>(256);

tokio::spawn(async move {
    while let Some(job) = rx.recv().await {
        if let Err(error) = process(job).await {
            tracing::warn!(%error, "job failed");
        }
    }
    tracing::info!("queue closed, shutting down worker");
});

tx.send(Job { ... }).await?;  // blocks if full, applies backpressure
```

Always bound channels. Unbounded channels are a memory leak waiting to happen.

## Streams

`futures::Stream` is the async analogue of `Iterator`. Use it for paginated fetches, long-poll responses, file lines.

```rust
use futures::stream::{StreamExt, TryStreamExt};

let urls: Vec<String> = ...;
let bodies: Vec<String> = futures::stream::iter(urls)
    .map(|url| async move { fetch(&url).await })
    .buffer_unordered(8)  // up to 8 in flight
    .try_collect()
    .await?;
```

`buffer_unordered(n)` is the throttle. Use it instead of spawning N tasks manually.

For producing a stream from a channel:

```rust
use tokio_stream::wrappers::ReceiverStream;

let (tx, rx) = tokio::sync::mpsc::channel::<Event>(64);
let stream = ReceiverStream::new(rx);
serve_sse(stream).await
```

## Graceful shutdown

```rust
use tokio::signal;

/// Resolves on Ctrl-C or SIGTERM. A signal source that cannot be installed is
/// logged and never fires, so the other source still works.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = signal::ctrl_c().await {
            tracing::error!(%error, "cannot listen for ctrl-c");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut sigterm) => { sigterm.recv().await; }
            Err(error) => {
                tracing::error!(%error, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let token = CancellationToken::new();
    let server = tokio::spawn(run_server(token.child_token()));
    shutdown_signal().await;
    token.cancel();
    match tokio::time::timeout(Duration::from_secs(10), server).await {
        Ok(joined) => joined??, // JoinError (panic) and the server's own error both surface
        Err(_elapsed) => tracing::warn!("server did not stop within 10s"),
    }
    Ok(())
}
```

Pattern: catch signal → cancel a token shared with the server → server's `select!` arms see the cancel and exit cleanly → wait with a timeout so a hung worker can't deadlock shutdown.

## Concurrency primitives

- `tokio::sync::Mutex` — async mutex. Use for state shared between async tasks. **Do not hold across `.await` without thinking** (you'll serialize the whole system).
- `tokio::sync::RwLock` — async read-write lock. Same caveat.
- `std::sync::Mutex` / `parking_lot::Mutex` — sync mutex for a critical section that never spans an `.await` (see [concurrency.md](concurrency.md) for choosing between them).
- Nothing guard-like lives across an `.await`: not a sync lock guard, not a `watch` borrow ([concurrency.md](concurrency.md)), not a `span.enter()` guard. Instrument the future instead: `fut.instrument(span).await`.
- `tokio::sync::Semaphore` — bound concurrent operations. Perfect for "max 10 in-flight HTTP requests" or "max 3 DB writers".

```rust
let sem = Arc::new(tokio::sync::Semaphore::new(10));
let mut set = JoinSet::new();
for url in urls {
    let permit = Arc::clone(&sem).acquire_owned().await?;
    set.spawn(async move {
        let _permit = permit;  // released on task end
        fetch(&url).await
    });
}
```

## Common mistakes

1. **Holding a sync mutex across `.await`.** Compiles and runs, deadlocks at scale. Solution: refactor to release before await, or use `tokio::sync::Mutex`.
2. **Forgetting `?` on `JoinHandle`.** A panicked task returns `Err(JoinError)`; if you `.await` and ignore, panics are silently swallowed.
3. **`tokio::spawn` instead of `JoinSet`.** Detached tasks survive past their parent, causing leaks. Default to `JoinSet` for structured concurrency.
4. **Unbounded channels.** Always set a capacity.
5. **`block_on` inside an async context.** Causes deadlock under `current_thread` runtime, performance cliff under `multi_thread`.
6. **CPU-heavy work in async fn.** Move to `spawn_blocking` or `rayon`.
7. **No timeout on external I/O.** Every `await` that touches the network or filesystem needs `tokio::time::timeout` wrapping.

## Testing async code

```rust
#[tokio::test]
async fn fetches_and_parses() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .respond_with(wiremock::ResponseTemplate::new(200).set_body_string("{\"id\":1}"))
        .mount(&server)
        .await;

    let result = my_client::fetch(&server.uri()).await.unwrap();
    assert_eq!(result.id, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn parallel_work() { ... }
```

`current_thread` is the default test runtime; it chooses a scheduler, it does not make a test deterministic. Wait on the exact event (a channel message, a `Notify`, a `watch` change) or on paused virtual time below, never on a real `sleep`.

For time-sensitive tests, advance virtual time:

```rust
#[tokio::test(start_paused = true)]
async fn time_travel() {
    let start = tokio::time::Instant::now();
    tokio::time::sleep(Duration::from_secs(3600)).await;
    assert!(start.elapsed() >= Duration::from_secs(3600));
    // Real wallclock elapsed: ~0ms.
}
```

## Async traits and async closures

`async fn` in traits is stable (1.75) and dispatches statically:

```rust
trait Store {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError>;
}
```

Two limits: callers cannot require the returned future to be `Send` (spawning a generic `S: Store` call fails), and the trait is not `dyn`-compatible. For `Send` futures, declare the method as `fn get(&self, key: &str) -> impl Future<Output = ...> + Send;`. For `dyn Store`, box the future (`Pin<Box<dyn Future<Output = T> + Send + '_>>`) or use `async-trait`; pick `dyn` only for runtime heterogeneity.

A parameter that is an async callback borrowing from its caller takes `F: AsyncFn(&Request) -> Response` (1.85, `std::ops::AsyncFn`), not `F: Fn(&Request) -> Fut`: the `Fut` form cannot name a future that borrows its argument.

## When NOT to use async

- Single-threaded CPU-heavy code that does no I/O — plain `fn` + `rayon` is simpler and often faster.
- Trivial scripts that do one HTTP call — `ureq` (sync) is simpler.
- FFI heavy code where the FFI side is sync.

Async pays off when you have many concurrent I/O operations or need cancellation as a first-class primitive.
