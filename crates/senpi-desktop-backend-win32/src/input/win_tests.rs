//! Windows-only, display-free input tests: the pure tables pinned to
//! `windows-sys`, and background delivery into message-only windows of a
//! chosen class that this test thread owns, so every posted message lands in
//! this thread's queue where the test reads it back.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;
use windows_sys::Win32::UI::Input::KeyboardAndMouse as kbm;
use windows_sys::Win32::UI::WindowsAndMessaging as wm;

use super::held::{HeldKey, Route};
use super::{keys, messages, Win32Input};
use crate::integrity;
use crate::stop_path::chord;

mod probe;
mod routing;
use probe::ProbeWindow;

#[test]
fn virtual_keys_and_messages_match_windows_sys() {
    let pairs: [(u32, u32); 16] = [
        (keys::VK_CONTROL.into(), kbm::VK_CONTROL.into()),
        (keys::VK_MENU.into(), kbm::VK_MENU.into()),
        (keys::VK_SHIFT.into(), kbm::VK_SHIFT.into()),
        (keys::VK_LWIN.into(), kbm::VK_LWIN.into()),
        (keys::VK_ESCAPE.into(), kbm::VK_ESCAPE.into()),
        (keys::VK_DELETE.into(), kbm::VK_DELETE.into()),
        (keys::VK_F1.into(), kbm::VK_F1.into()),
        (keys::VK_NUMLOCK.into(), kbm::VK_NUMLOCK.into()),
        (keys::WM_KEYDOWN, wm::WM_KEYDOWN),
        (keys::WM_SYSKEYUP, wm::WM_SYSKEYUP),
        (messages::WM_CHAR, wm::WM_CHAR),
        (messages::WM_MOUSEHWHEEL, wm::WM_MOUSEHWHEEL),
        (messages::WHEEL_DELTA.unsigned_abs(), wm::WHEEL_DELTA),
        (chord::MOD_CONTROL, kbm::MOD_CONTROL),
        (chord::MOD_WIN, kbm::MOD_WIN),
        (chord::MOD_NOREPEAT, kbm::MOD_NOREPEAT),
    ];
    for (index, (ours, theirs)) in pairs.into_iter().enumerate() {
        assert_eq!(ours, theirs, "pair {index}");
    }
}

fn input() -> Win32Input {
    Win32Input::new(integrity::current_process().unwrap()).unwrap()
}

#[test]
fn background_text_reaches_an_unlisted_class_window() {
    // Given: a window of a class the matrix does not list
    let window = ProbeWindow::new("SomeCustomClass");
    // When
    let typed = input().type_text(&Target::Window(window.id()), "hi\n", DeliveryMode::Background);
    // Then: characters arrive as WM_CHAR and the newline as one Return
    // transition, never a raw carriage-return character.
    assert_eq!(typed, Ok(()));
    let messages = window.drain();
    let chars: Vec<usize> = messages
        .iter()
        .filter_map(|(message, unit)| (*message == wm::WM_CHAR).then_some(unit))
        .copied()
        .collect();
    let returns: Vec<u32> = messages
        .iter()
        .filter_map(|(message, unit)| {
            (*unit == usize::from(keys::VK_RETURN))
                .then_some(*message)
                .filter(|message| matches!(*message, wm::WM_KEYDOWN | wm::WM_KEYUP))
        })
        .collect();
    assert_eq!(chars, [usize::from(b'h'), usize::from(b'i')]);
    assert_eq!(returns, [wm::WM_KEYDOWN, wm::WM_KEYUP]);
}

#[test]
fn background_text_into_a_chromium_class_window_is_refused_naming_it() {
    // Given: a window of Chromium's frame class
    let window = ProbeWindow::new("Chrome_WidgetWin_1");
    // When
    let error = input()
        .type_text(&Target::Window(window.id()), "hi", DeliveryMode::Background)
        .unwrap_err();
    // Then: refused before anything was posted
    println!("code={} message={}", error.code.as_str(), error.message);
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("Chrome_WidgetWin_1"), "{}", error.message);
    assert_eq!(window.drain(), []);
}

#[test]
fn background_key_chord_releases_every_key_it_pressed() {
    // Given
    let window = ProbeWindow::new("SenpiChordProbe");
    let mut input = input();
    // When
    let sent = input.key_chord(
        &Target::Window(window.id()),
        &[KeyName::Ctrl, KeyName::F5],
        DeliveryMode::Background,
    );
    // Then: down in order, up in reverse, and nothing left held
    assert_eq!(sent, Ok(()));
    let f5 = usize::from(keys::VK_F1 + 4);
    let ctrl = usize::from(keys::VK_CONTROL);
    assert_eq!(
        window.drain(),
        [
            (wm::WM_KEYDOWN, ctrl),
            (wm::WM_KEYDOWN, f5),
            (wm::WM_KEYUP, f5),
            (wm::WM_KEYUP, ctrl)
        ]
    );
    assert!(input.held.is_empty());
}

#[test]
fn release_all_posts_the_release_of_a_key_left_held() {
    // Given: a posted key-down whose release never went out
    let window = ProbeWindow::new("SenpiReleaseProbe");
    let mut input = input();
    input.held.key_down(HeldKey {
        route: Route::Window(window.hwnd.addr()),
        vk: keys::VK_SHIFT,
    });
    // When
    let released = input.release_all();
    // Then
    assert_eq!(released, Ok(()));
    assert_eq!(window.drain(), [(wm::WM_KEYUP, usize::from(keys::VK_SHIFT))]);
    assert!(input.held.is_empty());
}

#[test]
fn a_malformed_window_id_is_an_invalid_target() {
    let error = input()
        .type_text(
            &Target::Window("not-a-hwnd".into()),
            "x",
            DeliveryMode::Background,
        )
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidTarget);
}
