//! Every `ErrorCode` declared in `senpi-desktop-core/src/error.rs` driven onto
//! the wire through the engine binary, each asserted with its `data.code` and
//! numeric code (`-32000 - ordinal`).

use std::thread;

use serde_json::{json, Value};

use crate::common::scenario::{capture, headless, make_stop_path_live, snapshot_ref, Scenario};
use crate::common::{error_code, Engine};
use crate::WINDOW;

const ERROR_RS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../senpi-desktop-core/src/error.rs");

/// The variants of `enum ErrorCode`, in declaration order.
fn declared_codes() -> Vec<String> {
    let source = std::fs::read_to_string(ERROR_RS).expect("error.rs is readable");
    let body = source
        .split("pub enum ErrorCode {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("error.rs declares enum ErrorCode");
    body.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("//") && !line.starts_with('#'))
        .map(|line| line.trim_end_matches(',').to_owned())
        .collect()
}

/// Every pointer, keyboard, window, and AX input method with parseable params.
/// `clipboard.write` is absent: the engine answers it `Internal` until the
/// clipboard lands with the backends.
pub fn input_calls() -> [(&'static str, Value); 11] {
    let at = json!({"target": "desktop", "x": 10.0, "y": 10.0});
    [
        ("click", at.clone()),
        ("moveMouse", at),
        (
            "drag",
            json!({"target": "desktop", "path": [{"x": 1.0, "y": 1.0}, {"x": 5.0, "y": 5.0}]}),
        ),
        (
            "scroll",
            json!({"target": "desktop", "x": 10.0, "y": 10.0, "dx": 0.0, "dy": 3.0}),
        ),
        ("typeText", json!({"target": WINDOW, "text": "hi"})),
        ("keyChord", json!({"target": WINDOW, "keys": ["ctrl", "a"]})),
        ("raiseWindow", json!({"windowId": WINDOW})),
        ("ax.perform", json!({"ref": "e1", "action": "press"})),
        ("ax.setValue", json!({"ref": "e1", "value": "hi"})),
        ("ax.focus", json!({"ref": "e1"})),
        ("ax.click", json!({"ref": "e1"})),
    ]
}

struct Case {
    code: &'static str,
    /// Top-level keys replacing the two-display scenario's.
    overlay: Value,
    env: &'static [(&'static str, &'static str)],
    /// Returns the reply that must carry `code`.
    drive: fn(&mut Engine) -> Value,
}

fn click(engine: &mut Engine, target: &str) -> Value {
    engine.invoke("click", json!({"target": target, "x": 10.0, "y": 10.0}))
}

fn open(engine: &mut Engine) {
    engine.invoke("session.open", json!({}));
}

/// A foreground click on the window, which captures and restores focus and cursor.
fn foreground_click(engine: &mut Engine) -> Value {
    make_stop_path_live(engine);
    capture(engine, WINDOW);
    let opts = json!({"deliveryMode": "foreground"});
    engine.invoke(
        "click",
        json!({"target": WINDOW, "x": 10.0, "y": 10.0, "opts": opts}),
    )
}

fn fail_next(method: &str) -> Value {
    json!({"fail_next": [{"method": method, "code": "InputFailed"}]})
}

const SHORT_DEADLINE: &[(&str, &str)] = &[("SENPI_DESKTOP_OPERATION_TIMEOUT_MS", "500")];

fn cases() -> Vec<Case> {
    let case = |code: &'static str, overlay: Value, drive: fn(&mut Engine) -> Value| Case {
        code,
        overlay,
        env: &[],
        drive,
    };
    vec![
        case(
            "PermissionDenied",
            json!({"capabilities": {"inputPermission": "denied"}}),
            |e| {
                make_stop_path_live(e);
                click(e, "desktop")
            },
        ),
        case(
            "CaptureFailed",
            json!({"capabilities": {"capture": false}}),
            |e| {
                open(e);
                e.invoke("capture", json!({"target": "desktop"}))
            },
        ),
        case("InputFailed", json!({"capabilities": {"input": false}}), |e| {
            make_stop_path_live(e);
            capture(e, WINDOW);
            click(e, WINDOW)
        }),
        case(
            "BackgroundUnavailable",
            json!({"capabilities": {"backgroundWindowInput": false}}),
            |e| {
                make_stop_path_live(e);
                capture(e, WINDOW);
                click(e, WINDOW)
            },
        ),
        case("WindowNotFound", json!({}), |e| {
            open(e);
            e.invoke("capture", json!({"target": "999"}))
        }),
        case("InvalidTarget", json!({}), |e| {
            open(e);
            e.invoke("capture", json!({"target": "desktop", "caps": {"maxWidth": 0}}))
        }),
        case("InvalidKey", json!({}), |e| {
            make_stop_path_live(e);
            e.invoke("keyChord", json!({"target": WINDOW, "keys": ["nosuchkey"]}))
        }),
        case("InvalidCoordinateFrame", json!({}), |e| {
            make_stop_path_live(e);
            click(e, "desktop")
        }),
        case("StaleRef", json!({}), |e| {
            open(e);
            e.invoke("ax.node", json!({"ref": "e9999"}))
        }),
        case("AxUnsupported", json!({"capabilities": {"ax": false}}), |e| {
            open(e);
            e.invoke("ax.snapshot", json!({"target": WINDOW}))
        }),
        case("AxFailed", json!({}), |e| {
            make_stop_path_live(e);
            let textarea = snapshot_ref(e, WINDOW, "textarea");
            e.invoke("ax.perform", json!({"ref": textarea, "action": "increment"}))
        }),
        Case {
            env: SHORT_DEADLINE,
            ..case("Timeout", json!({"delay_ms": {"capture": 5000}}), |e| {
                open(e);
                e.invoke("capture", json!({"target": WINDOW}))
            })
        },
        case("Closed", json!({}), |e| {
            open(e);
            e.invoke("session.close", json!({}));
            e.invoke("displays", json!({}))
        }),
        case(
            "Internal",
            json!({"fail_next": [{"method": "displays", "code": "Internal"}]}),
            |e| {
                open(e);
                e.invoke("displays", json!({}))
            },
        ),
        case("StopPathUnavailable", json!({}), |e| {
            open(e);
            click(e, "desktop")
        }),
        case("Suspended", json!({}), |e| {
            make_stop_path_live(e);
            e.invoke("stopPath.stop", json!({"source": "api"}));
            click(e, "desktop")
        }),
        case(
            "ScreenLocked",
            json!({"capabilities": {"screenLocked": true}}),
            |e| {
                make_stop_path_live(e);
                click(e, "desktop")
            },
        ),
        case("Cancelled", json!({"delay_ms": {"capture": 5000}}), |e| {
            open(e);
            e.request(10, "capture", json!({"target": WINDOW}));
            e.send(&json!({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": 10}}));
            e.next()
        }),
        case("CursorRestoreFailed", fail_next("warp_cursor"), foreground_click),
        case(
            "FocusRestoreFailed",
            fail_next("restore_front_window"),
            foreground_click,
        ),
        case("TransactionFailed", fail_next("front_window"), foreground_click),
    ]
}

/// Runs `case` on its own engine and thread; the reply, or why none came.
fn spawn(case: Case) -> thread::JoinHandle<Value> {
    thread::spawn(move || {
        let scenario = Scenario::two_displays_with(&case.overlay);
        let mut engine = headless(scenario.backend(), case.env);
        (case.drive)(&mut engine)
    })
}

#[test]
fn every_error_code_reaches_the_wire_with_its_numeric_code() {
    // Given
    let declared = declared_codes();
    let numeric = |code: &str| {
        let ordinal = declared.iter().position(|known| known == code)?;
        i64::try_from(ordinal).ok().map(|ordinal| -32_000 - ordinal)
    };
    // When: every case runs concurrently on its own engine
    let running: Vec<_> = cases().into_iter().map(|case| (case.code, spawn(case))).collect();
    let failures: Vec<String> = running
        .into_iter()
        .filter_map(|(code, driver)| {
            let Ok(reply) = driver.join() else {
                return Some(format!("{code}: the driver panicked (see its output above)"));
            };
            let expected = numeric(code).map(|numeric| (json!(code), json!(numeric)));
            let actual = (error_code(&reply).clone(), reply["error"]["code"].clone());
            (expected.as_ref() != Some(&actual))
                .then(|| format!("{code}: expected {expected:?}, got {reply}"))
        })
        .collect();
    // Then
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn the_code_table_drives_every_error_code_declared_in_error_rs() {
    let mut declared = declared_codes();
    let mut driven: Vec<String> = cases().into_iter().map(|case| case.code.to_owned()).collect();
    declared.sort();
    driven.sort();
    assert_eq!(driven, declared);
}
