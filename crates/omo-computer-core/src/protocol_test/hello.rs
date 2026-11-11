//! `engine.hello`: protocol version, ABI by major, generation, limits and machine id.

use std::collections::BTreeSet;

use serde_json::Value;

use super::crate_path;
use crate::hello::{abi_compatible, machine_id, Hello, Limits, ABI, PROTOCOL_VERSION};

fn sample() -> Hello {
    Hello::new(
        "0.0.0",
        "unknown",
        3,
        Limits::local(),
        machine_id(b"/run/user/501/omo-computer/501/engine.lock", 501),
    )
}

#[test]
fn hello_carries_machine_id() {
    let id = machine_id(b"/run/user/501/omo-computer/501/engine.lock", 501);
    assert_eq!(id.len(), 16);
    assert!(
        id.bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "{id}"
    );
    assert_eq!(
        id,
        machine_id(b"/run/user/501/omo-computer/501/engine.lock", 501),
        "the id is stable"
    );
    assert_ne!(
        id,
        machine_id(b"/run/user/501/omo-computer/501/engine.lock", 502),
        "the uid is part of the id"
    );
    assert_ne!(
        id,
        machine_id(b"/run/user/502/omo-computer/502/engine.lock", 501),
        "the lock identity is part of the id"
    );
    let reply = serde_json::to_value(sample()).expect("hello serializes");
    assert_eq!(reply["machineId"], Value::String(id));
    assert_eq!(reply["protocolVersion"], "1");
    assert_eq!(reply["abi"], "omo-computer/1");
    assert_eq!(reply["generation"], 3);
    assert_eq!(
        reply["limits"],
        serde_json::json!({"maxRequestBytes": 1_048_576, "maxResponseBytes": 4_194_304, "maxFrameBytes": 5_000_000})
    );
}

#[test]
fn abi_is_compared_by_major() {
    assert_eq!((PROTOCOL_VERSION, ABI), ("1", "omo-computer/1"));
    assert!(abi_compatible("omo-computer/1"));
    assert!(abi_compatible("omo-computer/1.4"));
    assert!(!abi_compatible("omo-computer/2"));
    assert!(
        !abi_compatible("other-engine/1"),
        "another ABI name never matches"
    );
    for malformed in ["", "omo-computer", "omo-computer/", "/1", "omo-computer/x"] {
        assert!(
            !abi_compatible(malformed),
            "{malformed:?} must not be compatible"
        );
    }
}

#[test]
fn bunshin_inline_limits_cap_responses_only() {
    let inline = Limits::bunshin_inline();
    assert_eq!(inline.max_response_bytes, 65_536);
    assert_eq!(
        (inline.max_request_bytes, inline.max_frame_bytes),
        (
            Limits::local().max_request_bytes,
            Limits::local().max_frame_bytes
        )
    );
}

/// The members of the imported `hello.json` expectation plus this row's `additive`
/// ledger lines are exactly the members the reply carries.
#[test]
fn hello_reply_members_are_imported_or_ledgered() {
    let case: Value = serde_json::from_str(
        &std::fs::read_to_string(crate_path("fixtures/conformance/hello.json"))
            .expect("hello.json"),
    )
    .expect("JSON");
    let imported: BTreeSet<String> = case["steps"][0]["expect"][0]["message"]["result"]
        .as_object()
        .expect("result")
        .keys()
        .cloned()
        .collect();
    let ledger =
        std::fs::read_to_string(crate_path("parity/ORACLE-DELTAS.tsv")).expect("ORACLE-DELTAS.tsv");
    let ledgered: BTreeSet<String> = ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').collect::<Vec<_>>())
        .filter(|cells| {
            cells.first() == Some(&"crates/omo-computer-core/fixtures/conformance/hello.json")
                && cells.get(2) == Some(&"additive")
        })
        .filter_map(|cells| {
            cells
                .get(1)
                .and_then(|pointer| pointer.strip_prefix("/result/"))
                .map(str::to_owned)
        })
        .collect();
    let reply: BTreeSet<String> = serde_json::to_value(sample())
        .expect("serializes")
        .as_object()
        .expect("object")
        .keys()
        .cloned()
        .collect();
    assert_eq!(
        imported.len(),
        5,
        "the imported expectation lists five members"
    );
    assert_eq!(
        ledgered,
        ["generation", "limits", "machineId"]
            .map(str::to_owned)
            .into(),
        "this row ledgers exactly three additions"
    );
    assert_eq!(
        reply,
        imported.union(&ledgered).cloned().collect(),
        "every reply member is imported or ledgered"
    );
}
