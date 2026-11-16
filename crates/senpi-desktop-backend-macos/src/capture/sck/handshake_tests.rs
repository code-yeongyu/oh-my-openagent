//! Ping readiness and the silent-helper budget.

use super::{fake_helper, ClientError, HelperClient, PY_PREAMBLE};
use crate::capture::sck::test_support::startup_signal;

#[test]
fn ping_waits_for_the_ready_reply() {
    // Given: a helper that answers the warm-up ping
    let dir = tempfile::tempdir().unwrap();
    let (signal, started) = startup_signal(&dir);
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
import time
# Startup deliberately exceeds the operation budget.
time.sleep(6)
open({}, 'w').close()
assert json.loads(sys.stdin.buffer.readline().decode()) == {{'kind': 'ping'}}
header({{'kind':'ready'}})
",
        serde_json::to_string(&signal).unwrap()
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    // The signal is subscribed before spawn. Interpreter startup is setup,
    // not part of the ping's response deadline.
    started.recv_timeout(std::time::Duration::from_secs(30)).expect("helper startup signal");
    // When / Then: the ping returns once the ready header arrives
    client.ping(std::time::Duration::from_secs(5)).unwrap();
}

#[test]
fn a_silent_helper_fails_the_ping_within_its_budget() {
    // Given: a helper that reads the ping and never answers
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
import time
sys.stdin.buffer.readline()
time.sleep(30)
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    // When: the warm-up budget is short
    let started = std::time::Instant::now();
    let error = client.ping(std::time::Duration::from_millis(300)).unwrap_err();
    // Then: it is a transport (start) failure that honors the budget
    assert!(matches!(error, ClientError::Transport(_)), "{error:?}");
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}
