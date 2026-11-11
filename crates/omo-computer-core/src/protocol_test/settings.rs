//! The settings table: strict parse, the `trace` tri-state, defaults and admission keys.

use serde_json::json;

use crate::params::SessionOpenParams;
use crate::settings::{
    admission_keys, CuaAdapter, CuaAdapterMode, FullLiteral, RunLimits, Settings, Trace,
};

#[test]
fn trace_full_literal_is_accepted_by_the_strict_schema() {
    for (value, parsed) in [
        (json!("full"), Trace::Full(FullLiteral::Full)),
        (json!(true), Trace::Enabled(true)),
        (json!(false), Trace::Enabled(false)),
    ] {
        let settings: Settings =
            serde_json::from_value(json!({ "trace": value })).expect("trace value accepted");
        assert_eq!(settings.trace, Some(parsed));
        let open: SessionOpenParams =
            serde_json::from_value(json!({ "trace": value })).expect("session.open trace accepted");
        assert_eq!(open.trace, Some(parsed));
    }
    for rejected in [json!("partial"), json!("FULL"), json!(1)] {
        assert!(
            serde_json::from_value::<Settings>(json!({ "trace": rejected })).is_err(),
            "{rejected} must be refused"
        );
    }
}

#[test]
fn unknown_and_removed_keys_are_refused() {
    for key in ["run_sandbox", "macos_canary", "showCursor", "lockState"] {
        assert!(
            serde_json::from_value::<Settings>(json!({ key: "x" })).is_err(),
            "{key} is not a settings key"
        );
    }
    let open = serde_json::from_value::<SessionOpenParams>(
        json!({"settings": {"runtime": "v3", "mcp": {"tier": "read"}}}),
    );
    assert!(open.is_ok(), "{open:?}");
}

#[test]
fn run_limits_default_to_the_cell_numbers_and_override_per_member() {
    let settings: Settings =
        serde_json::from_value(json!({"run_limits": {"wallMs": 5000}})).expect("partial override");
    let limits = settings.run_limits.expect("present");
    assert_eq!(limits.wall_ms, 5000);
    assert_eq!(
        RunLimits {
            wall_ms: 30_000,
            ..limits
        },
        RunLimits::default()
    );
    let defaults = serde_json::to_value(RunLimits::default()).expect("serializes");
    assert_eq!(
        defaults,
        json!({"source": 65536, "wallMs": 30000, "heapBytes": 16777216, "stackBytes": 1048576, "calls": 64, "pending": 4,
               "argBytes": 65536, "returnBytes": 65536, "treeBytes": 131072, "imageBytes": 2097152, "journal": 64,
               "children": 4, "batchCalls": 16})
    );
}

#[test]
fn cua_adapter_reads_the_old_boolean() {
    let coerced: Settings =
        serde_json::from_value(json!({"cua_adapter": true})).expect("boolean accepted");
    assert_eq!(coerced.cua_adapter, Some(CuaAdapter::Coerced(true)));
    let mode: Settings =
        serde_json::from_value(json!({"cua_adapter": "auto"})).expect("mode accepted");
    assert_eq!(
        mode.cua_adapter,
        Some(CuaAdapter::Mode(CuaAdapterMode::Auto))
    );
}

#[test]
fn admission_keys_are_the_rows_the_table_marks() {
    let keys: Vec<&str> = admission_keys().collect();
    assert_eq!(
        keys,
        [
            "stop_hotkey",
            "allow_host_relay_only_stop",
            "send_on_enter",
            "url_policy",
            "record",
            "x11_keymap_remap",
            "background_indicator",
            "intervention",
            "remote_commands",
            "foreground_input_lock",
            "x11_mpx",
            "wayland_lease_end_chord",
            "toolkit_routes",
            "app_scope",
        ]
    );
}
