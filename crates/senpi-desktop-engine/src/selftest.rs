//! `--selftest`: drives a built-in fake session through the engine's own
//! routing and session thread, so a located binary proves it runs here.

use senpi_desktop_backend_fake::FakeScenario;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol::ABI;
use senpi_desktop_session::{BackendSelection, SessionTimeouts};
use serde_json::{json, Value};

use crate::config::EngineConfig;
use crate::engine::Engine;
use crate::route::Route;

const SCENARIO: &str = r#"{
  "displays": [{"id": "1", "name": "selftest", "x": 0, "y": 0, "width": 64, "height": 48, "scale": 1.0,
                "pixelX": 0, "pixelY": 0, "pixelWidth": 64, "pixelHeight": 48, "isPrimary": true}],
  "windows": [{"id": "1", "title": "selftest", "app": "selftest", "pid": null, "x": 0, "y": 0,
               "width": 64, "height": 48, "focused": true, "elevated": null}]
}"#;

/// # Errors
/// What the first failing step answered.
pub async fn run_selftest() -> Result<(), String> {
    let scenario = FakeScenario::from_json(SCENARIO).map_err(|error| error.to_string())?;
    let engine = Engine::start(EngineConfig {
        selection: BackendSelection::FakeScenario(Box::new(scenario)),
        timeouts: SessionTimeouts::default(),
        fake_clock: false,
    })
    .map_err(|error| error.to_string())?;
    let hello = call(&engine, Method::EngineHello, json!({})).await?;
    expect("engine.hello abi", &hello["abi"], &json!(ABI))?;
    let opened = call(&engine, Method::SessionOpen, json!({})).await?;
    expect(
        "session.open backend",
        &opened["capabilities"]["backend"],
        &json!("fake"),
    )?;
    let displays = call(&engine, Method::Displays, json!({})).await?;
    expect(
        "displays count",
        &json!(displays.as_array().map(Vec::len)),
        &json!(1),
    )?;
    let capture = call(&engine, Method::Capture, json!({"target": "desktop"})).await?;
    expect(
        "capture size",
        &json!([capture["width"], capture["height"]]),
        &json!([64, 48]),
    )?;
    call(&engine, Method::SessionClose, json!({})).await?;
    Ok(())
}

async fn call(engine: &Engine, method: Method, params: Value) -> Result<Value, String> {
    let name = method.spec().name;
    let outcome = match engine.route(method, params) {
        Route::Immediate(outcome) => outcome,
        Route::Session(call) => engine.begin(call).wait().await,
        Route::Cancel(_) => return Err(format!("{name} is not a request")),
    };
    outcome.map_err(|failure| format!("{name} failed: {failure:?}"))
}

fn expect(step: &str, actual: &Value, expected: &Value) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{step}: expected {expected}, got {actual}"))
    }
}
