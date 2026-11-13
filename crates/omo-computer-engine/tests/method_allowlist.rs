//! Row 28's exposure bridge, held from outside the process: the `--mcp` catalog is exactly the
//! `Exposure::Public` rows of the method table (plus the v1 `desktop_stop`), and `--oneshot`
//! answers every host-only method with the v1 host-only rejection and sends nothing. A new
//! method, or a method changing exposure, fails here until this file is edited on purpose.

#[path = "common/peer.rs"]
mod peer;

use std::collections::BTreeSet;
use std::path::Path;

use omo_computer_core::methods::{Exposure, METHODS};
use peer::Peer;
use serde_json::{json, Value};

const SCENARIO: &str = "crates/omo-computer-backend-fake/fixtures/two-displays-one-window.json";
/// The v1 stop verb both bridges keep (plan row 28: host-only methods never cross a bridge
/// except `desktop.stop` and `desktop.stopPath.status`).
const V1_STOP_TOOL: &str = "desktop_stop";

const SNAPSHOT: &[&str] = &[
    "engine.hello", "capabilities", "displays", "windows", "apps.list", "pointer", "diagnose", "capture", "zoom",
    "observe", "ax.snapshot", "ax.drill", "ax.node", "ax.children", "ax.focused", "elementAt", "waitFor",
    "clipboard.read", "menu.items", "surface", "click", "move", "mouse.down", "mouse.up", "key.down", "key.up",
    "drag", "type", "press", "paste", "scroll", "typeText", "keyChord", "holdKeys", "holdMouse", "raiseWindow",
    "ax.setValue", "ax.perform", "ax.focus", "ax.typeText", "ax.selectText", "menu.select", "apps.open",
    "apps.quit", "window.raise", "window.activate", "window.setFrame", "window.minimize", "window.restore",
    "clipboard.write", "openSystemSurface", "stopPath.status", "stopPath.stop", "$/cancel",
];

fn repo() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn env(runtime: &Path) -> Vec<(String, String)> {
    vec![
        ("OMO_COMPUTER_BACKEND".to_owned(), "fake".to_owned()),
        ("OMO_COMPUTER_RUNTIME_DIR".to_owned(), runtime.to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_SCENARIO".to_owned(), repo().join(SCENARIO).to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_STOP_PATH".to_owned(), "live".to_owned()),
    ]
}

fn tool_name(method: &str) -> String {
    format!("desktop_{}", method.replace('.', "_"))
}

fn sink_entries(runtime: &Path) -> usize {
    std::fs::read_dir(runtime)
        .expect("the runtime dir is readable")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("fake-sink-"))
        .map(|entry| std::fs::read_to_string(entry.path()).unwrap_or_default().lines().count())
        .sum()
}

#[test]
fn the_method_tables_public_rows_equal_the_snapshot() {
    let public: BTreeSet<&str> =
        METHODS.iter().filter(|row| row.exposure == Exposure::Public).map(|row| row.name).collect();
    let snapshot: BTreeSet<&str> = SNAPSHOT.iter().copied().collect();
    assert_eq!(public, snapshot, "the public surface changed; edit SNAPSHOT on purpose");
}

#[test]
fn the_mcp_catalog_is_exactly_the_public_methods() {
    let runtime = tempfile::tempdir().expect("a runtime dir");
    let mut mcp = Peer::spawn(&["--mcp"], &env(runtime.path()), &repo());
    mcp.send(&json!({"jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "allowlist", "version": "0"}}}));
    let initialized = mcp.next().expect("an initialize reply");
    assert!(initialized.get("result").is_some(), "{initialized}");
    mcp.send(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
    mcp.send(&json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}));
    let listed = mcp.next().expect("a tools/list reply");
    let tools: BTreeSet<String> = listed["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("tools/list answers tools[]: {listed}"))
        .iter()
        .map(|tool| tool["name"].as_str().expect("a tool has a name").to_owned())
        .collect();
    let mut expected: BTreeSet<String> =
        SNAPSHOT.iter().filter(|name| !name.starts_with("$/")).map(|name| tool_name(name)).collect();
    expected.insert(V1_STOP_TOOL.to_owned());
    assert_eq!(tools, expected);
    assert!(mcp.close().is_empty(), "the shim wrote nothing unasked");
}

#[test]
fn oneshot_refuses_host_only_method() {
    let host_only: Vec<&str> =
        METHODS.iter().filter(|row| matches!(row.exposure, Exposure::HostOnly(_))).map(|row| row.name).collect();
    assert!(host_only.contains(&"stopPath.resume"), "the lift is host-only");
    for (id, method) in (1_i64..).zip(&host_only) {
        let runtime = tempfile::tempdir().expect("a runtime dir");
        let mut oneshot = Peer::spawn(&["--oneshot"], &env(runtime.path()), &repo());
        oneshot.send(&json!({"jsonrpc": "2.0", "id": id, "method": format!("desktop.{method}"), "params": {}}));
        let reply: Value = oneshot.next().unwrap_or_else(|| panic!("{method}: one reply line"));
        assert_eq!(
            reply,
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Method not found", "data": {"reason": "hostOnly"}}}),
            "{method} crossed the --oneshot bridge"
        );
        assert!(oneshot.close().is_empty(), "{method}: exactly one reply line");
        assert_eq!(sink_entries(runtime.path()), 0, "{method}: nothing was sent");
    }
}
