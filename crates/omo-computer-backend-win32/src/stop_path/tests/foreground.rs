//! The foreground lease's restore policy, the user-held modifier rule on the SendInput route, and
//! the chord the posted route refused delivered as one SendInput batch under the lease.

use omo_computer_core::error::{EngineCode, Reason};

use crate::foreground::{admit_leased, foreground_chord, restore, Restore};
use crate::input::chords::{posted_press, Chord, Key, Mods};
use crate::input::{KeyUnit, ENGINE_TAG, VK_CONTROL, VK_RETURN, VK_SHIFT};
use crate::stop_path::{HookEvent, PhysicalChord};

const TARGET: isize = 0x100;
const PREVIOUS: isize = 0x200;
const THIRD: isize = 0x300;

#[test]
fn foreground_guard_refuses_restore_when_third_window_appeared() {
    let owned = |w: isize| w == 0x101;
    assert_eq!(
        restore(TARGET, PREVIOUS, TARGET, &owned, None, 100),
        Restore::Previous(PREVIOUS)
    );
    assert_eq!(
        restore(TARGET, PREVIOUS, 0x101, &owned, None, 100),
        Restore::Previous(PREVIOUS),
        "a window the target owns"
    );
    assert_eq!(
        restore(TARGET, PREVIOUS, THIRD, &owned, None, 100),
        Restore::UserMovedOn
    );
    assert_eq!(
        restore(TARGET, PREVIOUS, TARGET, &owned, Some(150), 100),
        Restore::UserMovedOn,
        "physical input after activation"
    );
    assert_eq!(
        restore(TARGET, PREVIOUS, TARGET, &owned, Some(50), 100),
        Restore::Previous(PREVIOUS)
    );
}

fn held(vks: &[u16]) -> PhysicalChord {
    let mut tracker = PhysicalChord::default();
    for vk in vks {
        tracker.on_key(&HookEvent {
            vk: *vk,
            down: true,
            injected: false,
            extra_info: 0,
            time: 1,
        });
    }
    tracker
}

#[test]
fn win_sendinput_press_while_the_user_holds_ctrl_is_refused() {
    let refusal = admit_leased(&held(&[VK_CONTROL]), &[]).expect_err("refused before any send");
    assert_eq!(refusal.refusal.code, EngineCode::BackgroundUnavailable);
    assert_eq!(
        refusal.refusal.reason,
        Some(Reason::UserModifierHeld.wire())
    );
    assert_eq!(refusal.keys, vec!["ctrl"]);
    assert!(
        admit_leased(&held(&[0x41]), &[]).is_ok(),
        "a held letter is not a modifier"
    );
}

#[test]
fn win_sendinput_engine_held_shift_is_not_refused() {
    // The engine's own key.down("shift") is on the ledger: it never trips the rule, and our
    // tagged events never enter the physical tracker at all.
    let mut tracker = PhysicalChord::default();
    tracker.on_key(&HookEvent {
        vk: VK_SHIFT,
        down: true,
        injected: true,
        extra_info: ENGINE_TAG,
        time: 1,
    });
    assert!(admit_leased(&tracker, &[VK_SHIFT]).is_ok());
    assert!(
        admit_leased(&held(&[VK_SHIFT]), &[VK_SHIFT]).is_ok(),
        "held by the engine too"
    );
}

#[test]
fn win_shift_return_refused_on_the_posted_route_is_delivered_foreground() {
    let chord = Chord {
        mods: Mods {
            shift: true,
            ..Mods::NONE
        },
        key: Key::Named(VK_RETURN),
    };
    assert!(posted_press(&chord).is_err(), "the posted route refuses it");
    assert_eq!(
        foreground_chord(&chord, &|_| None).expect("a named key needs no layout"),
        vec![
            KeyUnit::virtual_key(VK_SHIFT, true),
            KeyUnit::scan_coded(VK_RETURN, true),
            KeyUnit::scan_coded(VK_RETURN, false),
            KeyUnit::virtual_key(VK_SHIFT, false),
        ],
        "one SendInput batch, where Shift IS key state"
    );
}

/// Review M2 and L3 (#13350): a Ctrl/Alt/Win chord on a character goes out as the layout's
/// virtual key (VK_PACKET with Ctrl down triggers no accelerator); a character outside the BMP is
/// both surrogate halves; a held RIGHT Win key is refused like the left one.
fn letters(c: char) -> Option<u16> {
    c.is_ascii_alphanumeric()
        .then(|| u16::try_from(u32::from(c.to_ascii_uppercase())).unwrap_or(0))
}

fn chord_of(mods: Mods, c: char) -> Chord {
    Chord {
        mods,
        key: Key::Char(c),
    }
}

#[test]
fn ctrl_and_win_chords_on_a_character_send_its_virtual_key() {
    let ctrl = Mods {
        ctrl: true,
        ..Mods::NONE
    };
    assert_eq!(
        foreground_chord(&chord_of(ctrl, 'c'), &letters).expect("ctrl+c maps"),
        vec![
            KeyUnit::virtual_key(VK_CONTROL, true),
            KeyUnit::virtual_key(0x43, true),
            KeyUnit::virtual_key(0x43, false),
            KeyUnit::virtual_key(VK_CONTROL, false),
        ],
        "ctrl+c is VK_C under Ctrl, not a VK_PACKET unit"
    );
    let win = Mods {
        win: true,
        ..Mods::NONE
    };
    let batch = foreground_chord(&chord_of(win, 'r'), &letters).expect("win+r maps");
    assert!(batch.contains(&KeyUnit::virtual_key(0x52, true)));
    let alt = Mods {
        alt: true,
        ..Mods::NONE
    };
    assert!(foreground_chord(&chord_of(alt, 'f'), &letters)
        .expect("alt+f maps")
        .contains(&KeyUnit::virtual_key(0x46, true)));
}

#[test]
fn a_modifier_chord_on_a_character_the_layout_lacks_is_refused() {
    let ctrl = Mods {
        ctrl: true,
        ..Mods::NONE
    };
    let refusal = foreground_chord(&chord_of(ctrl, 'é'), &letters).expect_err("no virtual key");
    assert_eq!(refusal.code, EngineCode::InvalidKey);
    assert_eq!(refusal.reason, Some(Reason::UnknownKey.wire()));
}

#[test]
fn a_character_outside_the_bmp_is_both_surrogate_halves() {
    let batch = foreground_chord(&chord_of(Mods::NONE, '😀'), &letters).expect("plain text maps");
    assert_eq!(
        batch,
        vec![
            KeyUnit::unicode(0xD83D, true),
            KeyUnit::unicode(0xD83D, false),
            KeyUnit::unicode(0xDE00, true),
            KeyUnit::unicode(0xDE00, false),
        ]
    );
}

#[test]
fn a_held_right_win_key_is_refused_like_the_left() {
    let refusal = admit_leased(&held(&[0x5C]), &[]).expect_err("right Win is a modifier");
    assert_eq!(refusal.keys, vec!["win"]);
    let both = admit_leased(&held(&[crate::input::VK_LWIN, 0x5C]), &[]).expect_err("both Win keys");
    assert_eq!(both.keys, vec!["win"], "named once");
}
