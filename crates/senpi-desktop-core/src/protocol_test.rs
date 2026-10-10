use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::*;
use crate::engine_schema;
use crate::methods::{Effect, Exposure, Method, Notification, METHODS};

const SCHEMA_PATH: &str = "schema/engine.schema.json";
const DOC_PATH: &str = "docs/engine-protocol.md";

/// Compares a generated artifact with its committed copy, or rewrites the
/// copy when `SENPI_DESKTOP_UPDATE_SCHEMA=1`.
fn assert_fresh(relative: &str, generated: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    if std::env::var_os("SENPI_DESKTOP_UPDATE_SCHEMA").is_some_and(|value| value == "1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, generated).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == generated,
        "{relative} is stale: regenerate with SENPI_DESKTOP_UPDATE_SCHEMA=1 cargo test -p senpi-desktop-core"
    );
}

fn string_set(values: impl IntoIterator<Item = impl Into<String>>) -> BTreeSet<String> {
    values.into_iter().map(Into::into).collect()
}

/// Wire names of a string enum schema: its `enum`, or the `enum`s and
/// `const`s of its `oneOf` branches (schemars splits out documented variants).
fn enum_names(schema: &Value) -> BTreeSet<String> {
    let branches = schema["oneOf"]
        .as_array()
        .map_or_else(|| vec![schema], |branches| branches.iter().collect());
    let names = branches.into_iter().flat_map(|branch| {
        let listed = branch["enum"].as_array().cloned().unwrap_or_default();
        listed.into_iter().chain(branch.get("const").cloned())
    });
    names.map(|name| name.as_str().unwrap().to_owned()).collect()
}

#[test]
fn schema_is_fresh() {
    let generated = serde_json::to_string_pretty(&engine_schema()).unwrap() + "\n";
    assert_fresh(SCHEMA_PATH, &generated);
}

#[test]
fn protocol_doc_is_fresh() {
    assert_fresh(DOC_PATH, &protocol_doc());
}

#[test]
fn method_enum_lists_exactly_the_table_in_order() {
    // When
    let schema = engine_schema();
    // Then
    let table: Vec<&str> = METHODS.iter().map(|spec| spec.name).collect();
    assert_eq!(schema["definitions"]["Method"]["enum"], json!(table));
    assert_eq!(
        schema["methods"].as_object().unwrap().keys().collect::<Vec<_>>(),
        table
    );
}

#[test]
fn every_row_is_reachable_from_its_method_and_its_wire_name() {
    for spec in METHODS {
        assert_eq!(spec.method.spec(), spec);
        assert_eq!(Method::from_name(spec.name), Some(spec.method));
        assert_eq!(serde_json::to_value(spec.method).unwrap(), json!(spec.name));
    }
    assert_eq!(Method::from_name("reset"), None);
}

#[test]
fn only_session_and_stop_path_controls_are_host_only() {
    // When
    let host_only = METHODS.iter().filter(|spec| spec.exposure == Exposure::HostOnly);
    let test_only = METHODS.iter().filter(|spec| spec.exposure == Exposure::TestOnly);
    // Then: a bridge may still forward `stopPath.stop` and `stopPath.status`.
    assert_eq!(
        string_set(host_only.map(|spec| spec.name)),
        string_set([
            "session.open",
            "session.close",
            "stopPath.start",
            "stopPath.heartbeat",
            "stopPath.resume"
        ])
    );
    assert_eq!(
        string_set(test_only.map(|spec| spec.name)),
        string_set(["$/test.advanceClock"])
    );
}

#[test]
fn stopping_never_needs_an_exec_grant() {
    assert_eq!(Method::StopPathStop.spec().effect, Effect::Read);
    assert_eq!(Method::StopPathResume.spec().effect, Effect::Exec);
}

#[test]
fn error_table_lists_every_error_code_in_ordinal_order() {
    // When
    let schema = engine_schema();
    // Then
    let names = string_set(ERROR_CODES.iter().map(|code| code.as_str()));
    assert_eq!(enum_names(&schema["definitions"]["ErrorCode"]), names);
    let codes: Vec<i64> = ERROR_CODES.into_iter().map(rpc_error_code).collect();
    assert_eq!(
        codes,
        (0..21).map(|ordinal| -32_000 - ordinal).collect::<Vec<i64>>()
    );
    assert_eq!(schema["errors"]["Cancelled"], json!(-32_017));
}

#[test]
fn notification_names_are_their_wire_form() {
    let schema = engine_schema();
    for notification in Notification::ALL {
        assert_eq!(
            serde_json::to_value(notification).unwrap(),
            json!(notification.name())
        );
        assert!(schema["notifications"][notification.name()]["params"].is_object());
    }
}

/// The unit result `()` is JSON `null` on the wire.
fn wire_type(rust_type: &str) -> &str {
    if rust_type == "()" {
        "null"
    } else {
        rust_type
    }
}

fn yes_no(flag: bool) -> &'static str {
    if flag {
        "yes"
    } else {
        "no"
    }
}

/// Renders `docs/engine-protocol.md` from the method table.
fn protocol_doc() -> String {
    let mut doc = String::new();
    let header = format!(
        "# senpi-desktop engine protocol\n\n\
         <!-- GENERATED from `src/methods.rs` by the `protocol_doc_is_fresh` test. Do not edit; \
         regenerate with `SENPI_DESKTOP_UPDATE_SCHEMA=1 cargo test -p senpi-desktop-core`. -->\n\n\
         Protocol version `{PROTOCOL_VERSION}`, ABI `{ABI}`. JSON-RPC 2.0, one JSON message per line \
         (NDJSON) on stdio or a local socket. Requests carry a number or string `id` that the reply \
         echoes verbatim; replies may arrive out of order. `$/cancel` is sent as a notification (no `id`). \
         The machine-readable contract is [`schema/engine.schema.json`](../schema/engine.schema.json).\n\n\
         ## Methods\n\n\
         `read` observes or only narrows what the engine may do; `exec` acts on the desktop or widens \
         what the engine may do. Host-only methods are rejected by bridges such as `--oneshot`.\n\n\
         | Method | Effect | hostOnly | testOnly | Params | Result | Errors |\n\
         |---|---|---|---|---|---|---|\n"
    );
    doc.push_str(&header);
    for spec in METHODS {
        let rejection = match spec.exposure {
            Exposure::Public => "",
            Exposure::HostOnly => "; `-32601` hostOnly via a bridge",
            Exposure::TestOnly => "; `-32601` testOnly without `SENPI_DESKTOP_FAKE_CLOCK=1`",
        };
        let effect = match spec.effect {
            Effect::Read => "read",
            Effect::Exec => "exec",
        };
        writeln!(
            doc,
            "| `{}` | {effect} | {} | {} | `{}` | `{}` | `ErrorCode`{rejection} |",
            spec.name,
            yes_no(spec.exposure == Exposure::HostOnly),
            yes_no(spec.exposure == Exposure::TestOnly),
            spec.params,
            wire_type(spec.result),
        )
        .unwrap();
    }
    doc.push_str("\n## Notifications\n\n| Notification | Params |\n|---|---|\n");
    for notification in Notification::ALL {
        writeln!(doc, "| `{}` | `{}` |", notification.name(), notification.params()).unwrap();
    }
    doc.push_str(
        "\n## Errors\n\n\
         An engine error is `{code, message, data: {code: <ErrorCode>, hint}}`. A method-level rejection \
         is the standard `-32601 Method not found` with `data: {reason: \"unknown\" | \"hostOnly\" | \
         \"testOnly\"}`. Malformed input uses the standard `-32700`, `-32600`, and `-32602`.\n\n\
         | ErrorCode | JSON-RPC code |\n|---|---|\n",
    );
    for code in ERROR_CODES {
        writeln!(doc, "| `{}` | `{}` |", code.as_str(), rpc_error_code(code)).unwrap();
    }
    doc.push_str(
        "\n## Conformance corpus\n\n\
         `fixtures/conformance/*.json` hold ordered steps replayed against the engine over the fake \
         backend: `{description, scenario, env, steps: [{send, expect: [{message, variable}]}]}`. \
         `scenario` is the fake-backend scenario path (`SENPI_DESKTOP_BACKEND=fake:<scenario>`), `env` \
         the extra engine environment. Each step sends one message; `expect` lists every message the \
         engine emits for that step, in any order. `variable` holds JSON pointers into `message` whose \
         values are not compared (versions, tokens, paths, image bytes, prose). The \
         `conformance_fixtures_match_schema` test validates every message against the schema.\n",
    );
    doc
}
