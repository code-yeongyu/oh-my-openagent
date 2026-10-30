//! Every `ErrorCode` declared in `senpi-desktop-core/src/error.rs` driven onto
//! the wire through the engine binary, each asserted with its `data.code` and
//! numeric code (`-32000 - ordinal`).

use std::thread;

use serde_json::{json, Value};

use crate::common::scenario::{capture, headless, make_stop_path_live, snapshot_ref, Scenario};
use crate::common::{error_code, Engine};
use crate::WINDOW;

const ERROR_RS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../senpi-desktop-core/src/error.rs");

/// The variants of `enum ErrorCode`, in declaration order. The body ends at
/// the enum's own closing line, not at the first `}`: a doc comment may hold
/// braces (`CaptureUnavailable`'s does).
fn declared_codes() -> Vec<String> {
    let source = std::fs::read_to_string(ERROR_RS).expect("error.rs is readable");
    let body = source
        .split("pub enum ErrorCode {")
        .nth(1)
        .expect("error.rs declares enum ErrorCode");
    body.lines()
        .map(str::trim)
        .take_while(|line| *line != "}")
        .filter(|line| !line.is_empty() && !line.starts_with("//") && !line.starts_with('#'))
        .map(|line| line.trim_end_matches(',').to_owned())
        .collect()
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
    engine.invoke(
        "control.grant",
        json!({"reason": "restore failure cases", "confirmationId": "confirm-1"}),
    );
    let opts = json!({"deliveryMode": "foreground"});
    engine.invoke("click", json!({"target": WINDOW, "x": 10.0, "y": 10.0, "opts": opts}))
}

fn fail_next(method: &str) -> Value {
    fail_next_with(method, "InputFailed")
}

/// The fake fails the next `method` call with `code`: the wire path of a code
/// no fake scenario raises on its own yet.
fn fail_next_with(method: &str, code: &str) -> Value {
    json!({"fail_next": [{"method": method, "code": code}]})
}

/// A background click on the captured window.
fn window_click(engine: &mut Engine) -> Value {
    make_stop_path_live(engine);
    capture(engine, WINDOW);
    click(engine, WINDOW)
}

fn list_windows(engine: &mut Engine) -> Value {
    open(engine);
    engine.invoke("windows", json!({}))
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
        case("CaptureFailed", json!({"capabilities": {"capture": false}}), |e| {
            open(e);
            e.invoke("capture", json!({"target": "desktop"}))
        }),
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
            click(e, WINDOW)
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
        case("ScreenLocked", json!({"capabilities": {"screenLocked": true}}), |e| {
            make_stop_path_live(e);
            click(e, "desktop")
        }),
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
        case("ControlRequired", json!({}), |e| {
            make_stop_path_live(e);
            capture(e, WINDOW);
            let opts = json!({"deliveryMode": "foreground"});
            e.invoke("click", json!({"target": WINDOW, "x": 10.0, "y": 10.0, "opts": opts}))
        }),
        case(
            "CaptureUnavailable",
            json!({"fail_next": [{"method": "capture", "code": "CaptureUnavailable", "reason": "minimized"}]}),
            |e| {
                open(e);
                e.invoke("capture", json!({"target": WINDOW}))
            },
        ),
        case("UserIntervened", fail_next_with("click", "UserIntervened"), window_click),
        case("AxUnconfirmed", fail_next_with("ax_perform", "AxUnconfirmed"), |e| {
            make_stop_path_live(e);
            let textarea = snapshot_ref(e, WINDOW, "textarea");
            e.invoke("ax.perform", json!({"ref": textarea, "action": "press"}))
        }),
        case("SpaceUnsupported", fail_next_with("windows", "SpaceUnsupported"), list_windows),
        case("SpaceMoveDenied", fail_next_with("windows", "SpaceMoveDenied"), list_windows),
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

/// Every code driven over the wire. `InputBusy` is not among them: one engine
/// process holds one session, so a second session's grant cannot be driven
/// here; the session crate drives it with two sessions sharing one slot.
fn driven_codes() -> Vec<String> {
    cases().into_iter().map(|case| case.code.to_owned()).collect()
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
            (expected.as_ref() != Some(&actual)).then(|| format!("{code}: expected {expected:?}, got {reply}"))
        })
        .collect();
    // Then
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn the_code_table_drives_every_error_code_declared_in_error_rs() {
    let mut declared = declared_codes();
    declared.retain(|code| code != "InputBusy");
    let mut driven = driven_codes();
    declared.sort();
    driven.sort();
    assert_eq!(driven, declared);
}
