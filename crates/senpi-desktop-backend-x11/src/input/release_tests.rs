//! Held-state release: what a failed press, release or drag leaves held,
//! and what `release_all` sends for it.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;

use super::fake::{KEY_C, KEY_CONTROL_L};
use super::tests::{fake_button, fake_key, input};

#[test]
fn a_failed_press_releases_the_keys_already_down() {
    let mut input = input();
    input.server.fail_at.set(Some(1));

    let result = input.key_chord(
        &Target::Desktop,
        &[KeyName::Ctrl, KeyName::Char('c')],
        DeliveryMode::Background,
    );

    assert!(result.is_err());
    assert_eq!(
        input.server.calls(),
        [fake_key(KEY_CONTROL_L, true), fake_key(KEY_CONTROL_L, false)]
    );
    // The failed press may still have reached the server, so `release_all`
    // keeps it.
    let held: Vec<u8> = input.held.keys().iter().map(|key| key.code).collect();
    assert_eq!(held, [KEY_C]);
}

#[test]
fn release_all_releases_a_key_whose_release_failed_on_its_route() {
    // Given: ctrl+c whose release of `c` failed, so `c` is still held
    let mut input = input();
    input.server.fail_at.set(Some(2));
    let chord = input.key_chord(
        &Target::Desktop,
        &[KeyName::Ctrl, KeyName::Char('c')],
        DeliveryMode::Background,
    );
    assert!(chord.is_err());
    input.server.calls.borrow_mut().clear();
    // When
    input.release_all().unwrap();
    // Then
    assert_eq!(input.server.calls(), [fake_key(KEY_C, false)]);
    assert!(input.held.is_empty());
}

#[test]
fn release_all_with_nothing_held_sends_nothing() {
    let mut input = input();
    input
        .type_text(&Target::Desktop, "ac", DeliveryMode::Background)
        .unwrap();
    input.server.calls.borrow_mut().clear();

    input.release_all().unwrap();

    assert!(input.server.calls().is_empty());
}

#[test]
fn a_failed_drag_motion_still_releases_the_button() {
    let mut input = input();
    // motion, press, motion(fails)
    input.server.fail_at.set(Some(2));
    let drag = PointerEvent::Drag {
        path: vec![(1.0, 1.0), (2.0, 2.0)],
        button: MouseButton::Left,
        modifiers: Modifiers::default(),
    };

    let result = input.pointer(&Target::Desktop, &drag, DeliveryMode::Background);

    assert!(result.is_err());
    assert_eq!(input.server.calls().last(), Some(&fake_button(false)));
    assert!(input.held.is_empty());
}
