use std::io::Cursor;
use std::sync::{Arc, Mutex};

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink};
use omo_computer_session::Session;
use serde_json::{json, Value};

use super::Executor;
use crate::launch::host_less_view;
use crate::router::{Router, RouterContext};

#[derive(Clone, Default)]
struct Shared(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Shared {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("buffer").extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn run(scenario: &str, input: &str, pace: bool) -> Vec<Value> {
    let clock = FakeClock::default();
    let scenario = FakeScenario::from_json(scenario).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, clock.clone(), RecordingSink::default());
    let ctx = RouterContext {
        fake_clock: Some(clock),
        test_clock: false,
        machine_key: Vec::new(),
        host: Box::new(host_less_view),
    };
    let output = Shared::default();
    Executor::new(Router::new(Session::new(Box::new(backend)), ctx), output.clone(), pace)
        .run(Cursor::new(input.as_bytes().to_vec()))
        .map(drop)
        .expect("the loop ends with its input");
    let bytes = output.0.lock().expect("buffer").clone();
    String::from_utf8(bytes)
        .expect("utf-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("json"))
        .collect()
}

#[test]
fn framing_errors_answer_their_codes() {
    let input = concat!(
        "not json\n",
        "[1]\n",
        r#"{"jsonrpc":"2.0","id":7,"method":"nope"}"#, "\n",
        r#"{"jsonrpc":"2.0","id":"a","method":"click","params":{"x":"one"}}"#, "\n",
        "{}\n",
    );
    let replies = run("{}", input, false);
    let codes: Vec<(Value, Value)> = replies.iter().map(|r| (r["id"].clone(), r["error"]["code"].clone())).collect();
    assert_eq!(
        codes,
        vec![
            (Value::Null, json!(-32_700)),
            (Value::Null, json!(-32_600)),
            (json!(7), json!(-32_601)),
            (json!("a"), json!(-32_602)),
            (Value::Null, json!(-32_600)),
        ]
    );
}

#[test]
fn id_less_requests_reach_nothing_and_get_no_reply() {
    let sink = RecordingSink::default();
    let scenario = FakeScenario::default();
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone());
    let ctx = RouterContext {
        fake_clock: None,
        test_clock: false,
        machine_key: Vec::new(),
        host: Box::new(host_less_view),
    };
    let input = concat!(
        r#"{"jsonrpc":"2.0","id":1,"method":"session.open","params":{}}"#, "\n",
        r#"{"jsonrpc":"2.0","method":"click","params":{"target":"1","x":1,"y":1}}"#, "\n",
        r#"{"jsonrpc":"2.0","method":"typeText","params":{"target":"1","text":"hi"}}"#, "\n",
    );
    let output = Shared::default();
    Executor::new(Router::new(Session::new(Box::new(backend)), ctx), output.clone(), false)
        .run(Cursor::new(input.as_bytes().to_vec()))
        .map(drop)
        .expect("the loop ends with its input");
    let written = String::from_utf8(output.0.lock().expect("buffer").clone()).expect("utf-8");
    assert_eq!(written.lines().count(), 1, "only the open is answered: {written}");
    assert!(sink.lines().iter().all(|line| line.starts_with("presence ")), "{:?}", sink.lines());
}

#[test]
fn a_cancel_answers_the_pending_call_cancelled() {
    let input = concat!(
        r#"{"jsonrpc":"2.0","id":2,"method":"displays","params":{}}"#, "\n",
        r#"{"jsonrpc":"2.0","method":"$/cancel","params":{"id":2}}"#, "\n",
    );
    let replies = run(r#"{"delay_ms":{"displays":60000}}"#, input, true);
    assert_eq!(replies.len(), 1, "{replies:?}");
    assert_eq!(replies[0]["error"]["message"], json!("Cancelled"));
}

#[test]
fn without_pacing_a_reply_leaves_at_once_and_notifications_get_none() {
    let input = concat!(
        r#"{"jsonrpc":"2.0","method":"capabilities","params":{}}"#, "\n",
        r#"{"jsonrpc":"2.0","id":"a","method":"engine.hello","params":{}}"#, "\n",
    );
    let replies = run(r#"{"delay_ms":{"displays":60000}}"#, input, false);
    assert_eq!(replies.len(), 1, "{replies:?}");
    assert_eq!(replies[0]["result"]["protocolVersion"], json!("1"));
}
