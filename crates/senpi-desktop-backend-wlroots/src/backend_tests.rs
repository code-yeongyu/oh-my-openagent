//! the backend: capabilities, windows, input and focus through the mock
//! runner, the in-memory IPC and the fake compositor.

use std::time::Duration;

use senpi_desktop_core::backend::{Backend as _, DeliveryMode, Modifiers, PointerEvent};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DisplaySelector, Target};

use super::test_support::{FakeRunner, FakeSwayIpc, FakeWayland, WireRequest};
use crate::backend::WlrootsBackend;

const WAIT: Duration = Duration::from_secs(2);

/// A backend on the fakes: grim probe PNG, wtype usage reply, then whatever
/// the test queues.
fn backend(runner: FakeRunner) -> WlrootsBackend<FakeRunner, FakeSwayIpc> {
    let wayland = FakeWayland::start();
    WlrootsBackend::open(
        FakeSwayIpc::default(),
        runner,
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open")
}

fn ready_runner() -> FakeRunner {
    FakeRunner::new(vec![
        FakeRunner::png(1, 1, [0, 0, 0, 255]),
        FakeRunner::usage(),
    ])
}

#[test]
fn capabilities_report_the_wlroots_backend_with_capture_and_input() {
    let mut backend = backend(ready_runner());

    let capabilities = backend.capabilities();

    assert_eq!(capabilities.backend, "wlroots");
    assert_eq!(capabilities.display_server.as_deref(), Some("wayland"));
    assert!(capabilities.capture);
    assert!(capabilities.input);
    assert_eq!(capabilities.capture_permission, "granted");
    assert_eq!(capabilities.input_permission, "granted");
    assert_eq!(capabilities.display_count, 1);
    assert!(!capabilities.focus_guard);
    assert_eq!(
        capabilities.window_input,
        Some(senpi_desktop_core::types::WindowInput {
            available: true,
            reason: None
        })
    );
    assert!(!capabilities.ax);
    // Window-addressed input works only through foreground delivery, which
    // focuses the target first under the control grant.
    assert!(!capabilities.background_window_input);
}

#[test]
fn capabilities_report_input_unavailable_when_the_pointer_is_refused() {
    let wayland = FakeWayland::start();
    let gone = wayland.path.parent().expect("dir").join("gone.sock");
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        FakeRunner::new(vec![
            FakeRunner::png(1, 1, [0, 0, 0, 255]),
            FakeRunner::usage(),
        ]),
        DisplaySelector::All,
        Some(&gone),
        Some("wayland".to_owned()),
    )
    .expect("open");

    let capabilities = backend.capabilities();

    assert!(capabilities.capture);
    assert!(!capabilities.input);
    assert_eq!(capabilities.input_permission, "unavailable");
    assert_eq!(
        capabilities.window_input,
        Some(senpi_desktop_core::types::WindowInput {
            available: false,
            reason: Some("no-virtual-pointer".to_owned())
        })
    );
}

#[test]
fn windows_come_from_the_sway_tree() {
    let mut backend = backend(ready_runner());

    let windows = backend.windows().expect("windows");

    assert_eq!(windows.len(), 2);
    assert!(windows
        .iter()
        .any(|window| window.app == "kitty" && window.focused));
    assert!(windows
        .iter()
        .any(|window| window.app == "XFloat" && !window.focused));
}

#[test]
fn type_text_runs_wtype_once_with_the_text() {
    let mut backend = backend(ready_runner());

    backend
        .type_text(&Target::Desktop, "hello world", DeliveryMode::Background)
        .expect("type");

    let wtype = backend_runner(&backend).args_of("wtype");
    assert_eq!(
        wtype[1],
        vec!["--".to_owned(), "hello world".to_owned()],
        "after the probe, exactly one typed argument"
    );
}

#[test]
fn a_lone_dash_is_typed_through_its_keysym() {
    let mut backend = backend(ready_runner());

    backend
        .type_text(&Target::Desktop, "-", DeliveryMode::Background)
        .expect("type");

    let wtype = backend_runner(&backend).args_of("wtype");
    assert_eq!(
        wtype[1],
        vec![
            "-P".to_owned(),
            "minus".to_owned(),
            "-p".to_owned(),
            "minus".to_owned()
        ]
    );
}

#[test]
fn a_chord_presses_modifiers_then_the_key_then_releases() {
    let mut backend = backend(ready_runner());

    backend
        .key_chord(
            &Target::Desktop,
            &[KeyName::Ctrl, KeyName::Char('c')],
            DeliveryMode::Background,
        )
        .expect("chord");

    let wtype = backend_runner(&backend).args_of("wtype");
    assert_eq!(
        wtype[1],
        vec![
            "-M".to_owned(),
            "ctrl".to_owned(),
            "-P".to_owned(),
            "c".to_owned(),
            "-p".to_owned(),
            "c".to_owned(),
            "-m".to_owned(),
            "ctrl".to_owned(),
        ]
    );
}

#[test]
fn an_alt_chord_is_refused_because_wtype_cannot_press_alt() {
    let mut backend = backend(ready_runner());

    let error = backend
        .key_chord(
            &Target::Desktop,
            &[KeyName::Alt, KeyName::Char('a')],
            DeliveryMode::Background,
        )
        .expect_err("alt chord");

    assert!(error.message.contains("Alt"));
}

#[test]
fn a_pointer_move_positions_absolutely_within_the_layout() {
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Move { x: 100.4, y: 50.6 },
            &frame(),
            DeliveryMode::Background,
        )
        .expect("move");

    let requests = wayland.wait_for(WAIT, |requests| {
        requests
            .iter()
            .any(|request| matches!(request, WireRequest::MotionAbsolute { .. }))
    });
    assert!(requests.contains(&WireRequest::MotionAbsolute {
        x: 100,
        y: 51,
        x_extent: 1920,
        y_extent: 1200
    }));
}

#[test]
fn a_click_moves_then_presses_and_releases_the_button() {
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Click {
                x: 10.0,
                y: 20.0,
                button: senpi_desktop_core::backend::MouseButton::Left,
                count: 1,
                modifiers: Modifiers::default(),
            },
            &frame(),
            DeliveryMode::Background,
        )
        .expect("click");

    let requests = wayland.wait_for(WAIT, |requests| {
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Frame))
            .count()
            >= 3
    });
    assert!(requests.contains(&WireRequest::MotionAbsolute {
        x: 10,
        y: 20,
        x_extent: 1920,
        y_extent: 1200
    }));
    assert!(requests.contains(&WireRequest::Button {
        code: crate::pointer::BTN_LEFT,
        state: 1
    }));
    assert!(requests.contains(&WireRequest::Button {
        code: crate::pointer::BTN_LEFT,
        state: 0
    }));
    assert_eq!(
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Frame))
            .count(),
        3,
        "the framed motion plus one frame per button event"
    );
    // No modifiers were named, so wtype is not invoked for the click.
    let wtype = backend_runner(&backend).args_of("wtype");
    assert_eq!(wtype.len(), 1, "only the probe ran");
}

#[test]
fn a_modifier_click_is_refused_without_sending_input() {
    // wtype holds a modifier only while its own process lives, so a modifier
    // press would be released before the click it was held for; the honest
    // backend refuses instead of delivering the click unmodified.
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    let error = backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Click {
                x: 10.0,
                y: 20.0,
                button: senpi_desktop_core::backend::MouseButton::Left,
                count: 1,
                modifiers: Modifiers {
                    ctrl: true,
                    ..Modifiers::default()
                },
            },
            &frame(),
            DeliveryMode::Background,
        )
        .expect_err("modifier click");

    assert!(error.message.contains("pointer modifiers are unavailable"));
    // The refusal returned before any input; the recorded requests are final.
    let requests = wayland.requests();
    assert!(!requests.iter().any(|request| matches!(
        request,
        WireRequest::Button { .. } | WireRequest::MotionAbsolute { .. }
    )));
}

#[test]
fn a_modifier_drag_is_refused_without_sending_input() {
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    let error = backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Drag {
                path: vec![(10.0, 20.0), (30.0, 40.0)],
                button: senpi_desktop_core::backend::MouseButton::Left,
                modifiers: Modifiers {
                    shift: true,
                    ..Modifiers::default()
                },
            },
            &frame(),
            DeliveryMode::Background,
        )
        .expect_err("modifier drag");

    assert!(error.message.contains("pointer modifiers are unavailable"));
    // The refusal returned before any input; the recorded requests are final.
    let requests = wayland.requests();
    assert!(!requests.iter().any(|request| matches!(
        request,
        WireRequest::Button { .. } | WireRequest::MotionAbsolute { .. }
    )));
}

#[test]
fn a_background_window_pointer_request_is_refused_without_sending_input() {
    // A background window request carries no control grant, so the backend
    // must refuse rather than post seat-global input without approval.
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    let error = backend
        .pointer(
            &Target::Window("12".to_owned()),
            PointerEvent::Move { x: 100.0, y: 50.0 },
            &frame(),
            DeliveryMode::Background,
        )
        .expect_err("background window pointer");

    assert!(error.message.contains("wlroots-focus-only"));
    // The refusal returned before any input; the recorded requests are final.
    let requests = wayland.requests();
    assert!(!requests.iter().any(|request| matches!(
        request,
        WireRequest::Button { .. } | WireRequest::MotionAbsolute { .. }
    )));
    // Nothing was focused either.
    assert!(focused_commands(&backend).is_empty());
}

#[test]
fn a_foreground_window_request_focuses_the_target_before_the_input() {
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    backend
        .pointer(
            &Target::Window("12".to_owned()),
            PointerEvent::Move { x: 100.0, y: 50.0 },
            &frame(),
            DeliveryMode::Foreground,
        )
        .expect("foreground window pointer");

    assert_eq!(focused_commands(&backend), ["[con_id=12] focus"]);
    let requests = wayland.wait_for(WAIT, |requests| {
        requests
            .iter()
            .any(|request| matches!(request, WireRequest::MotionAbsolute { .. }))
    });
    assert!(requests.contains(&WireRequest::MotionAbsolute {
        x: 100,
        y: 50,
        x_extent: 1920,
        y_extent: 1200
    }));
}

#[test]
fn background_window_typing_is_refused_and_foreground_typing_focuses_first() {
    let mut backend = backend(ready_runner());

    let error = backend
        .type_text(
            &Target::Window("12".to_owned()),
            "hello",
            DeliveryMode::Background,
        )
        .expect_err("background window typing");

    assert!(error.message.contains("wlroots-focus-only"));
    assert_eq!(
        backend_runner(&backend).args_of("wtype").len(),
        1,
        "only the probe ran"
    );

    backend
        .type_text(
            &Target::Window("12".to_owned()),
            "hello",
            DeliveryMode::Foreground,
        )
        .expect("foreground window typing");

    assert_eq!(focused_commands(&backend), ["[con_id=12] focus"]);
    assert_eq!(
        backend_runner(&backend).args_of("wtype"),
        [vec![], vec!["--".to_owned(), "hello".to_owned()],]
    );
}

#[test]
fn a_scroll_moves_first_and_then_sends_the_axes() {
    let wayland = FakeWayland::start();
    let mut backend = WlrootsBackend::open(
        FakeSwayIpc::default(),
        ready_runner(),
        DisplaySelector::All,
        Some(&wayland.path),
        Some("wayland".to_owned()),
    )
    .expect("open");

    backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Scroll {
                x: 5.0,
                y: 5.0,
                dx: 0.0,
                dy: -2.0,
            },
            &frame(),
            DeliveryMode::Background,
        )
        .expect("scroll");

    let requests = wayland.wait_for(WAIT, |requests| {
        requests
            .iter()
            .any(|request| matches!(request, WireRequest::Axis { .. }))
    });
    assert!(requests.contains(&WireRequest::Axis {
        axis: 0,
        value: -2.0
    }));
}

#[test]
fn a_refusing_gate_spawns_no_wtype_child() {
    // The gate refuses before the call: no child is launched, so nothing is
    // typed and nothing needs killing.
    let stop = senpi_desktop_core::error::DesktopError::new(
        senpi_desktop_core::error::ErrorCode::Suspended,
        "input is suspended until the user resumes it",
    );
    let mut runner = ready_runner();
    // Would only be consumed by a spawn; the refusal must leave it queued.
    runner.queue_child(1, 0);
    let mut backend = backend(runner);
    let surfaced = stop.clone();
    let stop_gate = move || Err(surfaced.clone());
    let mut delivered = 0;

    let error = backend
        .type_text_interruptible(
            &Target::Desktop,
            "hello",
            DeliveryMode::Background,
            &stop_gate,
            &mut || delivered += 1,
        )
        .expect_err("refused before typing");

    assert_eq!((error.code, error.message), (stop.code, stop.message));
    assert_eq!(delivered, 0, "nothing was typed, so nothing was delivered");
    assert!(
        backend_runner(&backend).spawns().is_empty(),
        "an already-refusing gate launches no wtype child"
    );
    assert!(backend_runner(&backend).child_states().is_empty());
}

#[test]
fn a_stop_during_typing_kills_wtype_and_surfaces_the_stop() {
    // The gate allows the delivery to start, then refuses mid-run: the
    // running wtype must be killed (its exited keyboard releases the keys
    // it held) and the refusal surfaced.
    let stop = senpi_desktop_core::error::DesktopError::new(
        senpi_desktop_core::error::ErrorCode::Suspended,
        "input is suspended until the user resumes it",
    );
    let mut runner = ready_runner();
    // Ten polls before the scripted exit: the stop lands long before that.
    runner.queue_child(10, 0);
    let mut backend = backend(runner);
    let surfaced = stop.clone();
    let checks = std::sync::atomic::AtomicUsize::new(0);
    let stop_gate = move || {
        let count = checks.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        if count <= 2 {
            Ok(())
        } else {
            Err(surfaced.clone())
        }
    };
    let mut delivered = 0;

    let error = backend
        .type_text_interruptible(
            &Target::Desktop,
            "hello",
            DeliveryMode::Background,
            &stop_gate,
            &mut || delivered += 1,
        )
        .expect_err("stop mid-typing");

    assert_eq!((error.code, error.message), (stop.code, stop.message));
    assert_eq!(
        delivered, 0,
        "an interrupted type reports no delivered scalars"
    );
    let states = backend_runner(&backend).child_states();
    assert_eq!(
        states.len(),
        1,
        "the delivery started before the stop landed"
    );
    assert!(
        states[0].killed,
        "the wtype child was killed so its keys released"
    );
    assert_eq!(
        backend_runner(&backend).spawns(),
        [vec!["--".to_owned(), "hello".to_owned()]]
    );
}

#[test]
fn typing_reports_every_delivered_scalar_once_the_child_exits() {
    let mut runner = ready_runner();
    runner.queue_child(2, 0);
    let mut backend = backend(runner);
    let clear_gate = || Ok(());
    let mut delivered = 0;

    backend
        .type_text_interruptible(
            &Target::Desktop,
            "héllo",
            DeliveryMode::Background,
            &clear_gate,
            &mut || delivered += 1,
        )
        .expect("type");

    assert_eq!(delivered, "héllo".chars().count());
    let states = backend_runner(&backend).child_states();
    assert_eq!(states.len(), 1);
    assert!(!states[0].killed);
}

#[test]
fn a_wtype_exit_failure_surfaces_the_status() {
    let mut runner = ready_runner();
    runner.queue_child(2, 1);
    let mut backend = backend(runner);
    let clear_gate = || Ok(());
    let mut delivered = 0;

    let error = backend
        .type_text_interruptible(
            &Target::Desktop,
            "hello",
            DeliveryMode::Background,
            &clear_gate,
            &mut || delivered += 1,
        )
        .expect_err("wtype failed");

    assert!(error.message.contains("status 1"));
    assert_eq!(delivered, 0);
    assert!(!backend_runner(&backend).child_states()[0].killed);
}

#[test]
fn raise_window_focuses_the_container_by_id() {
    let mut backend = backend(ready_runner());

    backend.raise_window("12").expect("raise");

    let ipc = backend_ipc(&backend);
    let requests = ipc.requests.lock().unwrap();
    let command = requests
        .iter()
        .find(|(kind, _)| *kind == crate::ipc::message::RUN_COMMAND)
        .map(|(_, payload)| String::from_utf8_lossy(payload).into_owned());
    assert_eq!(command, Some("[con_id=12] focus".to_owned()));
}

#[test]
fn raising_an_unknown_window_fails() {
    let mut backend = backend(ready_runner());

    let error = backend.raise_window("9999").expect_err("unknown window");

    assert_eq!(
        error.code,
        senpi_desktop_core::error::ErrorCode::WindowNotFound
    );
}

#[test]
fn the_front_window_is_the_focused_tree_window() {
    let mut backend = backend(ready_runner());

    let front = backend.front_window().expect("front window");

    let front = front.expect("focused window");
    assert_eq!(front.window_id.as_deref(), Some("12"));
    assert_eq!(front.app, "kitty");
    assert_eq!(front.pid, 1311138);
}

#[test]
fn hold_keys_and_hold_mouse_are_refused_honestly() {
    let check = || Ok(());
    let wait = || Ok(());
    let control = senpi_desktop_core::holds::HoldControl {
        check: &check,
        wait: &wait,
    };

    let mut backend = backend(ready_runner());
    let error = backend
        .hold_keys(
            &Target::Desktop,
            &[KeyName::Shift],
            DeliveryMode::Background,
            &control,
        )
        .expect_err("holds refused");
    assert!(error.message.contains("bounded key holds are unavailable"));

    let hold = senpi_desktop_core::holds::MouseHold {
        x: 1.0,
        y: 1.0,
        button: senpi_desktop_core::backend::MouseButton::Left,
        keys: &[],
    };
    let error = backend
        .hold_mouse(&Target::Desktop, &hold, DeliveryMode::Background, &control)
        .expect_err("holds refused");
    assert!(error
        .message
        .contains("bounded mouse holds are unavailable"));
}

#[test]
fn there_is_no_ax_backend() {
    let mut backend = backend(ready_runner());

    assert!(backend.ax().is_none());
}

fn backend_runner(backend: &WlrootsBackend<FakeRunner, FakeSwayIpc>) -> &FakeRunner {
    &backend.runner
}

fn backend_ipc(backend: &WlrootsBackend<FakeRunner, FakeSwayIpc>) -> &FakeSwayIpc {
    &backend.ipc
}

/// Every sway command the backend ran, in order.
fn focused_commands(backend: &WlrootsBackend<FakeRunner, FakeSwayIpc>) -> Vec<String> {
    backend_ipc(backend)
        .requests
        .lock()
        .unwrap()
        .iter()
        .filter(|(kind, _)| *kind == crate::ipc::message::RUN_COMMAND)
        .map(|(_, payload)| String::from_utf8_lossy(payload).into_owned())
        .collect()
}

fn frame() -> senpi_desktop_core::frame::FrameGeometry {
    senpi_desktop_core::frame::FrameGeometry::identity_global()
}
