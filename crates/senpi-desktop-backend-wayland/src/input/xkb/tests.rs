//! Ported from oh-my-pi `linux/wayland/xkb.rs` tests, over its `fr` and
//! `us-fr` (two-group) compiled keymap fixtures.

use super::{KeyStroke, KeyboardLayout};

const FR: &str = include_str!("../../../testdata/fr.xkb");
const US_FR: &str = include_str!("../../../testdata/us-fr.xkb");

fn stroke(keycode: u32, modifiers: &[u32]) -> KeyStroke {
    KeyStroke {
        keycode,
        modifiers: modifiers.to_vec(),
    }
}

#[test]
fn resolves_french_levels_and_altgr() {
    let layout = KeyboardLayout::compile(FR).expect("French fixture must compile");
    assert_eq!(layout.resolve_char('a'), Some(stroke(16, &[])));
    assert_eq!(layout.resolve_char('A'), Some(stroke(16, &[42])));
    assert_eq!(layout.resolve_char('é'), Some(stroke(3, &[])));
    assert_eq!(layout.resolve_char('1'), Some(stroke(2, &[42])));
    assert_eq!(layout.resolve_char('#'), Some(stroke(4, &[100])));
}

#[test]
fn resolves_only_the_active_group_in_a_multi_layout_keymap() {
    let mut layout = KeyboardLayout::compile(US_FR).expect("US/French fixture must compile");
    assert_eq!(layout.resolve_char('a'), Some(stroke(30, &[])));
    assert_eq!(layout.resolve_char('q'), Some(stroke(16, &[])));
    assert_eq!(layout.resolve_char('é'), None);
    layout.update_modifiers(0, 0, 0, 1);
    assert_eq!(layout.resolve_char('a'), Some(stroke(16, &[])));
    assert_eq!(layout.resolve_char('é'), Some(stroke(3, &[])));
}

#[test]
fn modifier_event_group_change_updates_resolution() {
    let mut layout = KeyboardLayout::compile(US_FR).expect("US/French fixture must compile");
    assert_eq!(layout.resolve_char('a'), Some(stroke(30, &[])));
    layout.update_modifiers(0, 0, 0, 1);
    assert_eq!(layout.active_group(), 1);
    assert_eq!(layout.resolve_char('a'), Some(stroke(16, &[])));
}

#[test]
fn serialized_modifier_fields_affect_resolution() {
    let mut layout = KeyboardLayout::compile(US_FR).expect("US/French fixture must compile");
    let shift = 1;
    layout.update_modifiers(shift, 0, 0, 0);
    assert_eq!(layout.resolve_char('A'), Some(stroke(30, &[])));
    layout.update_modifiers(0, shift, 0, 0);
    assert_eq!(layout.resolve_char('A'), Some(stroke(30, &[])));
    layout.update_modifiers(0, 0, shift, 0);
    assert_eq!(layout.resolve_char('A'), Some(stroke(30, &[])));
}

#[test]
fn num_lock_does_not_change_non_keypad_levels() {
    let mut layout = KeyboardLayout::compile(FR).expect("French fixture must compile");
    layout.update_modifiers(0, 0, 1 << 4, 0);

    assert_eq!(layout.resolve_char('a'), Some(stroke(16, &[])));
    assert_eq!(layout.resolve_char('1'), Some(stroke(2, &[42])));
}

#[test]
fn caps_lock_uses_the_alphabetic_type_map() {
    let mut layout = KeyboardLayout::compile(FR).expect("French fixture must compile");
    layout.update_modifiers(0, 0, 1 << 1, 0);

    assert_eq!(layout.resolve_char('a'), Some(stroke(16, &[42])));
    assert_eq!(layout.resolve_char('A'), Some(stroke(16, &[])));
    assert_eq!(layout.resolve_char('é'), Some(stroke(3, &[])));
}

#[test]
fn only_the_us_group_takes_the_ascii_fast_path() {
    let mut layout = KeyboardLayout::compile(US_FR).expect("US/French fixture must compile");
    assert!(layout.can_use_us_ascii_fast_path());
    layout.update_modifiers(0, 0, 0, 1);
    assert!(!layout.can_use_us_ascii_fast_path());
}
