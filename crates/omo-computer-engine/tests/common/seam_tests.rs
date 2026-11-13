//! Row 28's tests that need a seam the pin does not name, written against DESIGN-GAPS-ROW28's
//! PROPOSED G2 (`--mcp --tier <read|exec>`) and G3 (the release helper records into the fake's
//! sink file under the runtime dir); R70f keeps them in their own commit.

use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::live::{scenario_with, Live};

fn sink_lines(runtime: &Path) -> Vec<String> {
    fs::read_dir(runtime)
        .expect("the runtime dir is readable")
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("fake-sink-")
        })
        .flat_map(|entry| {
            fs::read_to_string(entry.path())
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn mcp(tier: &str, scenario: &Value, computer_use: Option<bool>) -> Live {
    let mut live = Live::spawn_with(&["--mcp", "--tier", tier], scenario, |runtime| {
        if let Some(allowed) = computer_use {
            super::host::consent(runtime, allowed);
        }
    });
    let init = live.call(0, "initialize", &json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "row28", "version": "0"}}));
    assert!(init.get("result").is_some(), "{init}");
    live.peer
        .send(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
    live
}

fn tool(live: &mut Live, id: i64, name: &str, arguments: &Value) -> Value {
    live.call(
        id,
        "tools/call",
        &json!({"name": name, "arguments": arguments}),
    )
}

#[test]
fn mcp_tier_exec_with_computer_use_false_stays_read_only() {
    let mut live = mcp("exec", &scenario_with(&json!({})), Some(false));
    let read = tool(
        &mut live,
        1,
        "desktop_capture",
        &json!({"target": "101", "caps": {"maxWidth": 64}}),
    );
    assert_ne!(
        read["result"]["isError"],
        json!(true),
        "reads stay open: {read}"
    );
    let clicked = tool(
        &mut live,
        2,
        "desktop_click",
        &json!({"target": "101", "x": 10, "y": 10}),
    );
    assert_eq!(
        clicked["result"]["isError"],
        json!(true),
        "exec over a computerUse:false file: {clicked}"
    );
    assert!(
        sink_lines(live.runtime())
            .iter()
            .all(|line| !line.starts_with("post_input")),
        "nothing was sent"
    );
}

#[test]
fn mcp_tier_exec_without_consent_file_stays_read_only() {
    let mut live = mcp("exec", &scenario_with(&json!({})), None);
    let clicked = tool(
        &mut live,
        1,
        "desktop_click",
        &json!({"target": "101", "x": 10, "y": 10}),
    );
    assert_eq!(
        clicked["result"]["isError"],
        json!(true),
        "--tier exec is a request, not a grant: {clicked}"
    );
    assert!(
        sink_lines(live.runtime())
            .iter()
            .all(|line| !line.starts_with("post_input")),
        "nothing was sent"
    );
}

#[test]
fn mcp_tier_flag_refuses_an_unknown_value_with_exit_2() {
    let status = Command::new(super::peer::engine())
        .args(["--mcp", "--tier", "admin"])
        .env("OMO_COMPUTER_BACKEND", "fake")
        .status()
        .expect("the engine runs");
    assert_eq!(status.code(), Some(2));
}

#[test]
fn session_open_without_host_self_set_still_refuses_own_pid_chain() {
    let own = std::process::id();
    let scenario = scenario_with(
        &json!({"windows": [{"id": "301", "title": "the MCP client", "app": "Terminal", "pid": own,
        "x": 0, "y": 0, "width": 400, "height": 300, "focused": true, "elevated": null}]}),
    );
    let mut live = mcp("exec", &scenario, Some(true));
    let typed = tool(
        &mut live,
        1,
        "desktop_typeText",
        &json!({"target": "301", "text": "rm -rf ~"}),
    );
    assert_eq!(typed["result"]["isError"], json!(true), "{typed}");
    assert!(
        typed.to_string().contains("SelfTarget"),
        "refused as the engine's own pid chain: {typed}"
    );
    assert!(
        sink_lines(live.runtime())
            .iter()
            .all(|line| !line.starts_with("post_input")),
        "nothing was sent"
    );
}

#[cfg(unix)]
#[test]
fn sigkill_mid_type_releases_key_within_2s() {
    let mut live = Live::spawn(&["--stdio"], &scenario_with(&json!({})));
    assert!(live
        .call(1, "session.open", &json!({}))
        .get("result")
        .is_some());
    assert!(live
        .call(
            2,
            "stopPath.start",
            &json!({"chord": "ctrl+alt+shift+escape"})
        )
        .get("result")
        .is_some());
    let held = live.call(3, "key.down", &json!({"target": "101", "chord": "shift"}));
    assert!(held.get("result").is_some(), "the key is held: {held}");
    let pid = live.peer.child.id().to_string();
    Command::new("kill")
        .args(["-9", &pid])
        .status()
        .expect("SIGKILL the engine");
    let released = |lines: &[String]| {
        lines
            .iter()
            .any(|line| line.contains("key \"shift\" down=false"))
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    while !released(&sink_lines(live.runtime())) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    let lines = sink_lines(live.runtime());
    assert!(
        released(&lines),
        "no key-up within 2 s of SIGKILL: {lines:?}"
    );
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.contains("key \"shift\" down=false"))
            .count(),
        1,
        "exactly one UP"
    );
}
