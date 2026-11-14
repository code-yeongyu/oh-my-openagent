//! Consent, the foreground lease and window reservations through `Session`, on the fake. The
//! two-session legs use two INDEPENDENT sessions on one shared RUNTIME root (R23).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::paths::Roots;
use serde_json::{json, Value};

use crate::consent::Part;
use crate::{Refused, Session};

const SCENARIO: &str = r#"{"displays":[{"id":"1","name":"Built-in Display","x":0,"y":0,"width":1920,"height":1080,"scale":1.0,"pixelX":0,"pixelY":0,"pixelWidth":1920,"pixelHeight":1080,"isPrimary":true}],"windows":[
  {"id":"1","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":100,"height":100,"focused":true,"elevated":null},
  {"id":"2","title":"u","app":"Mail","pid":4343,"x":200,"y":0,"width":100,"height":100,"focused":false,"elevated":null}]}"#;

pub(super) fn scenario(extra: &Value) -> FakeScenario {
    // A host view in the contract's shape always carries stopHotkey (R70ao(2)); a test that does
    // not name it gets null. "stopHotkeyNotCarried": true keeps the member out (the unreadable path).
    let mut extra = extra.clone();
    let not_carried = extra.get("stopHotkeyNotCarried").is_some();
    if let Some(map) = extra.as_object_mut() {
        map.remove("stopHotkeyNotCarried");
        if let Some(consent) = map.get_mut("consent").and_then(Value::as_object_mut) {
            if !not_carried {
                consent.entry("stopHotkey").or_insert(Value::Null);
            }
        }
    }
    let extra = &extra;
    let mut value: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    if let (Some(base), Some(more)) = (value.as_object_mut(), extra.as_object()) {
        base.extend(more.iter().filter(|(key, _)| *key != "object").map(|(k, v)| (k.clone(), v.clone())));
    }
    FakeScenario::from_value(&value).expect("scenario")
}

pub(super) fn session(extra: &Value, sink: &RecordingSink, roots: Option<(&Path, &str)>) -> Session {
    let backend = FakeBackend::with_parts(scenario(extra), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = match roots {
        None => Session::new(Box::new(backend)),
        Some((dir, name)) => Session::for_roots(
            Box::new(backend),
            &Roots {
                state: dir.join(name),
                runtime: dir.join("run"),
            },
        ),
    };
    let report = if extra.get("object").is_some() { "object" } else { "null" };
    session.open(params(json!({ "reportMode": report }))).expect("open");
    session.stop_path_start(params(json!({})));
    session
}

pub(super) fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params")
}

pub(super) fn reason(result: &Result<impl std::fmt::Debug, Refused>) -> Option<(&'static str, Option<&'static str>)> {
    result.as_ref().err().map(|r| (r.refusal.code.wire(), r.refusal.reason))
}

fn grant(session: &mut Session) {
    session.control_grant(params(json!({ "reason": "test", "confirmationId": "c-1" })));
}

/// Row 20: a click maps through the target's newest captured frame, so tests capture first.
pub(super) fn capture(session: &mut Session, target: &str) {
    session.capture(params(json!({ "target": target }))).expect("capture");
}

fn desktop_click(session: &mut Session) -> Result<omo_computer_core::results::ExecReply, Refused> {
    session.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })))
}

#[test]
fn denied_prompt_is_not_reasked_until_newer_user_message() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({}), &sink, None);
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", None)), "asks for the grant");
    s.record_denial(Part::Foreground, None);
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", Some("denied_this_turn"))));
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", Some("denied_this_turn"))));
    s.user_message();
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", None)), "asks again");
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn foreground_lease_single_holder() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (sink_a, sink_b) = (RecordingSink::default(), RecordingSink::default());
    let mut a = session(&json!({}), &sink_a, Some((dir.path(), "a")));
    let mut b = session(&json!({}), &sink_b, Some((dir.path(), "b")));
    grant(&mut a);
    grant(&mut b);
    assert!(a.control_acquire().is_ok());
    assert_eq!(reason(&a.control_acquire()), Some(("InputBusy", None)), "never taken twice");
    let busy = b.control_acquire().expect_err("held by a");
    assert_eq!(busy.refusal.code.wire(), "InputBusy");
    assert!(busy.detail.as_ref().is_some_and(|d| d["holder"]["sessionId"].is_string()));
    assert_eq!(reason(&desktop_click(&mut b)), Some(("InputBusy", None)));
    assert!(sink_b.lines().iter().all(|line| !line.contains("pointer")), "{:?}", sink_b.lines());
    capture(&mut a, "desktop");
    assert!(desktop_click(&mut a).is_ok(), "the holder clicks");
    a.close();
    assert!(b.control_acquire().is_ok(), "a closed session frees the slot");
}

#[test]
fn full_access_desktop_click_needs_no_prompt_and_a_window_target_stays_background() {
    let sink = RecordingSink::default();
    // The fake builds its host view from scenario.consent; the contract's view carries stopHotkey.
    let mut s = session(&json!({ "full_access_preset": true, "consent": {} }), &sink, None);
    capture(&mut s, "desktop");
    assert!(desktop_click(&mut s).is_ok());
    assert!(s.holds_lease());
    assert!(sink.lines().iter().any(|line| line.contains("presence show")), "{:?}", sink.lines());
    let mut plain = session(&json!({}), &RecordingSink::default(), None);
    assert_eq!(reason(&desktop_click(&mut plain)), Some(("ControlRequired", None)));
    capture(&mut plain, "1");
    assert!(plain.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).is_ok(), "background needs no grant");
}

#[test]
fn window_held_by_other_session_is_input_busy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let now = Arc::new(AtomicU64::new(1_000));
    let clock = {
        let now = now.clone();
        Arc::new(move || now.load(Ordering::SeqCst)) as crate::grant::MachineClock
    };
    let (sink_a, sink_b) = (RecordingSink::default(), RecordingSink::default());
    let mut a = session(&json!({}), &sink_a, Some((dir.path(), "a"))).with_clock(clock.clone());
    let mut b = session(&json!({}), &sink_b, Some((dir.path(), "b"))).with_clock(clock.clone());
    let typed = |s: &mut Session| s.type_text(params(json!({ "target": "1", "text": "hi" })));
    assert!(typed(&mut a).is_ok());
    let busy = typed(&mut b).expect_err("a holds window 1");
    assert_eq!((busy.refusal.code.wire(), busy.refusal.reason), ("InputBusy", Some("window")));
    let detail = busy.detail.expect("detail");
    assert_eq!(detail["window"], json!("1"));
    assert_eq!(detail["retryAfterMs"], json!(10_000));
    assert!(detail["holder"]["sessionId"].is_string());
    assert!(sink_b.is_empty(), "{:?}", sink_b.lines());
    assert!(b.type_text(params(json!({ "target": "2", "text": "x" }))).is_ok(), "another window");
    now.fetch_add(10_000, Ordering::SeqCst);
    assert!(typed(&mut b).is_ok(), "after a's report + 10,000 ms");
    let mut c = session(&json!({}), &RecordingSink::default(), Some((dir.path(), "c"))).with_clock(clock);
    assert_eq!(reason(&typed(&mut c)), Some(("InputBusy", Some("window"))));
    b.close();
    assert!(typed(&mut c).is_ok(), "closing the owner frees the window");
}

#[test]
fn stop_is_exempt_from_consent_off_and_a_consent_off_hand_still_latches() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "consent": { "computerUse": false } }), &sink, None);
    let click = |s: &mut Session| s.click(params(json!({ "target": "1", "x": 1, "y": 1 })));
    assert_eq!(reason(&click(&mut s)), Some(("ControlRequired", Some("consent_off"))));
    let status = s.stop_path_stop(params(json!({ "source": "user" })));
    assert!(status.suspended, "the stop latches on a consent-off hand");
    assert_eq!(reason(&click(&mut s)).map(|(code, _)| code), Some("Suspended"));
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn unbound_scope_name_refused_at_open() {
    let backend = FakeBackend::new(scenario(&json!({ "consent": { "scope": ["NoSuchApp"] } })));
    let mut s = Session::new(Box::new(backend));
    let refused = s.open(params(json!({}))).expect_err("no app binds");
    assert_eq!((refused.code.wire(), refused.reason), ("InvalidTarget", Some("app_unknown")));
    let bound = FakeBackend::new(scenario(&json!({ "consent": { "scope": ["notes"] } })));
    let mut s = Session::new(Box::new(bound));
    assert!(s.open(params(json!({}))).is_ok());
    assert_eq!(s.consent().view().scope, Some(vec!["Notes".to_owned()]));
}

#[test]
fn only_global_input_on_the_desktop_takes_the_lease_and_reserves_every_window() {
    use omo_computer_core::backend::Route;
    use omo_computer_core::methods::Method;
    use omo_computer_safety::TargetRef;
    let mut backend = FakeBackend::new(scenario(&json!({})));
    let mut control = crate::grant::Control::default();
    let click = control.plan(&mut backend, (Method::Click, &TargetRef::Desktop, Route::BackgroundWindow), 0);
    assert!(click.foreground);
    assert_eq!(click.windows, ["1", "2"]);
    let launch = control.plan(&mut backend, (Method::AppsOpen, &TargetRef::Desktop, Route::BackgroundPid), 0);
    assert!(!launch.foreground, "a launch lands on no pointer");
    assert!(launch.windows.is_empty(), "and reserves no window");
    let foreground = control.plan(&mut backend, (Method::AppsOpen, &TargetRef::Desktop, Route::ForegroundHid), 0);
    assert!(foreground.foreground, "a foreground route still needs the lease");
}

/// Review M3 of #13346: an app whose identity cannot be read is bound to its executable PATH.
/// The funnel must observe that path (not None), refuse a different executable under the same
/// app key, and carry `identity_unavailable` on the report of an admitted call.
#[test]
fn path_only_consent_binds_the_observed_executable_path() {
    let view = json!({ "consent": { "apps": { "allow": [{ "appKey": "Notes", "path": "/usr/bin/notes" }] } } });
    let mut moved = view.clone();
    moved["executable_path"] = json!({ "4242": "/tmp/evil/notes" });
    let mut same = view;
    same["executable_path"] = json!({ "4242": "/usr/bin/notes" });

    let sink = RecordingSink::default();
    let mut s = session(&moved, &sink, None);
    grant(&mut s);
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("another executable");
    assert_eq!(
        (refused.refusal.code.wire(), refused.refusal.reason),
        ("ControlRequired", Some("identity_changed"))
    );
    assert!(sink.is_empty(), "nothing sent: {:?}", sink.lines());

    let mut object = same;
    object["object"] = json!(true);
    let mut s = session(&object, &RecordingSink::default(), None);
    grant(&mut s);
    capture(&mut s, "1");
    let reply = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect("the approved path");
    assert_eq!(serde_json::to_value(&reply).expect("report")["warning"], json!("identity_unavailable"));
}

/// A-IS-61 Q5 through the funnel: an admitted call's audit line records how its entry was bound.
#[test]
fn audit_line_records_the_binding_of_an_admitted_call() {
    let run = |entry: Value, extra: Value| -> Value {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut scenario = json!({ "consent": { "apps": { "allow": [entry] } } });
        if let (Some(base), Some(more)) = (scenario.as_object_mut(), extra.as_object()) {
            base.extend(more.clone());
        }
        let mut s = session(&scenario, &RecordingSink::default(), Some((dir.path(), "a")));
        grant(&mut s);
        capture(&mut s, "1");
        s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect("admitted");
        let text = std::fs::read_to_string(dir.path().join("a/audit/computer/local/audit.jsonl")).expect("audit");
        let last = text.lines().rfind(|l| l.contains("\"click\"") || l.contains("click")).expect("a click line").to_owned();
        serde_json::from_str(&last).expect("json")
    };
    let path = run(json!({ "appKey": "Notes", "path": "/usr/bin/notes" }), json!({ "executable_path": { "4242": "/usr/bin/notes" } }));
    assert_eq!(path["appBinding"]["binding"], "path", "{path}");
    assert!(path["warnings"].as_array().is_some_and(|w| w.contains(&json!("identity_unavailable"))), "{path}");
    let ident = json!({ "teamId": "T1", "cdhash": "aa" });
    let id = run(json!({ "appKey": "Notes", "identity": ident }), json!({ "code_identity": { "4242": ident } }));
    assert_eq!(id["appBinding"]["binding"], "identity", "{id}");
    assert_eq!(id["appBinding"]["identitySha256_16"].as_str().map(str::len), Some(16), "{id}");
}

fn open_with(file_hotkey: Option<&str>, settings_hotkey: Option<&str>) -> Result<omo_computer_core::results::SessionOpened, omo_computer_core::backend::Refusal> {
    open_session_with(file_hotkey, settings_hotkey).1
}

fn open_session_with(
    file_hotkey: Option<&str>,
    settings_hotkey: Option<&str>,
) -> (Session, Result<omo_computer_core::results::SessionOpened, omo_computer_core::backend::Refusal>) {
    open_session_on(omo_computer_backend_fake::Persona::X11, file_hotkey, settings_hotkey)
}

/// R70bq(2): every leg names its persona, so the documented default it expects is that persona's
/// on every host, before and after the fake's default persona changes.
fn open_session_on(
    persona: omo_computer_backend_fake::Persona,
    file_hotkey: Option<&str>,
    settings_hotkey: Option<&str>,
) -> (Session, Result<omo_computer_core::results::SessionOpened, omo_computer_core::backend::Refusal>) {
    let consent = json!({ "stopHotkey": file_hotkey });
    let backend = FakeBackend::with_parts(scenario(&json!({ "consent": consent })), FakeClock::default(), RecordingSink::default())
        .with_persona(persona)
        .with_stop_path(StopPathScript::Live);
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = Session::for_roots(Box::new(backend), &Roots { state: dir.path().join("s"), runtime: dir.path().join("run") });
    std::mem::forget(dir);
    let mut open = json!({ "reportMode": "null" });
    if let Some(chord) = settings_hotkey {
        open["settings"] = json!({ "stop_hotkey": chord });
    }
    let opened = s.open(params(open));
    (s, opened)
}

/// A-IS-62 (R70ah/R70ai): the stop chord has ONE source, the consent file's stopHotkey. A
/// session.open stop_hotkey that differs from it is refused ControlRequired{permission_changed}
/// before anything is armed; an equal one or none is accepted.
#[test]
fn a_is_62_open_stop_hotkey_must_equal_the_consent_file() {
    let refused = open_with(Some("ctrl+alt+shift+f12"), Some("ctrl+alt+shift+escape")).expect_err("differs");
    // R70aj: the tampered class, encoded as the tampered-file refusal (the file is intact).
    assert_eq!((refused.code.wire(), refused.reason), ("ControlRequired", Some("tampered")));
    let (mut s, refused) = open_session_with(Some("ctrl+alt+shift+f12"), Some("ctrl+alt+shift+escape"));
    assert!(refused.is_err());
    // A-IS-62 rev 5 (R70an C) reverses R70aj: the hand reads tampered at once.
    assert!(s.funnel.control.consent.view().tampered, "the hand reads tampered");
    let path = crate::audit::AuditSink::path(s.funnel.audit()).map(std::path::Path::to_path_buf).expect("an audit file");
    let audit = std::fs::read_to_string(path).expect("audit");
    let lines: Vec<&str> = audit.lines().filter(|l| l.contains("\"stop_hotkey\"")).collect();
    assert_eq!(lines.len(), 1, "one audit line for the refused call: {audit}");
    assert!(lines[0].contains("\"tampered\""), "{}", lines[0]);
    assert!(lines[0].contains("ctrl+alt+shift+f12") && lines[0].contains("ctrl+alt+shift+escape"), "both chords: {}", lines[0]);
    let status = s.stop_path_status();
    assert!(!status.global_live && !status.host_relay_live, "nothing armed: {status:?}");
    assert!(open_with(Some("ctrl+alt+shift+f12"), Some("ctrl+alt+shift+f12")).is_ok(), "equal");
    assert!(open_with(Some("ctrl+alt+shift+f12"), None).is_ok(), "absent");
    // An absent file key is the OS default; the same chord passed explicitly is accepted.
    // The documented default of the named persona (X11 here, and macOS below).
    let default = crate::consent::default_stop_hotkey(omo_computer_safety::protected::Os::Linux);
    assert!(open_with(None, Some(default)).is_ok(), "the X11 persona's documented default");
    assert!(open_with(None, Some("ctrl+alt+shift+f12")).is_err(), "differs from the default");
    let mac = omo_computer_backend_fake::Persona::Macos;
    assert!(open_session_on(mac, None, Some("ctrl+opt+cmd+escape")).1.is_ok(), "the macOS persona's documented default");
    assert!(open_session_on(mac, None, Some("ctrl+alt+shift+escape")).1.is_err(), "the Linux default is not macOS's");
}

/// A-IS-62: an unparseable stopHotkey in the file is not a chord and never falls back to the default.
#[test]
fn a_is_62_unparseable_file_chord_never_falls_back_to_the_default() {
    let view = crate::consent::ConsentView::from_host(json!({ "stopHotkey": "ctrl+" }));
    assert_eq!(view.stop_chord(omo_computer_safety::protected::Os::Linux), crate::consent::StopChord::Unparseable("ctrl+".to_owned()));
    let absent = crate::consent::ConsentView::from_host(json!({ "stopHotkey": null }));
    assert_eq!(absent.stop_chord(omo_computer_safety::protected::Os::Linux), crate::consent::StopChord::Chord("ctrl+alt+shift+escape".to_owned()));
    let default = crate::consent::default_stop_hotkey(omo_computer_safety::protected::Os::Linux);
    assert!(open_with(Some("ctrl+"), Some(default)).is_err(), "the default never stands in for an unparseable chord");
}

/// A-IS-62 rev 5 (R70al): chords compare through the engine's ONE chord parser. On macOS the
/// v1 host's default 'ctrl+alt+cmd+escape' EQUALS the pin's 'ctrl+opt+cmd+escape'; an unparseable
/// chord differs.
#[test]
fn a_is_62_chords_compare_through_the_one_parser() {
    use omo_computer_safety::protected::Os;
    let view = crate::consent::ConsentView::from_host(json!({ "stopHotkey": null }));
    assert!(view.same_stop_chord(Os::Macos, "ctrl+alt+cmd+escape"), "the measured macOS pair");
    assert!(view.same_stop_chord(Os::Macos, "CMD+Ctrl+Option+Esc"), "order, case and spelling fold");
    assert!(!view.same_stop_chord(Os::Macos, "ctrl+alt+shift+escape"));
    assert!(!view.same_stop_chord(Os::Macos, "ctrl+"), "unparseable differs");
    let bad = crate::consent::ConsentView::from_host(json!({ "stopHotkey": "ctrl+" }));
    assert!(!bad.same_stop_chord(Os::Linux, "ctrl+"), "nothing equals an unparseable file chord");
}

/// A-IS-62 rev 5 (R70an A): with the fake backend the documented default is the PERSONA's OS,
/// never the host's: a macOS persona accepts the macOS default (and the v1 macOS spelling) on any host.
#[test]
fn a_is_62_the_fake_default_is_the_persona_os() {
    let open = |persona, chord: &str| {
        let backend = FakeBackend::with_parts(scenario(&json!({})), FakeClock::default(), RecordingSink::default())
            .with_persona(persona)
            .with_stop_path(StopPathScript::Live);
        let mut s = Session::new(Box::new(backend));
        s.open(params(json!({ "reportMode": "null", "settings": { "stop_hotkey": chord } })))
    };
    use omo_computer_backend_fake::Persona;
    assert!(open(Persona::Macos, "ctrl+opt+cmd+escape").is_ok(), "the pin's macOS default");
    assert!(open(Persona::Macos, "ctrl+alt+cmd+escape").is_ok(), "the v1 macOS host's spelling");
    assert!(open(Persona::Macos, "ctrl+alt+shift+escape").is_err(), "the Linux default is not macOS's");
    assert!(open(Persona::X11, "ctrl+alt+shift+escape").is_ok());
    assert!(open(Persona::Win32, "ctrl+alt+shift+escape").is_ok());
}

/// A-IS-62 rev 5 (R70an C): after a refused chord the HAND reads tampered: every exec is refused
/// before any mutate, reads continue. The mark survives session.close and a re-open of the SAME
/// consent.
#[test]
fn a_is_62_a_refused_chord_leaves_the_hand_tampered() {
    let backend = FakeBackend::with_parts(scenario(&json!({ "consent": { "stopHotkey": "ctrl+alt+shift+f12" } })), FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut s = Session::new(Box::new(backend));
    let open = |s: &mut Session, chord: Option<&str>| {
        let mut p = json!({ "reportMode": "null" });
        if let Some(chord) = chord { p["settings"] = json!({ "stop_hotkey": chord }); }
        s.open(params(p))
    };
    assert!(open(&mut s, Some("ctrl+alt+shift+escape")).is_err(), "a differing chord");
    open(&mut s, None).expect("re-open with the same consent");
    assert!(s.funnel.control.consent.view().tampered, "the hand reads tampered");
    s.stop_path_start(params(json!({})));
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("exec refused");
    assert_eq!(refused.refusal.reason, Some("tampered"));
    s.close();
    open(&mut s, None).expect("re-open after close");
    assert!(s.funnel.control.consent.view().tampered, "survives close and a re-open of the same consent");
}

/// R70as(2): the mark is NEVER cleared in-process, not even by an open whose consent differs (a
/// same-uid rewrite of the file must not clear it); only row 37's audited consent_save will.
#[test]
fn a_is_62_the_tampered_mark_is_never_cleared_in_process() {
    let mut mark = crate::grant::ChordTamper::default();
    let a = json!({ "stopHotkey": "ctrl+alt+shift+f12" });
    let b = json!({ "stopHotkey": "ctrl+alt+shift+escape" });
    assert!(!mark.holds(Some(&a)), "no refusal, no mark");
    mark.refused(Some(&a));
    assert!(mark.holds(Some(&a)), "the same consent keeps it");
    assert!(mark.holds(Some(&b)), "a rewritten consent keeps it too");
    assert!(mark.holds(None), "and no consent keeps it");
}

// R70ao(2), R70bs(1): the handed view's stopHotkey is `Option<Option<String>>`
// (consent/view.rs, ConsentView::stop_hotkey): null = absent in the file (the OS default is the
// configured chord), a string = the configured chord, a missing member = NOT carried. One test
// per state; a file value that is not a chord never falls back to the default.

/// State 1: null is absent in the file, so the persona OS's default is the configured chord (a
/// view built in code is this state too).
#[test]
fn a_is_62_stop_hotkey_null_is_the_os_default() {
    use crate::consent::{ConsentView, StopChord};
    use omo_computer_safety::protected::Os;
    assert_eq!(ConsentView::from_host(json!({ "stopHotkey": null })).stop_chord(Os::Linux), StopChord::Chord("ctrl+alt+shift+escape".to_owned()));
    assert_eq!(ConsentView::default().stop_chord(Os::Linux), StopChord::Chord("ctrl+alt+shift+escape".to_owned()), "a view built in code is 'absent in the file'");
}

/// State 2: a string is the configured chord.
#[test]
fn a_is_62_stop_hotkey_string_is_the_configured_chord() {
    use crate::consent::{ConsentView, StopChord};
    use omo_computer_safety::protected::Os;
    assert_eq!(ConsentView::from_host(json!({ "stopHotkey": "ctrl+alt+shift+f12" })).stop_chord(Os::Linux), StopChord::Chord("ctrl+alt+shift+f12".to_owned()));
}

/// State 3: a view without the member does not carry it: unreadable, nothing equal, and every
/// exec on the hand is refused, fail-closed (R70an B's interim shape).
#[test]
fn a_is_62_stop_hotkey_missing_is_not_carried_and_refuses_every_exec() {
    use crate::consent::{ConsentView, StopChord};
    use omo_computer_safety::protected::Os;
    let missing = ConsentView::from_host(json!({}));
    assert_eq!(missing.stop_chord(Os::Linux), StopChord::Unreadable);
    assert!(!missing.same_stop_chord(Os::Linux, "ctrl+alt+shift+escape"), "nothing is equal");
    let mut s = session(&json!({ "consent": { "apps": {} }, "stopHotkeyNotCarried": true }), &RecordingSink::default(), None);
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("unreadable chord");
    // R70as(3): stopPath.start armed nothing, so the stop-path gate refuses first.
    assert_eq!(refused.refusal.code.wire(), "StopPathUnavailable");
}

/// A file value that is not a chord is neither the configured chord nor the default: it never
/// falls back.
#[test]
fn a_is_62_stop_hotkey_non_chord_never_falls_back_to_the_default() {
    use crate::consent::{ConsentView, StopChord};
    use omo_computer_safety::protected::Os;
    let view = ConsentView::from_host(json!({ "stopHotkey": "ctrl+" }));
    assert_eq!(view.stop_chord(Os::Linux), StopChord::Unparseable("ctrl+".to_owned()));
    assert!(!view.same_stop_chord(Os::Linux, "ctrl+alt+shift+escape"), "never the default");
}

/// A-IS-62 rev 5 (R70aq): stopPath.start arms the configured chord FIRST, then compares the carried
/// one. No chord or an equal one answers exactly as before; a differing chord is refused (one audit
/// line, the hand reads tampered) and still leaves the configured chord armed.
#[test]
fn a_is_62_stop_path_start_carried_chord() {
    let start = |carried: Option<&str>| {
        let backend = FakeBackend::with_parts(scenario(&json!({ "consent": { "stopHotkey": "ctrl+alt+shift+f12" } })), FakeClock::default(), RecordingSink::default())
            .with_stop_path(StopPathScript::Live);
        let mut s = Session::new(Box::new(backend));
        s.open(params(json!({ "reportMode": "null" }))).expect("open");
        let p = carried.map_or_else(|| json!({}), |c| json!({ "chord": c }));
        let answer = s.stop_path_start_checked(params(p));
        (s, answer)
    };
    let (_, none) = start(None);
    let (_, equal) = start(Some("CTRL+Alt+Shift+F12"));
    assert_eq!(none.as_ref().ok(), equal.as_ref().ok(), "an equal chord answers as no chord");
    assert!(none.expect("no chord").global_live);
    let (s, refused) = start(Some("ctrl+alt+shift+escape"));
    let refusal = refused.expect_err("a differing chord");
    assert_eq!((refusal.code.wire(), refusal.reason), ("ControlRequired", Some("tampered")));
    let status = s.stop_path_status();
    assert!(status.global_live && status.stop_path == "global", "the configured chord stays armed: {status:?}");
    assert!(s.funnel.control.consent.view().tampered, "the hand reads tampered");
    let (_, unparseable) = start(Some("ctrl+"));
    assert!(unparseable.is_err(), "an unparseable carried chord differs");
}

/// R70ar: each explicit-stop-key scenario is its base plus ONLY consent.stopHotkey equal to the
/// chord its cases record, so a copy can never drift from its base.
#[test]
fn explicit_stop_key_fixtures_equal_their_base_plus_one_member() {
    let dir = omo_computer_backend_fake::fixtures_dir();
    let read = |name: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(dir.join(name)).expect("fixture")).expect("json")
    };
    for base in ["two-displays-one-window", "ax-type-text", "ax-unconfirmed", "remote-typing", "user-intervened"] {
        let mut copy = read(&format!("v3-{base}-explicit-stop-key.json"));
        let consent = copy.as_object_mut().and_then(|map| map.remove("consent"));
        assert_eq!(consent, Some(json!({ "stopHotkey": "ctrl+alt+shift+escape" })), "{base}: only the recorded chord");
        assert_eq!(copy, read(&format!("{base}.json")), "{base}: the copy equals its base");
    }
}

/// R70as(3): where the engine cannot read the configured chord, stopPath.start arms NOTHING and is
/// refused; no chord is compared or accepted as equal.
#[test]
fn a_is_62_an_unreadable_chord_arms_nothing() {
    for carried in [None, Some("ctrl+alt+shift+escape")] {
        let backend = FakeBackend::with_parts(scenario(&json!({ "consent": { "apps": {} }, "stopHotkeyNotCarried": true })), FakeClock::default(), RecordingSink::default())
            .with_stop_path(StopPathScript::Live);
        let mut s = Session::new(Box::new(backend));
        s.open(params(json!({ "reportMode": "null" }))).expect("open");
        let p = carried.map_or_else(|| json!({}), |c| json!({ "chord": c }));
        assert!(s.stop_path_start_checked(params(p)).is_err(), "{carried:?}: refused");
        let status = s.stop_path_status();
        assert!(!status.global_live, "{carried:?}: nothing armed: {status:?}");
    }
}

fn rearm_session(first: &str) -> (Session, omo_computer_backend_fake::FakeConsentHandle) {
    let backend = FakeBackend::with_parts(scenario(&json!({ "consent": { "stopHotkey": first } })), FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let handle = backend.consent_handle();
    let mut s = Session::new(Box::new(backend));
    s.open(params(json!({ "reportMode": "null" }))).expect("open");
    s.stop_path_start_checked(params(json!({}))).expect("armed");
    (s, handle)
}

/// R70av: the configured chord is remembered at stopPath.start; when the fingerprinted stop key
/// changes, the listener is re-armed before the next exec is admitted.
#[test]
fn a_is_62_a_changed_stop_key_rearms_before_the_next_exec() {
    let (mut s, handle) = rearm_session("ctrl+alt+shift+f12");
    assert_eq!(s.funnel.control.armed_chord.as_deref(), Some("ctrl+alt+shift+f12"));
    handle.set(json!({ "stopHotkey": "ctrl+alt+shift+f11" }));
    s.open(params(json!({ "reportMode": "null" }))).expect("re-open");
    capture(&mut s, "1");
    s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect("admitted after the re-arm");
    assert_eq!(s.funnel.control.armed_chord.as_deref(), Some("ctrl+alt+shift+f11"), "re-armed on the new chord");
    assert!(s.stop_path_status().global_live);
}

/// R70av: a new chord that cannot be read or parsed reads deaf at once (never stale): the next
/// exec is refused StopPathUnavailable{deaf} before any mutate.
#[test]
fn a_is_62_an_unparseable_new_stop_key_reads_deaf_at_once() {
    let (mut s, handle) = rearm_session("ctrl+alt+shift+f12");
    handle.set(json!({ "stopHotkey": "ctrl+" }));
    s.open(params(json!({ "reportMode": "null" }))).expect("re-open");
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("deaf");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("StopPathUnavailable", Some("deaf")));
    assert!(!s.stop_path_status().global_live, "never read live or stale");
}

/// R70av: a chord the backend cannot arm (set_stop_chord refuses) arms nothing and reads deaf at
/// once, at stopPath.start and at the re-arm.
#[test]
fn a_is_62_a_chord_the_backend_cannot_arm_reads_deaf() {
    let backend = FakeBackend::with_parts(
        scenario(&json!({ "consent": { "stopHotkey": "ctrl+alt+shift+f12" }, "unarmable_stop_chords": ["ctrl+alt+shift+f11"] })),
        FakeClock::default(),
        RecordingSink::default(),
    )
    .with_stop_path(StopPathScript::Live);
    let handle = backend.consent_handle();
    let mut s = Session::new(Box::new(backend));
    s.open(params(json!({ "reportMode": "null" }))).expect("open");
    s.stop_path_start_checked(params(json!({}))).expect("the configured chord arms");
    assert!(s.stop_path_status().global_live);
    handle.set(json!({ "stopHotkey": "ctrl+alt+shift+f11" }));
    s.open(params(json!({ "reportMode": "null" }))).expect("re-open");
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("deaf");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("StopPathUnavailable", Some("deaf")));
}

fn busy_with_stop(stop: bool) -> Value {
    let mut extra = json!({
        "busy_timeline": [
            { "t_ms": 0, "window": "1", "busy": true, "indicator": "spinner" },
            { "t_ms": 400, "window": "1", "busy": false }
        ]
    });
    if stop {
        extra["stop_timeline"] = json!([{ "t_ms": 200 }]);
    }
    extra
}

/// R70s(1) twin on row 19's timed stop trigger: a stop pressed during the busy wait of a
/// foreground call refuses it with nothing sent, ends the lease through the funnel and revokes
/// the grant, so the next foreground call needs a new grant. Without the stop the call is sent.
#[test]
fn a_stop_during_the_busy_wait_ends_the_lease_and_revokes_the_grant() {
    let sink = RecordingSink::default();
    let mut s = session(&busy_with_stop(true), &sink, None);
    grant(&mut s);
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5, "delivery": "foreground" }))).expect_err("the stop refuses");
    assert_eq!(refused.refusal.code.wire(), "Suspended");
    assert!(sink.lines().iter().all(|line| !line.contains("click") && !line.contains("mouse")), "nothing sent: {:?}", sink.lines());
    assert!(!s.holds_lease(), "the lease ended through the funnel");
    assert!(!s.funnel.control.grant.is_held(), "the stop revoked the grant");
    let control_sink = RecordingSink::default();
    let mut control = session(&busy_with_stop(false), &control_sink, None);
    grant(&mut control);
    capture(&mut control, "1");
    control.click(params(json!({ "target": "1", "x": 5, "y": 5, "delivery": "foreground" }))).expect("sent after the wait");
}

/// R70al(2): the session's consent takes the backend's OS (the persona for the fake), never the
/// host's: a macOS persona denies the macOS-only seed com.apple.keychainaccess on any host.
#[test]
fn the_consent_seeds_follow_the_persona_os() {
    let backend = FakeBackend::with_parts(scenario(&json!({ "consent": {} })), FakeClock::default(), RecordingSink::default())
        .with_persona(omo_computer_backend_fake::Persona::Macos);
    let mut s = Session::new(Box::new(backend));
    s.open(params(json!({ "reportMode": "null" }))).expect("open");
    let app = crate::consent::AppTarget {
        app_key: "com.apple.keychainaccess".to_owned(),
        bound: crate::consent::BoundIdentity::new(None, None),
    };
    let denial = s.funnel.control.consent.admit_exec(Some(&app)).expect_err("a macOS seed");
    assert_eq!(denial.refusal, omo_computer_safety::gate::verdicts::ConsentRefusal::DeniedApp);
}

/// A-IS-62 rev 7 (R70bl): a carried chord longer than 256 bytes is refused as differing, never cut
/// and then compared; in the audit line each chord is cut to its first 256 bytes.
#[test]
fn a_chord_longer_than_256_bytes_is_refused_and_cut_only_in_the_audit_line() {
    let configured = "ctrl+alt+shift+f12";
    let long = format!("{configured}{}", " ".repeat(300));
    let (mut s, refused) = open_session_with(Some(configured), Some(&long));
    let refusal = refused.expect_err("longer than 256 bytes differs, even if its first bytes equal the chord");
    assert_eq!(refusal.reason, Some("tampered"));
    let path = crate::audit::AuditSink::path(s.funnel.audit()).map(std::path::Path::to_path_buf).expect("an audit file");
    let audit = std::fs::read_to_string(path).expect("audit");
    let line = audit.lines().find(|l| l.contains("\"stop_hotkey\"")).expect("the refusal line");
    let v: Value = serde_json::from_str(line).expect("json");
    let carried = v["evidence"].as_array().and_then(|e| e.iter().find_map(|x| x.as_str()?.strip_prefix("carried="))).expect("carried");
    assert_eq!(carried.len(), 256, "cut to 256 bytes in the audit line");
}

/// The chord-refusal audit line names the call that carried the chord: session.open or stopPath.start.
#[test]
fn the_refusal_line_names_the_call_that_carried_the_chord() {
    let (mut s, opened) = open_session_with(Some("ctrl+alt+shift+f12"), None);
    opened.expect("open");
    assert!(s.stop_path_start_checked(params(json!({ "chord": "ctrl+alt+shift+escape" }))).is_err());
    let path = crate::audit::AuditSink::path(s.funnel.audit()).map(std::path::Path::to_path_buf).expect("an audit file");
    let audit = std::fs::read_to_string(path).expect("audit");
    let line = audit.lines().find(|l| l.contains("\"stop_hotkey\"")).expect("the refusal line");
    assert!(line.contains("\"action\":\"stopPath.start\""), "{line}");
}

/// A-IS-64 item 9 (R70bp(2)): the code-built Consent::default() is never the consent of a session
/// that admits an exec or arms a chord. Before session.open an exec answers NOT_OPEN with nothing
/// sent, and no chord is armed.
#[test]
fn the_code_built_default_consent_admits_no_exec_and_arms_no_chord() {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(scenario(&json!({})), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut s = Session::new(Box::new(backend));
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("no session is open");
    assert_eq!(refused.refusal, crate::NOT_OPEN);
    assert!(sink.lines().is_empty(), "nothing sent: {:?}", sink.lines());
    assert!(!s.stop_path_status().global_live, "no chord armed");
    assert!(s.funnel.control.armed_chord.is_none(), "no chord armed");
    // Past session.open the host's file replaces the code-built default: a file that switches
    // computer use off and configures its own chord refuses the exec (ControlRequired, consent_off) and arms that
    // chord. A session that kept Consent::default() (computer use on, the exec tier, the OS
    // default chord) would admit the exec and arm the default instead.
    let sink = RecordingSink::default();
    let file = json!({ "consent": { "computerUse": false, "stopHotkey": "ctrl+alt+shift+f12" } });
    let backend = FakeBackend::with_parts(scenario(&file), FakeClock::default(), sink.clone())
        .with_persona(omo_computer_backend_fake::Persona::X11)
        .with_stop_path(StopPathScript::Live);
    let mut s = Session::new(Box::new(backend));
    s.open(params(json!({ "reportMode": "null" }))).expect("open");
    assert_ne!(s.funnel.control.consent.view(), crate::consent::Consent::default().view(), "open replaced the code-built consent");
    s.stop_path_start_checked(params(json!({}))).expect("the file's chord arms");
    assert_eq!(s.funnel.control.armed_chord.as_deref(), Some("ctrl+alt+shift+f12"), "the file's chord, never the default");
    grant(&mut s);
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("computer use is off in the file");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("ControlRequired", Some("consent_off")));
    assert!(sink.lines().iter().all(|line| !line.contains("click") && !line.contains("mouse")), "nothing sent: {:?}", sink.lines());
}

/// #13391 merged into row 21 (R70bg(2) with R70s(1)): a stop pressed while another holder keeps
/// the interaction lock refuses the waiting foreground exec `Suspended` with nothing sent
/// (#13391's re-admit after the lock), AND row 21's lease ends through the funnel and the grant is
/// revoked (row 21's reconcile at that re-admit), and the lock comes free.
#[test]
fn a_stop_while_another_holder_keeps_the_lock_ends_the_lease_and_revokes_the_grant() {
    let dir = tempfile::tempdir().expect("tempdir");
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(scenario(&json!({})), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let remote = backend.handle();
    let runtime = dir.path().join("run");
    let mut s = Session::for_roots(Box::new(backend), &Roots { state: dir.path().join("s"), runtime: runtime.clone() });
    s.open(params(json!({ "reportMode": "null" }))).expect("open");
    s.stop_path_start(params(json!({})));
    grant(&mut s);
    capture(&mut s, "1");
    let other = crate::lock::InteractionLock::under(&runtime);
    let held = other.acquire().expect("the other holder takes the lock");
    let seen = sink.clone();
    let presser = std::thread::spawn(move || {
        // The lease is taken (its presence shows) before the exec waits on the lock; only then is
        // the stop pressed and the lock released. Bounded: a session that never takes it fails here.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !seen.lines().iter().any(|line| line == "presence show") {
            assert!(std::time::Instant::now() < deadline, "the session never took the lease");
            std::thread::yield_now();
        }
        remote.press_stop_chord();
        drop(held);
    });
    let refused = s
        .click(params(json!({ "target": "1", "x": 5, "y": 5, "delivery": "foreground" })))
        .expect_err("the stop pressed while waiting refuses");
    presser.join().expect("presser");
    assert_eq!(refused.refusal.code.wire(), "Suspended");
    // The lease's own presence lines (show, then hide at its end) are not input.
    assert!(sink.lines().iter().all(|line| !line.contains("click") && !line.contains("mouse")), "nothing sent: {:?}", sink.lines());
    assert!(sink.lines().iter().any(|line| line == "presence hide"), "the lease ended: {:?}", sink.lines());
    assert!(!s.holds_lease(), "the lease ended through the funnel");
    assert!(!s.funnel.control.grant.is_held(), "the stop revoked the grant");
    assert!(other.try_acquire().expect("try").is_some(), "the refused exec released the lock");
}
