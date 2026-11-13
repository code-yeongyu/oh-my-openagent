//! The posted-route chord rules (d-windows.md '## Input', Chords, holds, release; acceptance 36, 80(b)).

use omo_computer_core::error::{EngineCode, Reason};

use crate::input::chords::{posted_press, Chord, Key, Mods};
use crate::input::{VK_F, VK_RETURN, VK_TAB, WM_CHAR, WM_SYSKEYDOWN, WM_SYSKEYUP};

fn refused(chord: Chord) {
    let refusal = posted_press(&chord).expect_err("refused before any post");
    assert_eq!(refusal.code, EngineCode::BackgroundUnavailable);
    assert_eq!(refusal.reason, Some(Reason::PostedModifierChord.wire()));
}

#[test]
fn win_posted_ctrl_chord_refused_nothing_posted() {
    refused(Chord {
        mods: Mods {
            ctrl: true,
            ..Mods::NONE
        },
        key: Key::Char('a'),
    });
    refused(Chord {
        mods: Mods {
            win: true,
            ..Mods::NONE
        },
        key: Key::Char('l'),
    });
    refused(Chord {
        mods: Mods {
            shift: true,
            ..Mods::NONE
        },
        key: Key::Named(VK_TAB),
    });
}

#[test]
fn win_posted_shift_return_is_a_refused_chord() {
    // shift+return is a chord on a non-character key: the posted route refuses it (AC-80(b));
    // the send-on-enter split of row 26 and the foreground leg of row 57 build on this refusal.
    refused(Chord {
        mods: Mods {
            shift: true,
            ..Mods::NONE
        },
        key: Key::Named(VK_RETURN),
    });
}

#[test]
fn win_posted_alt_chord_keeps_the_syskey_context_bit() {
    let posted = posted_press(&Chord {
        mods: Mods {
            alt: true,
            ..Mods::NONE
        },
        key: Key::Named(VK_F),
    })
    .expect("alt chord posts");
    let keys: Vec<_> = posted
        .iter()
        .filter(|p| p.wparam == usize::from(VK_F))
        .collect();
    assert_eq!(
        keys.iter().map(|p| p.msg).collect::<Vec<_>>(),
        vec![WM_SYSKEYDOWN, WM_SYSKEYUP]
    );
    for message in keys {
        assert_ne!(
            message.lparam & (1 << 29),
            0,
            "lParam bit 29 carries Alt inside the message"
        );
    }
}

#[test]
fn win_posted_press_capital_a_posts_the_shifted_character_as_wm_char() {
    let posted = posted_press(&Chord {
        mods: Mods::NONE,
        key: Key::Char('A'),
    })
    .expect("a character posts");
    assert_eq!(
        posted.iter().map(|p| (p.msg, p.wparam)).collect::<Vec<_>>(),
        vec![(WM_CHAR, 0x41)],
        "no Shift key event"
    );
    let posted = posted_press(&Chord {
        mods: Mods {
            shift: true,
            ..Mods::NONE
        },
        key: Key::Char('a'),
    })
    .expect("shifted character");
    assert_eq!(
        posted.iter().map(|p| (p.msg, p.wparam)).collect::<Vec<_>>(),
        vec![(WM_CHAR, 0x41)],
        "a shifted character is not a chord"
    );
}

/// Review M1 and L1 (#13349): the posted route never guesses a virtual key and never drops a
/// modifier the chord asked for.
fn chord(mods: Mods, c: char) -> Chord {
    Chord {
        mods,
        key: Key::Char(c),
    }
}

const ALT: Mods = Mods {
    alt: true,
    ..Mods::NONE
};
const SHIFT: Mods = Mods {
    shift: true,
    ..Mods::NONE
};

#[test]
fn win_posted_alt_letter_digit_and_space_post_their_own_virtual_key() {
    for (c, vk) in [('f', 0x46usize), ('F', 0x46), ('7', 0x37), (' ', 0x20)] {
        let posted =
            posted_press(&chord(ALT, c)).expect("alt chord on a letter, digit or space posts");
        assert_eq!(posted.len(), 2);
        assert_eq!(posted[0].wparam, vk, "alt+{c:?}");
    }
}

#[test]
fn win_posted_alt_on_punctuation_or_non_ascii_is_refused_never_guessed() {
    for c in ['.', '-', ',', '\'', '!', 'é', '한'] {
        refused(chord(ALT, c));
    }
}

#[test]
fn win_posted_alt_shift_and_shift_on_a_non_letter_are_refused() {
    refused(chord(
        Mods {
            alt: true,
            shift: true,
            ..Mods::NONE
        },
        'a',
    ));
    for c in ['1', '/', ' ', '한'] {
        refused(chord(SHIFT, c));
    }
    let posted = posted_press(&chord(SHIFT, 'a')).expect("shift+a is 'A'");
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0].wparam, usize::from(b'A'));
}
