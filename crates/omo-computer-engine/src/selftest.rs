//! `--selftest`: drives a fake-backend session through the router and reports each check;
//! exits 1 when one fails. It also prints where this engine takes the interaction lock, from
//! the one RUNTIME-root resolver (A-IS-65 L3), or why no lock path resolves.

use std::process::ExitCode;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::paths;
use omo_computer_session::lock::InteractionLock;
use omo_computer_session::Session;
use serde_json::{json, Value};

use crate::launch::host_less_view;
use crate::router::{Peer, Router, RouterContext};

fn checks_list() -> Vec<(&'static str, Value)> {
    vec![
        ("session.open", json!({})),
        ("capabilities", json!({})),
        ("stopPath.start", json!({})),
        ("capture", json!({"target": "desktop"})),
        // Row 21: a click with no target lands on the user's pointer, which needs the human grant.
        ("control.grant", json!({"reason": "selftest"})),
        ("click", json!({"x": 1, "y": 1})),
        ("session.close", json!({})),
    ]
}

/// One display, so the click has a frame to map through.
const SCENARIO: &str = r#"{"displays":[{"id":"1","name":"Display","x":0,"y":0,"width":64,"height":48,"scale":1.0,"pixelX":0,"pixelY":0,"pixelWidth":64,"pixelHeight":48,"isPrimary":true}]}"#;

fn checks() -> Vec<(String, bool)> {
    let sink = RecordingSink::default();
    let Ok(scenario) = FakeScenario::from_json(SCENARIO) else {
        return vec![("scenario".to_owned(), false)];
    };
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let ctx = RouterContext {
        fake_clock: None,
        test_clock: false,
        machine_key: Vec::new(),
        host: Box::new(host_less_view),
    };
    let mut router = Router::new(Session::new(Box::new(backend)), ctx);
    let mut results: Vec<(String, bool)> = checks_list()
        .into_iter()
        .map(|(name, params)| (name.to_owned(), router.call(Peer::Host, name, params).is_ok()))
        .collect();
    let sent = sink.lines().iter().filter(|line| !line.starts_with("presence ")).count();
    results.push(("sink".to_owned(), sent == 3));
    let shown = sink.lines().iter().any(|line| line.starts_with("presence show"));
    results.push(("presence".to_owned(), shown));
    results
}

/// The interaction lock's path under the RUNTIME root this engine resolves, or why none does.
fn interaction_lock() -> Result<String, String> {
    paths::resolve(|name| std::env::var(name).ok())
        .map(|roots| InteractionLock::under(&roots.runtime).path().display().to_string())
        .map_err(|unavailable| unavailable.to_string())
}

pub fn run(as_json: bool) -> ExitCode {
    let results = checks();
    let lock = interaction_lock();
    let ok = results.iter().all(|(_, passed)| *passed);
    if as_json {
        let list: Vec<Value> = results
            .iter()
            .map(|(name, passed)| json!({ "check": name, "ok": passed }))
            .collect();
        let lock = lock.map_or(Value::Null, Value::String);
        println!(
            "{}",
            json!({ "ok": ok, "backend": "fake", "checks": list, "interactionLock": lock })
        );
    } else {
        for (name, passed) in &results {
            println!("{name}: {}", if *passed { "ok" } else { "FAILED" });
        }
        match &lock {
            Ok(path) => println!("interaction lock: {path}"),
            Err(why) => println!("interaction lock: unavailable ({why})"),
        }
        println!("engine: selftest {}", if ok { "ok" } else { "FAILED" });
    }
    if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_selftest_check_passes_on_the_fake() {
        let results = super::checks();
        assert!(results.iter().all(|(_, ok)| *ok), "{results:?}");
    }
}
