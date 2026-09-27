//! Pure input tests: they run on every host.

use senpi_desktop_core::backend::{Modifiers, MouseButton};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;

use super::held::{Held, HeldButton, HeldKey, Route};
use super::keys::{
    chord_virtual_keys, key_message, modifier_virtual_keys, named_virtual_key, Stroke, VK_CONTROL, VK_DELETE,
    VK_ESCAPE, VK_F1, VK_LWIN, VK_MENU, VK_SHIFT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};
use super::messages::{
    absolute_coordinate, button_messages, modifier_flags, packed_point, scroll_steps, wheel_wparam,
};

#[test]
fn named_keys_map_to_their_virtual_keys() {
    let cases = [
        (KeyName::Ctrl, 0x11),
        (KeyName::Alt, 0x12),
        (KeyName::Shift, 0x10),
        (KeyName::Meta, 0x5B),
        (KeyName::Enter, 0x0D),
        (KeyName::Escape, 0x1B),
        (KeyName::PageUp, 0x21),
        (KeyName::Left, 0x25),
        (KeyName::PrintScreen, 0x2C),
        (KeyName::F1, 0x70),
        (KeyName::F12, 0x7B),
        (KeyName::F24, 0x87),
        (KeyName::NumLock, 0x90),
    ];
    for (key, vk) in cases {
        assert_eq!(named_virtual_key(key), Some(vk), "{key:?}");
    }
    assert_eq!(named_virtual_key(KeyName::Char('a')), None);
}

#[test]
fn layout_scan_splits_into_key_and_implicit_modifiers() {
    // VkKeyScanW('A') on US: shift (1) + 'A' (0x41); '@' on German: ctrl+alt (6) + 'Q'.
    let upper = Stroke::from_scan(0x0141).unwrap();
    let alt_gr = Stroke::from_scan(0x0651).unwrap();

    assert_eq!(upper.press_order(), [VK_SHIFT, 0x41]);
    assert_eq!(alt_gr.press_order(), [VK_CONTROL, VK_MENU, 0x51]);
    assert_eq!(Stroke::from_scan(-1), None);
}

#[test]
fn chord_keys_press_each_key_once_in_order() {
    let strokes = [
        Stroke::plain(VK_SHIFT),
        Stroke::from_scan(0x0141).unwrap(),
        Stroke::plain(VK_DELETE),
    ];

    assert_eq!(chord_virtual_keys(&strokes), [VK_SHIFT, 0x41, VK_DELETE]);
}

#[test]
fn pointer_modifiers_press_ctrl_alt_shift_meta_in_order() {
    let all = Modifiers {
        ctrl: true,
        alt: true,
        shift: true,
        meta: true,
    };

    assert_eq!(
        modifier_virtual_keys(all),
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN]
    );
    assert_eq!(modifier_virtual_keys(Modifiers::default()), Vec::<u16>::new());
}

#[test]
fn posted_key_messages_carry_scan_extended_context_and_transition_bits() {
    let plain_down = key_message(VK_ESCAPE, 0x01, true, false);
    let extended_up = key_message(VK_DELETE, 0x53, false, false);
    let alt_down = key_message(VK_MENU, 0x38, true, false);
    let with_alt_up = key_message(0x46, 0x21, false, true);

    assert_eq!(plain_down, (WM_KEYDOWN, 0x0001_0001));
    assert_eq!(extended_up, (WM_KEYUP, i32_bits(0xC153_0001)));
    assert_eq!(alt_down, (WM_SYSKEYDOWN, 0x2038_0001));
    assert_eq!(with_alt_up, (WM_SYSKEYUP, i32_bits(0xE021_0001)));
}

fn i32_bits(bits: u32) -> isize {
    isize::try_from(i32::from_ne_bytes(bits.to_ne_bytes())).unwrap()
}

#[test]
fn f_keys_are_contiguous_from_f1() {
    assert_eq!(named_virtual_key(KeyName::F13), Some(VK_F1 + 12));
}

#[test]
fn points_pack_as_two_signed_words() {
    assert_eq!(packed_point(10, 20).unwrap(), 0x0014_000A);
    assert_eq!(packed_point(-1, 2).unwrap(), 0x0002_FFFF);
    assert_eq!(
        packed_point(40_000, 0).map_err(|error| error.code),
        Err(ErrorCode::InputFailed)
    );
}

#[test]
fn wheel_deltas_ride_in_the_high_word() {
    assert_eq!(wheel_wparam(120).unwrap(), 0x0078_0000);
    assert_eq!(wheel_wparam(-120).unwrap(), 0xFF88_0000);
}

#[test]
fn scroll_deltas_round_to_at_least_one_notch() {
    let steps: Vec<i32> = [0.0, 1.0, -1.0, 149.0, 150.0, -250.0]
        .into_iter()
        .map(scroll_steps)
        .collect();

    assert_eq!(steps, [0, 1, -1, 1, 2, -3]);
}

#[test]
fn absolute_coordinates_span_the_virtual_desktop() {
    // A virtual desktop from x = -1920 spanning two 1920-pixel monitors.
    assert_eq!(absolute_coordinate(-1920, -1920, 3840), Some(0));
    assert_eq!(absolute_coordinate(1919, -1920, 3840), Some(65_535));
    assert_eq!(absolute_coordinate(5000, -1920, 3840), Some(65_535));
    assert_eq!(absolute_coordinate(0, 0, 1), None);
}

#[test]
fn button_messages_follow_the_win32_numbering() {
    let right = button_messages(MouseButton::Right);
    let flags = modifier_flags(Modifiers {
        ctrl: true,
        shift: true,
        ..Modifiers::default()
    });

    assert_eq!(
        (right.down, right.up, right.double, right.flag),
        (0x0204, 0x0205, 0x0206, 0x0002)
    );
    assert_eq!(flags, 0x0008 | 0x0004);
}

#[test]
fn held_keys_release_most_recent_first_and_once() {
    let window = Route::Window(0x1234);
    let mut held = Held::default();
    for vk in [VK_CONTROL, VK_SHIFT, VK_CONTROL] {
        held.key_down(HeldKey { route: window, vk });
    }
    held.key_down(HeldKey {
        route: Route::System,
        vk: VK_CONTROL,
    });

    let keys: Vec<(Route, u16)> = held.keys().into_iter().map(|key| (key.route, key.vk)).collect();

    assert_eq!(
        keys,
        [
            (Route::System, VK_CONTROL),
            (window, VK_SHIFT),
            (window, VK_CONTROL)
        ]
    );
}

#[test]
fn a_repeated_button_press_replaces_the_held_entry() {
    let route = Route::Window(0x1234);
    let mut held = Held::default();
    held.button_down(HeldButton {
        route,
        button: MouseButton::Left,
        at: 1,
    });
    held.button_down(HeldButton {
        route,
        button: MouseButton::Left,
        at: 2,
    });

    assert_eq!(
        held.buttons()
            .into_iter()
            .map(|button| button.at)
            .collect::<Vec<_>>(),
        [2]
    );
    held.button_up(route, MouseButton::Left);
    assert!(held.is_empty());
}
