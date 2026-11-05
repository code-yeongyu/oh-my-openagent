//! The real `type_text` and `key_chord` window paths, driven in the
//! background to a window of a process that does not exist: text is offered
//! to AX insertion first, then keys wait on the window proven key
//! ([`KeyWindow::prepare`](super::key_window::KeyWindow)), which refuses
//! because the process has no accessibility windows, so nothing is posted.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::DesktopWindow;

use super::key_front::EntryFront;
use super::key_route::unmapped_keyboard_refusal;
use super::key_trace::{self, KeyStep};
use super::{CanaryMode, MacInput};

/// No process holds this pid (macOS caps pids at 99999).
const NO_PROCESS: u32 = 0x7fff_fff0;
const WID: u32 = 424_242;

fn window() -> DesktopWindow {
    DesktopWindow {
        id: WID.to_string(),
        title: String::new(),
        app: "TextEdit".to_owned(),
        pid: Some(NO_PROCESS),
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        focused: false,
        is_on_screen: None,
        elevated: None,
    }
}

fn running() -> CoreResult<()> {
    Ok(())
}

fn input() -> MacInput {
    key_trace::take();
    MacInput::new(CanaryMode::Off).expect("Quartz event source")
}

#[test]
fn background_text_is_inserted_before_keys_wait_on_the_key_window() {
    let mut input = input();
    let typed = input.type_window(&window(), "parity e7", DeliveryMode::Background, EntryFront(None), &running, &mut || {});
    assert_eq!(typed, Err(unmapped_keyboard_refusal(WID)));
    assert_eq!(key_trace::take(), [KeyStep::Insert, KeyStep::KeyWindow]);
}

#[test]
fn a_background_chord_waits_on_the_key_window() {
    let mut input = input();
    let keys = [KeyName::Meta, KeyName::Char('a')];
    let pressed = input.chord_window(&window(), &keys, DeliveryMode::Background, EntryFront(None), &running);
    assert_eq!(pressed, Err(unmapped_keyboard_refusal(WID)));
    assert_eq!(key_trace::take(), [KeyStep::KeyWindow]);
}
