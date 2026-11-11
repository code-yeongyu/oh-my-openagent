//! `--selftest`: drives a fake-backend session through the RPC layer and reports each check;
//! exits 1 when one fails.

use std::process::ExitCode;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink};
use omo_computer_session::Session;
use serde_json::{json, Value};

use crate::rpc;

const CHECKS: &[(&str, &str)] = &[
    ("session.open", r#"{"jsonrpc":"2.0","id":1,"method":"session.open","params":{}}"#),
    ("capabilities", r#"{"jsonrpc":"2.0","id":2,"method":"capabilities","params":{}}"#),
    ("click", r#"{"jsonrpc":"2.0","id":3,"method":"click","params":{"target":"1","x":1,"y":1}}"#),
    ("session.close", r#"{"jsonrpc":"2.0","id":4,"method":"session.close","params":{}}"#),
];

fn checks() -> Vec<(String, bool)> {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::default(), FakeClock::default(), sink.clone());
    let mut session = Session::new(Box::new(backend));
    let mut results: Vec<(String, bool)> = CHECKS
        .iter()
        .map(|(name, line)| {
            let reply = rpc::handle_line(&mut session, line)
                .and_then(|text| serde_json::from_str::<Value>(&text).ok());
            let ok = reply.is_some_and(|reply| reply.get("result").is_some());
            ((*name).to_owned(), ok)
        })
        .collect();
    results.push(("sink".to_owned(), sink.len() == 3));
    results
}

pub fn run(as_json: bool) -> ExitCode {
    let results = checks();
    let ok = results.iter().all(|(_, passed)| *passed);
    if as_json {
        let list: Vec<Value> = results
            .iter()
            .map(|(name, passed)| json!({ "check": name, "ok": passed }))
            .collect();
        println!("{}", json!({ "ok": ok, "backend": "fake", "checks": list }));
    } else {
        for (name, passed) in &results {
            println!("{name}: {}", if *passed { "ok" } else { "FAILED" });
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
