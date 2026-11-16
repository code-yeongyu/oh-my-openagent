//! Amendment A-IS-64 (R70bm, R70bn): the per-OS protected-targets table is the one of the OS the
//! session's backend acts on, chosen once at `session.open`; the fake plays x11 when its scenario
//! names no persona. Tests 1, 2, 4, 7 and 8 of the amendment, and `Persona::host()` kept to tests.

use omo_computer_backend_fake::{FakeBackend, Persona, StopPathScript};
use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Route, StopListener, TaggedInput, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::methods::Method;
use omo_computer_safety::protected::{Os, ProtectedTable};
use serde_json::json;

use crate::grant::HostCallError;
use crate::Session;

const WINDOWS: &str = r#"{"windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

fn opened(backend: Box<dyn Backend>) -> Session {
    let mut session = Session::new(backend);
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open params")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start params"));
    session
}

fn playing(persona: Option<Persona>) -> Session {
    let fake = FakeBackend::from_json(WINDOWS).expect("scenario").with_stop_path(StopPathScript::Live);
    let fake = match persona {
        Some(persona) => fake.with_persona(persona),
        None => fake,
    };
    opened(Box::new(fake))
}

fn table_of(session: &Session) -> &'static str {
    &session.guard.table().os
}

/// Test 1: a persona's own table applies on every host, whatever the compile target.
#[test]
fn each_persona_applies_its_own_os_table_on_every_host() {
    for (persona, os) in [(Persona::Macos, "macos"), (Persona::Win32, "windows"), (Persona::X11, "linux")] {
        assert_eq!(table_of(&playing(Some(persona))), os, "{persona:?}");
    }
}

/// Test 2: a dangerous chord of the persona's own list is refused; one only another OS lists is not
/// refused as dangerous.
#[test]
fn a_dangerous_chord_of_the_personas_own_list_is_refused_and_another_oss_is_not() {
    for (persona, own, foreign) in [
        (Persona::Macos, "cmd+q", "alt+f4"),
        (Persona::X11, "ctrl+alt+backspace", "cmd+q"),
        (Persona::Win32, "alt+f4", "ctrl+alt+backspace"),
    ] {
        let mut session = playing(Some(persona));
        session.control_grant(serde_json::from_value(json!({"reason": "test"})).expect("grant"));
        let reason = |chord: &str, session: &mut Session| match session
            .host_call(Method::KeyDown, json!({"target": "101", "chord": chord}))
            .expect("served")
        {
            Err(HostCallError::Refused(refused)) => refused.refusal.reason.map(omo_computer_core::error::Reason::wire),
            Err(HostCallError::Params(error)) => panic!("{chord}: {error}"),
            Ok(_) => None,
        };
        assert_eq!(reason(own, &mut session), Some("dangerous_chord"), "{persona:?} {own}");
        assert_ne!(reason(foreign, &mut session), Some("dangerous_chord"), "{persona:?} {foreign}");
    }
}

/// A non-fake backend that declares no platform.
struct NoPlatform(FakeBackend);

impl Backend for NoPlatform {
    fn capabilities(&self) -> Capabilities {
        self.0.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.0.windows(filter)
    }
    fn capture(
        &mut self,
        target: &omo_computer_core::backend::Target,
        options: &omo_computer_core::backend::CaptureOptions,
    ) -> BackendResult<omo_computer_core::backend::FrameBytes> {
        self.0.capture(target, options)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.0.post_input(input, route)
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.0.stop_listener()
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.0.probe_permissions()
    }
}

/// Test 4's fallback leg: a non-fake backend declaring no platform applies the compile target's table.
#[test]
fn a_backend_declaring_no_platform_applies_the_compile_targets_table() {
    let backend = NoPlatform(FakeBackend::from_json(WINDOWS).expect("scenario"));
    let session = opened(Box::new(backend));
    assert_eq!(session.guard.table(), ProtectedTable::of(Os::host()));
}

/// Test 7: the X11 and the Wayland personas apply the linux table, and a scenario that names no
/// persona plays x11 on every host (the fixed default).
#[test]
fn a_scenario_without_a_persona_plays_x11_on_every_host() {
    assert_eq!(table_of(&playing(Some(Persona::Wayland))), "linux");
    assert_eq!(FakeBackend::from_json(WINDOWS).expect("scenario").persona(), Persona::X11);
    assert_eq!(table_of(&playing(None)), "linux");
}

/// Test 8: the session's table does not change across calls, and re-opening keeps the backend's.
#[test]
fn the_sessions_table_is_held_across_calls_and_reopens() {
    let mut session = playing(Some(Persona::Macos));
    session.control_grant(serde_json::from_value(json!({"reason": "test"})).expect("grant"));
    let _ = session.host_call(Method::KeyDown, json!({"target": "101", "chord": "shift"}));
    assert_eq!(table_of(&session), "macos");
    session.open(serde_json::from_value(json!({"reportMode": "null"})).expect("open params")).expect("re-open");
    assert_eq!(table_of(&session), "macos");
}

/// Item 2: `Persona::host()` has no caller outside tests, so no shipped path follows the host.
#[test]
fn persona_host_has_no_caller_outside_tests() {
    let crates = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut offenders = Vec::new();
    let mut stack = vec![crates];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("read dir").flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
            if path.is_dir() {
                if name != "target" && name != "tests" && name != "fixtures" {
                    stack.push(path);
                }
            } else if name.ends_with(".rs") && !name.ends_with("tests.rs") && !name.starts_with("test") {
                let text = std::fs::read_to_string(&path).expect("read source");
                let shipped = text.split("#[cfg(test)]").next().unwrap_or_default();
                if shipped.contains("Persona::host()") || shipped.contains("Persona::host)") {
                    offenders.push(path.display().to_string());
                }
            }
        }
    }
    assert!(offenders.is_empty(), "{offenders:?}");
}
