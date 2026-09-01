# axum + sqlx + tracing + tower — HTTP API Stack

The canonical production HTTP service in Rust 2026.

## Cargo.toml dependencies

```toml
[dependencies]
axum = { version = "0.8", features = ["macros", "tracing", "ws", "multipart"] }
tokio = { version = "1", features = ["full"] }
tower = "0.5"
tower-http = { version = "0.6", features = [
    "trace", "compression-gzip", "compression-br",
    "timeout", "cors", "request-id", "sensitive-headers",
    "limit", "set-header",
] }

# Errors / observability
anyhow = "1"
thiserror = "2"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
color-eyre = "0.6"

# Database
sqlx = { version = "0.8", features = [
    "runtime-tokio-rustls", "postgres", "uuid", "macros",
    "migrate", "json",
] }

# Serialization / validation
serde = { version = "1", features = ["derive"] }
serde_json = "1"
validator = { version = "0.18", features = ["derive"] }

# Types
uuid = { version = "1", features = ["v4", "v7", "serde"] }
jiff = { version = "0.1", features = ["serde"] }

# Config
config = { version = "0.14", features = ["toml", "yaml"] }
secrecy = { version = "0.10", features = ["serde"] }

# OpenAPI (optional but recommended)
utoipa = { version = "5", features = ["axum_extras", "uuid", "chrono"] }
utoipa-axum = "0.1"
utoipa-swagger-ui = { version = "8", features = ["axum"] }
```

## Project structure

```
src/
  main.rs            # binary entry
  lib.rs             # re-exports + app builder
  config.rs          # Settings type + loader
  state.rs           # AppState (shared via Arc)
  routes/
    mod.rs           # Router::new() composition
    health.rs
    users.rs
  middleware/
    mod.rs
    auth.rs
    request_id.rs
  models/
    mod.rs
    user.rs
  error.rs           # AppError + IntoResponse impl
  db/
    mod.rs
    migrations/
migrations/          # sqlx migrations
```

## Error type

```rust
// src/error.rs
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("unauthorized")]
    Unauthorized,
    #[error("validation: {0}")]
    Validation(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("internal")]
    Internal(#[from] anyhow::Error),
    #[error("database")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found", self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", "unauthorized".into()),
            AppError::Validation(m) => (StatusCode::UNPROCESSABLE_ENTITY, "validation", m.clone()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "conflict", m.clone()),
            AppError::Database(e) => {
                tracing::error!(error = ?e, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "database", "internal".into())
            }
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", "internal".into())
            }
        };
        (status, Json(json!({"error": {"code": code, "message": message}}))).into_response()
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
```

Pattern: business errors return `AppResult<T>`; the `IntoResponse` impl translates them to HTTP. `sqlx::Error` and `anyhow::Error` auto-convert via `From`. Internal-bucket errors are logged but never leak their `Debug` representation to clients.

## AppState

```rust
// src/state.rs
use std::sync::Arc;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<crate::config::Settings>,
    pub http: reqwest::Client,
}

impl AppState {
    pub async fn new(config: crate::config::Settings) -> anyhow::Result<Self> {
        let db = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.db.max_connections)
            .acquire_timeout(std::time::Duration::from_secs(3))
            .connect(config.db.url.expose_secret())
            .await?;
        sqlx::migrate!("./migrations").run(&db).await?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { db, config: Arc::new(config), http })
    }
}
```

## Route handler

```rust
// src/routes/users.rs
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{error::{AppError, AppResult}, state::AppState};

#[derive(Debug, Deserialize, Validate)]
pub struct CreateUser {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1, max = 100))]
    pub name: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub created_at: jiff::Timestamp,
}

#[tracing::instrument(skip(state, body))]
pub async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUser>,
) -> AppResult<(axum::http::StatusCode, Json<User>)> {
    body.validate().map_err(|e| AppError::Validation(e.to_string()))?;

    let id = Uuid::now_v7();
    let user = sqlx::query_as!(
        User,
        r#"INSERT INTO users (id, email, name, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, email, name, created_at as "created_at: jiff::Timestamp""#,
        id, body.email, body.name
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") =>
            AppError::Conflict("email already exists".into()),
        _ => AppError::Database(e),
    })?;

    Ok((axum::http::StatusCode::CREATED, Json(user)))
}

#[tracing::instrument(skip(state))]
pub async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<User>> {
    sqlx::query_as!(
        User,
        r#"SELECT id, email, name, created_at as "created_at: jiff::Timestamp"
           FROM users WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or(AppError::NotFound)
}
```

## Router assembly

```rust
// src/routes/mod.rs
use axum::{routing::{get, post}, Router};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    sensitive_headers::SetSensitiveHeadersLayer,
    timeout::TimeoutLayer,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use std::time::Duration;
use crate::state::AppState;

mod health;
mod users;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::handler))
        .route("/users", post(users::create_user))
        .route("/users/:id", get(users::get_user))
        .with_state(state);

    Router::new()
        .nest("/api/v1", api)
        .layer(
            tower::ServiceBuilder::new()
                .layer(SetSensitiveHeadersLayer::new([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::COOKIE,
                ]))
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(DefaultMakeSpan::new().include_headers(false))
                        .on_response(DefaultOnResponse::new().latency_unit(tower_http::LatencyUnit::Millis)),
                )
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(TimeoutLayer::new(Duration::from_secs(30)))
                .layer(CompressionLayer::new())
                .layer(CorsLayer::permissive()), // tighten in production
        )
}
```

Order matters: outermost layer wraps the request first. Trace before timeout so timeouts get logged. Compression after trace so trace sees the original body size.

## Main + graceful shutdown

```rust
// src/main.rs
use my_app::{config::Settings, routes, state::AppState};

#[tokio::main]
async fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;
    init_tracing();

    let config = Settings::load()?;
    let state = AppState::new(config.clone()).await?;
    let app = routes::router(state);

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!(addr = %config.bind, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,hyper=warn,tower_http=info"));
    fmt().with_env_filter(filter).with_target(false).json().init();
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("ctrl_c handler"); };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("signal handler").recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutting down");
}
```

## Middleware: bearer auth example

```rust
// src/middleware/auth.rs
use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    middleware::Next,
    response::Response,
};
use crate::{error::AppError, state::AppState};

#[derive(Clone, Debug)]
pub struct AuthUser { pub id: uuid::Uuid }

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = request.headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or(AppError::Unauthorized)?;

    let claims = verify_jwt(token, &state.config.jwt_secret)?;
    request.extensions_mut().insert(AuthUser { id: claims.sub });
    Ok(next.run(request).await)
}
```

Apply with `.route_layer(middleware::from_fn_with_state(state.clone(), require_auth))` on the subroutes that need it.

## Testing handlers

```rust
// tests/users.rs
#[tokio::test]
async fn creates_user() {
    let pool = test_db().await;          // helper that spins up a transactional DB
    let state = AppState::new_test(pool).await.unwrap();
    let app = my_app::routes::router(state);

    let request = axum::http::Request::builder()
        .uri("/api/v1/users")
        .method("POST")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({"email": "a@b.com", "name": "A"})).unwrap()
        )).unwrap();

    let response = tower::ServiceExt::oneshot(app, request).await.unwrap();
    assert_eq!(response.status(), 201);
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20).await.unwrap();
    let user: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user["email"], "a@b.com");
}
```

`tower::ServiceExt::oneshot` calls the router directly without binding a socket. Tests run in parallel without port collisions.

## Config

```rust
// src/config.rs
use secrecy::{Secret, ExposeSecret};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Settings {
    pub bind: String,
    pub db: Database,
    pub jwt_secret: Secret<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Database {
    pub url: Secret<String>,
    pub max_connections: u32,
}

impl Settings {
    pub fn load() -> anyhow::Result<Self> {
        let cfg = config::Config::builder()
            .add_source(config::File::with_name("config/default").required(false))
            .add_source(config::File::with_name(&format!(
                "config/{}", std::env::var("APP_ENV").unwrap_or_else(|_| "dev".into())
            )).required(false))
            .add_source(config::Environment::with_prefix("APP").separator("__"))
            .build()?;
        Ok(cfg.try_deserialize()?)
    }
}
```

`Secret<T>` from the `secrecy` crate hides the value in `Debug`/`Display` to prevent accidental log leakage. Access via `.expose_secret()` only where needed.

## OpenAPI (optional)

Add `utoipa` derive macros on your DTOs and handlers, mount Swagger UI at `/swagger-ui`:

```rust
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

#[derive(OpenApi)]
#[openapi(
    paths(routes::users::create_user, routes::users::get_user),
    components(schemas(routes::users::User, routes::users::CreateUser))
)]
struct ApiDoc;

let (router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
    .routes(utoipa_axum::routes!(routes::users::create_user, routes::users::get_user))
    .split_for_parts();

let app = router.merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", api));
```

## Production checklist

- Bind to `0.0.0.0` in containers, `127.0.0.1` for local-only services.
- Set `RUST_LOG=info,sqlx=warn` (or use `EnvFilter` defaults as shown).
- Send logs to stdout in JSON. Ingest via Vector / Fluent Bit / Loki.
- Run migrations on startup (`sqlx::migrate!` block). Fail fast on schema mismatch.
- Health endpoint **must hit the DB** (so load balancers know if the pool is dead).
- Add `tower::limit::RateLimitLayer` or token-bucket middleware for public endpoints.
- Set `tower_http::limit::RequestBodyLimitLayer` to bound request size.
- Compress with brotli + gzip via `CompressionLayer`.
- Tighten CORS, do not ship `CorsLayer::permissive()` to production.
- Strip sensitive headers from traces via `SetSensitiveHeadersLayer`.
- Set up SIGTERM-driven `with_graceful_shutdown` so deploys roll without dropping requests.
- Containerize with `cargo chef` for incremental Docker builds.

## Common mistakes

1. **Forgetting `error_for_status()?` on outbound `reqwest`** — 4xx silently succeeds.
2. **Returning `Result<T, sqlx::Error>` from handlers** — leak DB details to clients. Always go through `AppError`.
3. **`Json<T>` extractor before validation** — invalid JSON returns axum's default 422 with no body shape. Wrap in a `ValidatedJson<T>` extractor that runs `validator` and returns `AppError`.
4. **Holding DB connections across `.await` on slow external calls** — exhausts the pool. Acquire late, release early.
5. **Skipping `tracing::instrument`** on handlers — losing per-request span correlation.
6. **No `RequestBodyLimitLayer`** — DoS surface. Default axum has no limit.
