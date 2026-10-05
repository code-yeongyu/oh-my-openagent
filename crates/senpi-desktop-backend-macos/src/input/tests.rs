//! Unit tests: the guard decisions, the key tables, release-all bookkeeping,
//! and the never-suppress-local-input source contract.

use foreign_types::ForeignType;
use senpi_desktop_core::backend::{Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::DesktopWindow;

use super::cgevent::{
    event_source, get_local_events_filter_during_suppression_state, get_local_events_suppression_interval,
    LOCAL_EVENT_FILTER, REMOTE_MOUSE_DRAG, SUPPRESSION_INTERVAL,
};
use super::guard;
use super::held::{ButtonRoute, Held, HeldButton, HeldKey, KeyRoute};
use super::keys;

fn window(id: &str, app: &str) -> DesktopWindow {
    DesktopWindow {
        id: id.to_string(),
        title: String::new(),
        app: app.to_string(),
        pid: Some(42),
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        focused: false,
        elevated: None,
    }
}

#[test]
fn event_source_never_suppresses_local_input() {
    let source = event_source().expect("Quartz event source");
    // SAFETY: `source` remains live for both CoreGraphics getter calls.
    unsafe {
        assert_eq!(get_local_events_suppression_interval(source.as_ptr()), 0.0);
        assert_eq!(
            get_local_events_filter_during_suppression_state(source.as_ptr(), SUPPRESSION_INTERVAL),
            LOCAL_EVENT_FILTER,
        );
        assert_eq!(
            get_local_events_filter_during_suppression_state(source.as_ptr(), REMOTE_MOUSE_DRAG),
            LOCAL_EVENT_FILTER,
        );
    }
}

#[test]
fn guard_refuses_chromium_right_clicks_and_canvas_stacks_only() {
    let chrome = window("1", "Google Chrome");
    let error = guard::guard(&chrome, "click", Some(MouseButton::Right)).unwrap_err();
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("coerces synthetic background right-click"));
    assert_eq!(guard::guard(&chrome, "click", Some(MouseButton::Left)), Ok(()));
    assert_eq!(guard::guard(&chrome, "keyboard", None), Ok(()));

    let blender = window("2", "Blender");
    let error = guard::guard(&blender, "pointer move", None).unwrap_err();
    assert!(error.message.contains("canvas/game input stack"));

    assert_eq!(guard::guard(&window("3", "TextEdit"), "click", None), Ok(()));
    let chromium_name = window("4", "Chromium Helper");
    assert_eq!(
        guard::guard(&chromium_name, "click", Some(MouseButton::Middle)),
        Ok(())
    );
}

#[test]
fn pointer_kind_and_button_classify_every_variant() {
    let click = PointerEvent::Click {
        x: 1.0,
        y: 2.0,
        button: MouseButton::Right,
        count: 1,
        modifiers: Modifiers::default(),
    };
    assert_eq!(guard::pointer_kind(&click), "click");
    assert_eq!(guard::pointer_button(&click), Some(MouseButton::Right));
    let scroll = PointerEvent::Scroll {
        x: 0.0,
        y: 0.0,
        dx: 1.0,
        dy: 1.0,
    };
    assert_eq!(guard::pointer_kind(&scroll), "scroll");
    assert_eq!(guard::pointer_button(&scroll), None);
}

#[test]
fn key_table_covers_named_keys_letters_and_refuses_the_rest() {
    assert_eq!(keys::key_code(KeyName::Meta), Ok(55));
    assert_eq!(keys::key_code(KeyName::Enter), Ok(36));
    assert_eq!(keys::key_code(KeyName::F12), Ok(111));
    assert_eq!(keys::key_code(KeyName::Char('Q')), Ok(12));
    assert_eq!(keys::key_code(KeyName::Char('=')), Ok(24));
    let error = keys::key_code(KeyName::Char('é')).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidKey);
    assert!(error.message.contains("no macOS virtual keycode"));
}

#[test]
fn release_all_drains_every_posted_down_through_its_route() {
    let mut held = Held::default();
    held.key_down(HeldKey {
        route: KeyRoute::Process(9),
        code: 55,
        text: None,
    });
    held.key_down(HeldKey {
        route: KeyRoute::Global,
        code: 56,
        text: None,
    });
    held.key_down(HeldKey {
        route: KeyRoute::Global,
        code: 0,
        text: Some("a".into()),
    });
    held.button_down(HeldButton {
        route: ButtonRoute::Window(9, 17, core_graphics::geometry::CGPoint::new(3.0, 4.0)),
        button: MouseButton::Left,
    });
    held.button_down(HeldButton {
        route: ButtonRoute::Global(core_graphics::geometry::CGPoint::new(1.0, 1.0)),
        button: MouseButton::Right,
    });

    // The chord/type bookkeeping pairs each down with its up on success.
    held.key_up(KeyRoute::Global, 0);
    let drained_keys = held.take_keys();
    assert_eq!(drained_keys.len(), 2);
    assert!(drained_keys.iter().all(|key| key.text.is_none()));

    let drained_buttons = held.take_buttons();
    assert_eq!(drained_buttons.len(), 2);
    assert!(held.is_empty(), "release_all leaves nothing held");
}
