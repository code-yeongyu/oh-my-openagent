//! Row 56 binds its chords to row 23's ONE key grammar (`omo_computer_core::keys`): every canonical
//! name maps to a Windows virtual key, `cmd` is the Windows key, and a single character stays a
//! character (layout-independent `WM_CHAR` / `KEYEVENTF_UNICODE`), never a guessed virtual key.

use crate::input::chords::{Chord, Key, Mods};
use crate::input::vk::{chord_of, vk_of};
use crate::input::{VK_LWIN, VK_RETURN, VK_TAB};

#[test]
fn row_23_chords_map_to_windows_chords() {
    assert_eq!(
        chord_of("Control+Shift+a"),
        Ok(Chord { mods: Mods { ctrl: true, shift: true, ..Mods::NONE }, key: Key::Char('a') })
    );
    assert_eq!(chord_of("shift+enter"), Ok(Chord { mods: Mods { shift: true, ..Mods::NONE }, key: Key::Named(VK_RETURN) }));
    assert_eq!(chord_of("alt+f4"), Ok(Chord { mods: Mods { alt: true, ..Mods::NONE }, key: Key::Named(0x73) }));
    assert_eq!(chord_of("win+l"), Ok(Chord { mods: Mods { win: true, ..Mods::NONE }, key: Key::Char('l') }));
    assert!(chord_of("hyper+a").is_err(), "the grammar refuses it first");
    assert!(chord_of("ctrl+shift").is_err(), "a chord needs one non-modifier key");
}

#[test]
fn every_named_key_has_a_virtual_key() {
    for name in ["return", "tab", "escape", "space", "backspace", "delete", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "f1", "f24"] {
        assert!(vk_of(name).is_some(), "{name}");
    }
    assert_eq!(vk_of("tab"), Some(VK_TAB));
    assert_eq!(vk_of("cmd"), Some(VK_LWIN));
    assert_eq!(vk_of("a"), None, "a character is never a guessed virtual key");
}
