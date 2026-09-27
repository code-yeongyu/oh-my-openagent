//! Structural bypass guard: the engine answers exactly the methods of this
//! snapshot, with these effects and exposures. A new method, or a stop-path
//! control losing `hostOnly`, fails here until this snapshot is edited on
//! purpose.

mod common;

use common::{fake_backend, Engine, TWO_DISPLAYS};
use senpi_desktop_core::methods::{Effect, Exposure, Method, METHODS};
use serde_json::json;

const SNAPSHOT: &[(&str, &str, &str)] = &[
    ("engine.hello", "read", "public"),
    ("session.open", "exec", "hostOnly"),
    ("session.close", "exec", "hostOnly"),
    ("capabilities", "read", "public"),
    ("displays", "read", "public"),
    ("windows", "read", "public"),
    ("capture", "read", "public"),
    ("click", "exec", "public"),
    ("moveMouse", "exec", "public"),
    ("drag", "exec", "public"),
    ("scroll", "exec", "public"),
    ("typeText", "exec", "public"),
    ("keyChord", "exec", "public"),
    ("raiseWindow", "exec", "public"),
    ("clipboard.read", "read", "public"),
    ("clipboard.write", "exec", "public"),
    ("ax.snapshot", "read", "public"),
    ("ax.query", "read", "public"),
    ("ax.elementAt", "read", "public"),
    ("ax.focused", "read", "public"),
    ("ax.node", "read", "public"),
    ("ax.attributes", "read", "public"),
    ("ax.children", "read", "public"),
    ("ax.parent", "read", "public"),
    ("ax.perform", "exec", "public"),
    ("ax.setValue", "exec", "public"),
    ("ax.focus", "exec", "public"),
    ("ax.click", "exec", "public"),
    ("stopPath.start", "exec", "hostOnly"),
    ("stopPath.status", "read", "public"),
    ("stopPath.heartbeat", "read", "hostOnly"),
    ("stopPath.stop", "read", "public"),
    ("stopPath.resume", "exec", "hostOnly"),
    ("$/cancel", "read", "public"),
    ("$/test.advanceClock", "exec", "testOnly"),
];

const fn effect(effect: Effect) -> &'static str {
    match effect {
        Effect::Read => "read",
        Effect::Exec => "exec",
    }
}

const fn exposure(exposure: Exposure) -> &'static str {
    match exposure {
        Exposure::Public => "public",
        Exposure::HostOnly => "hostOnly",
        Exposure::TestOnly => "testOnly",
    }
}

#[test]
fn the_engine_method_table_equals_the_snapshot() {
    let table: Vec<(&str, &str, &str)> = METHODS
        .iter()
        .map(|spec| (spec.name, effect(spec.effect), exposure(spec.exposure)))
        .collect();
    assert_eq!(table, SNAPSHOT);
}

#[test]
fn stop_path_resume_is_host_only() {
    assert_eq!(Method::StopPathResume.spec().exposure, Exposure::HostOnly);
}

#[test]
fn the_binary_knows_every_snapshot_method_and_nothing_else() {
    // Given
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    // When: every snapshot method, then one outside it, is called with no params
    let replies: Vec<_> = SNAPSHOT
        .iter()
        .map(|(name, _, _)| *name)
        .chain(["stopPath.resume2"])
        .zip(1..)
        .map(|(name, id)| (name, engine.call(id, name, json!(null))))
        .collect();
    // Then: only the method outside the snapshot is unknown
    let unknown: Vec<&str> = replies
        .iter()
        .filter(|(_, reply)| reply["error"]["data"]["reason"] == json!("unknown"))
        .map(|(name, _)| *name)
        .collect();
    assert_eq!(unknown, ["stopPath.resume2"]);
}
