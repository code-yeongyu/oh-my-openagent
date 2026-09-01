# Library Defaults — Full Decision Tree

The opinionated, audited-in-prod stack for 2026 Rust. Every entry has a one-line rationale and a canonical code snippet so the agent does not have to relearn each library's idioms.

## Async runtime — `tokio`

The default. Use `tokio` for new work. Multi-thread runtime unless you have a measured reason to go single-thread.

```rust
#[tokio::main(flavor = "multi_thread", worker_threads = 8)]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    run().await
}
```

Avoid:
- `async-std` — unmaintained, last release ages ago. crates.io download counts are misleading because of historical inertia.
- `smol` — fine for embedded-ish niches; outside that, the ecosystem is on tokio.
- Mixing runtimes in one binary. Pick one and stay.

## Errors — `anyhow` (apps) + `thiserror` (libs)

Application boundaries get `anyhow::Error` with `.context("...")` at every layer that adds meaning. Libraries expose `#[derive(thiserror::Error)]` enums with `#[non_exhaustive]`.

```rust
// Application code
use anyhow::Context as _;

pub async fn load_config(path: &Path) -> anyhow::Result<Config> {
    let text = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("reading config from {}", path.display()))?;
    let cfg: Config = toml::from_str(&text)
        .with_context(|| format!("parsing config at {}", path.display()))?;
    Ok(cfg)
}

// Library code
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ParseError {
    #[error("expected {expected}, found {found} at position {position}")]
    Mismatch { expected: &'static str, found: String, position: usize },
    #[error("unexpected end of input after {context}")]
    UnexpectedEof { context: &'static str },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
```

`#[non_exhaustive]` on enums prevents downstream `match` from breaking when you add variants. `#[error(transparent)]` on a wrapper variant forwards Display + cause to the inner error.

## CLI — `clap` with derive

```rust
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// Path to the config file
    #[arg(short, long, env = "MYAPP_CONFIG", default_value = "config.toml")]
    config: PathBuf,

    /// Enable verbose output (-v, -vv, -vvv)
    #[arg(short, long, action = clap::ArgAction::Count)]
    verbose: u8,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Run the server
    Serve {
        #[arg(short, long, default_value_t = 8080)]
        port: u16,
    },
    /// Migrate the database
    Migrate {
        #[arg(long)]
        dry_run: bool,
    },
}
```

Avoid `structopt` (deprecated, merged into clap), `argh` (less ergonomic), `pico-args` (only when binary size matters more than DX).

## Logging — `tracing` + `tracing-subscriber`

Not `log` + `env_logger`. `tracing` supports spans (structured context that follows async tasks) and structured fields - `log` cannot.

```rust
use tracing::{info, instrument, warn, Level};
use tracing_subscriber::{fmt, EnvFilter};

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,hyper=warn"));
    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_thread_ids(true)
        .with_line_number(true)
        .compact()
        .init();
}

#[instrument(skip(db), fields(user_id = %user.id))]
async fn process_user(db: &Pool, user: &User) -> anyhow::Result<()> {
    info!("processing user");
    if user.is_banned() {
        warn!(reason = "banned", "skipping");
        return Ok(());
    }
    // ... body ...
    Ok(())
}
```

Replace `println!` with `info!`/`warn!`/`error!`. Replace `eprintln!` with `tracing::error!`.

## Error reporting (binaries) — `color-eyre`

For binary `main()`, hook `color-eyre` to give pretty panics + nice `Result` printing:

```rust
fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;
    tracing_subscriber::fmt::init();
    real_main()
}
```

Library code stays on `anyhow`/`thiserror`. `color-eyre` is purely a display layer for the binary.

## Serialization — `serde` + `serde_json`

The default for any data crossing a process boundary (file, network, IPC, database column).

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct ApiResponse {
    pub user_id: UserId,
    pub created_at: jiff::Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}
```

`deny_unknown_fields` catches typos in inputs. `rename_all = "snake_case"` aligns with REST/JSON conventions while keeping idiomatic Rust field names. `#[serde(flatten)]` for forward-compatible extra fields.

Alternatives:
- `serde_yaml` (YAML — note: YAML's "deserialize anything" surface is a security trap; prefer JSON/TOML where possible)
- `toml` (config files)
- `rmp-serde` (MessagePack — binary, fast)
- `ciborium` (CBOR)
- `bincode 2` (binary, smaller; no serde required in v2 but interop fine)

## HTTP client — `reqwest`

```rust
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
    .https_only(true)
    .pool_max_idle_per_host(8)
    .build()?;

#[derive(serde::Deserialize)]
struct Repo { full_name: String, stargazers_count: u64 }

let repo: Repo = client
    .get("https://api.github.com/repos/rust-lang/rust")
    .send().await?
    .error_for_status()?
    .json().await?;
```

`error_for_status()?` turns 4xx/5xx into `Err`. Always include a User-Agent. `https_only(true)` is a soundness toggle - prevents accidental http:// downgrade.

## Web framework — `axum`

```rust
use axum::{Router, routing::get, extract::State, response::Json};
use std::sync::Arc;

#[derive(Clone)]
struct AppState { db: sqlx::PgPool }

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let ok = sqlx::query_scalar!("SELECT 1::int4").fetch_one(&state.db).await.is_ok();
    Json(serde_json::json!({ "ok": ok }))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let state = Arc::new(AppState { db: sqlx::PgPool::connect(&env_db()).await? });
    let app = Router::new()
        .route("/health", get(health))
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(tower_http::compression::CompressionLayer::new());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

Avoid `actix-web` (legacy patterns, separate runtime model), `warp` (filter explosion in non-trivial apps), `rocket` (slow release cadence). Pair `axum` with `tower-http` for middleware (trace, compression, CORS, timeout, request-id).

## Database — `sqlx` (compile-time checked SQL)

```rust
use sqlx::PgPool;

#[derive(Debug, sqlx::FromRow)]
pub struct User { pub id: uuid::Uuid, pub email: String, pub created_at: jiff::Timestamp }

pub async fn find_user(pool: &PgPool, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as!(
        User,
        r#"SELECT id, email, created_at as "created_at: jiff::Timestamp"
           FROM users WHERE email = $1"#,
        email
    )
    .fetch_optional(pool)
    .await
}
```

`query_as!` checks the SQL against the live database at compile time. To work without a live DB during builds, generate offline metadata: `cargo sqlx prepare`. Commit the resulting `.sqlx/` directory.

Avoid `diesel` (sync-first, heavy DSL), raw `tokio-postgres` (loses type checks), `sea-orm` (more magic, less control).

For migrations: `sqlx migrate add <name>` + `sqlx::migrate!("./migrations").run(&pool).await?`.

## Time — `jiff`

The 2025+ choice. Single crate, sane defaults, civil time / instant / span distinction.

```rust
use jiff::{Timestamp, Span, ToSpan, Zoned};

let now: Timestamp = Timestamp::now();
let in_one_hour = now.checked_add(1.hour())?;
let local: Zoned = now.in_tz("Asia/Seoul")?;
let span: Span = local - some_earlier.in_tz("Asia/Seoul")?;
```

Avoid `chrono` (old API, generic-heavy, time zone story still painful), `time` crate (split ecosystem, weaker docs). `jiff` is the post-`chrono` consolidation.

## UUID — `uuid` with v7

```rust
use uuid::Uuid;

// v7 for IDs (sortable, time-ordered, monotonic-ish, RFC 9562)
let id = Uuid::now_v7();
```

v4 is fine for nonces, v7 for primary keys (better index locality). Never v1 (leaks MAC). Cargo features: `uuid = { version = "1", features = ["v4", "v7", "serde"] }`.

## DataFrames / analytics — `polars`

For columnar data, joins, group-by, lazy plans:

```rust
use polars::prelude::*;

let df = LazyCsvReader::new("events.csv")
    .finish()?
    .group_by([col("user_id")])
    .agg([col("amount").sum().alias("total")])
    .sort(["total"], Default::default())
    .collect()?;
```

The Rust API mirrors the Python one. Use the lazy API by default; materialize with `.collect()` at the end.

## Channels

- Single-producer single-consumer or bounded MPSC → `tokio::sync::mpsc` (async) or `flume` (sync + async).
- Broadcast → `tokio::sync::broadcast`.
- Watch (latest-value pubsub) → `tokio::sync::watch`.
- Oneshot → `tokio::sync::oneshot`.

Avoid raw `std::sync::mpsc` (sync only, fewer features), `crossbeam-channel` (good but heavier; use only if you need rendezvous semantics).

## Coordinate spaces / 2D math — `euclid`

```rust
use euclid::{Point2D, Size2D, default::Box2D};
struct ScreenSpace;
struct WorldSpace;

type ScreenPoint = Point2D<f32, ScreenSpace>;
type WorldPoint  = Point2D<f32, WorldSpace>;

let cursor: ScreenPoint = Point2D::new(120.0, 240.0);
let player: WorldPoint  = Point2D::new(3.5, 1.2);

// let mistake = cursor + player; // ❌ type error
```

Generalize the pattern to your own domains (see `references/type-state.md`).

## Property tests — `proptest`

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn parse_roundtrips(s in r"[a-zA-Z0-9_-]{1,50}") {
        let parsed = parse(&s).unwrap();
        let back = parsed.to_string();
        prop_assert_eq!(back, s);
    }
}
```

Avoid `quickcheck` (older, less ergonomic). proptest gives shrinking + regression corpus + integration with `criterion`.

## Snapshot tests — `insta`

```rust
#[test]
fn renders_help() {
    let output = render(&example_input());
    insta::assert_snapshot!(output);
}

#[test]
fn serializes_well() {
    insta::assert_json_snapshot!(serializable_value());
}
```

`cargo insta review` (after `cargo install cargo-insta`) — interactive review of changed snapshots.

## Benchmarks — `criterion`

Stable Rust friendly (no nightly `#[bench]`).

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_parse(c: &mut Criterion) {
    let input = std::fs::read_to_string("samples/large.txt").unwrap();
    c.bench_function("parse_large", |b| b.iter(|| parse(black_box(&input))));
}

criterion_group!(benches, bench_parse);
criterion_main!(benches);
```

Run with `cargo bench`. HTML reports under `target/criterion/`. Pair with `cargo bench -- --save-baseline main` then `--baseline main` for comparison.

## Concurrency model — `loom`

For lock-free or atomic-heavy code (channels, refcounts, hazard pointers). See `references/concurrency.md` for the full pattern.

## Arena allocator — `bumpalo`

```rust
use bumpalo::Bump;

let bump = Bump::new();
let node = bump.alloc(Node { value: 42, next: None });
let s: &str = bump.alloc_str("hello");
// All allocations freed at once when `bump` drops.
```

For parser nodes, AST construction, per-request scratch. Outperforms heap allocation for short-lived owned data by an order of magnitude.

## Web client (browser, WASM-bound) — `gloo` ecosystem

If targeting WASM browser, use `gloo-net` for fetch and `gloo-storage` for localStorage; not `web-sys` directly unless you need DOM-level APIs.

## Lazy statics — `std::sync::LazyLock` (since 1.80)

```rust
use std::sync::LazyLock;
static CONFIG: LazyLock<Config> = LazyLock::new(|| Config::load_from_env().unwrap());
```

Avoid `lazy_static!` (macro-heavy, predates std), `once_cell` (now in std as `LazyLock`/`OnceLock`).

## Hash maps — `std::collections::HashMap` + `ahash` for hot paths

```rust
use std::collections::HashMap;
use ahash::RandomState;

type FastMap<K, V> = HashMap<K, V, RandomState>;
let mut counters: FastMap<String, u64> = FastMap::default();
```

`HashMap` defaults to SipHash (DoS-resistant). For internal hot loops where you trust the keys, `ahash` is 2-5x faster.

For sorted iteration, use `BTreeMap`. For small keys with known small N, `Vec<(K, V)>` may beat both.

## File I/O — `tokio::fs` (async) or `std::fs` (sync utility)

```rust
let contents = tokio::fs::read_to_string("data.json").await?;
```

For large files: `tokio::fs::File` + `tokio::io::BufReader`. For random access, `memmap2` (with the unsafe-discipline wrappers).

## Decision tree

```
Need to ship the thing?
├── HTTP server         → axum + sqlx + tracing + jiff + tokio
├── HTTP client         → reqwest (+ tokio)
├── CLI                 → clap + color-eyre + tracing + indicatif (progress) + dialoguer (prompts)
├── TUI                 → ratatui + crossterm
├── Background worker   → tokio + ETL → polars + duckdb
├── Game / graphics     → wgpu + winit + euclid (or bevy if you want the engine)
├── WASM front-end      → leptos (or dioxus / yew) + wasm-bindgen + gloo
├── Embedded            → embassy (async on bare metal)
├── FFI to C / Python   → cxx (C++) / pyo3 (Python) / cbindgen (header gen)
└── Just a script       → rust-script (see one-liners.md)
```

When in doubt, search crates.io for the latest version, then check:
1. Is it maintained? (`cargo deny check` will scream if it's yanked or unmaintained)
2. Does it have `serde` feature? (boundary types should always serde)
3. Does it have `tokio` integration? (avoid runtime mixing)
4. Is it on `tokio::io::AsyncRead`/`AsyncWrite` (the std for async I/O)?
5. Are there safety-critical `unsafe` regions? If yes, has the author shipped miri proofs?
