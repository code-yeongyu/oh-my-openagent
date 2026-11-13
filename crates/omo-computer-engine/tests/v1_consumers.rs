//! Row 28: the v1 consumer corpus replayed against the engine binary as its consumers drive it -
//! the nine cases that need no daemon (01-08 over `--stdio`, 10 over `--mcp`, whose shim routes in
//! process). Case 09 runs `--oneshot` against an auto-started `--serve` daemon and is row 29's.

#[path = "common/case.rs"]
mod case;
#[path = "common/compare.rs"]
mod compare;
#[path = "common/host.rs"]
mod host;
#[path = "common/latch_tests.rs"]
mod latch_tests;
#[path = "common/live.rs"]
mod live;
#[path = "common/peer.rs"]
mod peer;
#[path = "common/replay.rs"]
mod replay;
#[path = "common/seam_tests.rs"]
mod seam_tests;

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use live::{request, scenario_with, Live};
use replay::replay;
use serde_json::{json, Value};

const V1_CONSUMERS: &str = "crates/omo-computer-engine/tests/fixtures/v1-consumers/";

fn consumer(file: &str) {
    replay(&format!("{V1_CONSUMERS}{file}")).assert_clean();
}

#[test]
fn stdio_session_open_no_options() {
    consumer("01-stdio-session-open-no-options.json");
}

#[test]
fn stdio_capture() {
    consumer("02-stdio-capture.json");
}

#[test]
fn stdio_click_type_text_null() {
    consumer("03-stdio-click-type-text-null.json");
}

#[test]
fn stdio_ax_snapshot() {
    consumer("04-stdio-ax-snapshot.json");
}

#[test]
fn stdio_stale_ref() {
    consumer("05-stdio-stale-ref.json");
}

#[test]
fn stdio_dangerous_chord_cmd_q() {
    consumer("06-stdio-dangerous-chord-cmd-q.json");
}

#[test]
fn stdio_background_type_text() {
    consumer("07-stdio-background-type-text.json");
}

#[test]
fn stdio_user_press_mid_type_text() {
    consumer("08-stdio-user-press-mid-type-text.json");
}

#[test]
fn mcp_tools() {
    consumer("10-mcp-tools.json");
}

fn live_with_slow_click() -> Live {
    let mut live = Live::spawn(
        &["--stdio"],
        &scenario_with(&json!({"delay_ms": {"click": 2000}})),
    );
    let opened = live.call(1, "session.open", &json!({}));
    assert!(opened.get("result").is_some(), "{opened}");
    let started = live.call(
        2,
        "stopPath.start",
        &json!({"chord": "ctrl+alt+shift+escape"}),
    );
    assert!(started.get("result").is_some(), "{started}");
    let captured = live.call(3, "capture", &json!({"target": "101"}));
    assert!(captured["result"]["frameId"].is_string(), "{captured}");
    live
}

fn click(id: i64) -> Value {
    request(id, "click", &json!({"target": "101", "x": 10, "y": 10}))
}

#[test]
fn late_reply_after_stop_is_dropped() {
    let mut live = live_with_slow_click();
    live.peer.send(&click(10));
    live.peer
        .send(&request(11, "stopPath.stop", &json!({"source": "api"})));
    let seen = live.until_reply(10);
    let stopped = seen
        .iter()
        .find(|m| m["id"] == json!(11))
        .unwrap_or_else(|| panic!("the stop answered first: {seen:?}"));
    assert_eq!(stopped["result"]["suspended"], json!(true), "{stopped}");
    let late = seen.last().expect("until_reply ends at the reply");
    assert!(
        late.get("result").is_none(),
        "a click reply that came back across the stop was delivered: {late}"
    );
    assert_eq!(late["error"]["message"], json!("Suspended"), "{late}");
}

#[test]
fn a_reply_before_the_stop_keeps_its_result() {
    let mut live = live_with_slow_click();
    live.peer.send(&click(10));
    let clicked = live.until_reply(10).pop().expect("the click reply");
    let stopped = live.call(11, "stopPath.stop", &json!({"source": "api"}));
    assert!(clicked.get("result").is_some(), "{clicked}");
    assert_eq!(stopped["result"]["suspended"], json!(true), "{stopped}");
}

#[cfg(unix)]
fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(unix)]
#[test]
fn presence_helper_exits_on_parent_death() {
    let script = r#""$0" --presence-helper >/dev/null & echo $!; wait"#;
    let mut parent = Command::new("sh")
        .args(["-c", script, peer::engine()])
        .env("OMO_COMPUTER_BACKEND", "fake")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the parent shell starts");
    let mut line = String::new();
    std::io::BufRead::read_line(
        &mut std::io::BufReader::new(parent.stdout.take().expect("stdout")),
        &mut line,
    )
    .expect("the helper pid");
    let helper = line.trim().to_owned();
    assert!(alive(&helper), "the helper runs while its parent lives");
    parent.kill().expect("SIGKILL the parent");
    parent.wait().expect("the parent is reaped");
    let deadline = Instant::now() + Duration::from_secs(2);
    while alive(&helper) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    let gone = !alive(&helper);
    if !gone {
        let _ = Command::new("kill").args(["-9", &helper]).status();
    }
    assert!(gone, "the presence helper outlived its parent by more than 2 s (its stdin stays open: the test holds it)");
}
