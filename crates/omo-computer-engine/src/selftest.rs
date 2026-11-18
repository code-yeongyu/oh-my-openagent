//! `--selftest`: drives a fake-backend session through the RPC layer and reports each check;
//! exits 1 when one fails. It also prints where this engine takes the interaction lock, from
//! the one RUNTIME-root resolver (A-IS-65 L3), or why no lock path resolves.

use std::process::ExitCode;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::paths;
use omo_computer_session::lock::InteractionLock;
use omo_computer_session::Session;
use serde_json::{json, Value};

use crate::rpc;

const CHECKS: &[(&str, &str)] = &[
    ("session.open", r#"{"jsonrpc":"2.0","id":1,"method":"session.open","params":{}}"#),
    ("capabilities", r#"{"jsonrpc":"2.0","id":2,"method":"capabilities","params":{}}"#),
    ("stopPath.start", r#"{"jsonrpc":"2.0","id":3,"method":"stopPath.start","params":{}}"#),
    ("click", r#"{"jsonrpc":"2.0","id":4,"method":"click","params":{"x":1,"y":1}}"#),
    ("session.close", r#"{"jsonrpc":"2.0","id":5,"method":"session.close","params":{}}"#),
];

fn checks() -> Vec<(String, bool)> {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::default(), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    let mut results: Vec<(String, bool)> = CHECKS
        .iter()
        .map(|(name, line)| {
            let reply = rpc::handle_line(&mut session, line.as_bytes())
                .and_then(|text| serde_json::from_str::<Value>(&text).ok());
            let ok = reply.is_some_and(|reply| reply.get("result").is_some());
            ((*name).to_owned(), ok)
        })
        .collect();
    results.push(("sink".to_owned(), sink.len() == 3));
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
