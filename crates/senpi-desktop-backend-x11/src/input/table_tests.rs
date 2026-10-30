//! The pure tables: key names to keysyms, keysyms to keycodes, the toolkit
//! filter, and held-state bookkeeping.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use xkeysym::Keysym;

use super::fake::{keymap, KEY_A, KEY_ALT_L, KEY_ESCAPE, KEY_SHIFT_L};
use super::held::{Held, HeldButton, HeldKey, Route};
use super::keys::{keysym, keysym_variants, modifier_keys, modifiers_mask, Stroke};
use super::server::Spot;
use super::toolkit_filter::{filtering_toolkit, Toolkit};

#[test]
fn key_names_map_to_their_x_keysyms() {
    let cases = [
        (KeyName::Enter, Keysym::Return),
        (KeyName::Char('\n'), Keysym::Return),
        (KeyName::Char('\t'), Keysym::Tab),
        (KeyName::PageUp, Keysym::Prior),
        (KeyName::PageDown, Keysym::Next),
        (KeyName::Meta, Keysym::Super_L),
        (KeyName::PrintScreen, Keysym::Print),
        (KeyName::Char('a'), Keysym::a),
        (KeyName::Char('A'), Keysym::A),
    ];
    for (key, expected) in cases {
        assert_eq!(keysym(key), expected.raw(), "{key:?}");
    }
}

#[test]
fn modifiers_match_either_side_and_alt_also_matches_meta() {
    assert_eq!(
        keysym_variants(KeyName::Alt),
        [Keysym::Alt_L, Keysym::Alt_R, Keysym::Meta_L, Keysym::Meta_R].map(Keysym::raw)
    );
    assert_eq!(keysym_variants(KeyName::Escape), [Keysym::Escape.raw()]);
}

#[test]
fn an_unshifted_keysym_wins_and_a_shifted_one_needs_shift() {
    let keymap = keymap();

    assert_eq!(keymap.lookup(Keysym::a.raw()).unwrap(), (KEY_A, false));
    assert_eq!(keymap.lookup(Keysym::A.raw()).unwrap(), (KEY_A, true));
    assert_eq!(keymap.lookup(Keysym::Meta_L.raw()).unwrap(), (KEY_ALT_L, true));
    assert_eq!(
        keymap.lookup(Keysym::F24.raw()).unwrap_err().code,
        ErrorCode::InvalidKey
    );
}

#[test]
fn strokes_add_shift_for_shifted_characters_and_carry_modifier_masks() {
    let keymap = keymap();
    let shift = Stroke {
        code: KEY_SHIFT_L,
        mask: 1,
    };

    assert_eq!(
        keymap.strokes(KeyName::Char('!')).unwrap(),
        [shift, Stroke { code: 10, mask: 0 }]
    );
    assert_eq!(keymap.strokes(KeyName::Shift).unwrap(), [shift]);
    assert_eq!(
        keymap.strokes(KeyName::Escape).unwrap(),
        [Stroke {
            code: KEY_ESCAPE,
            mask: 0
        }]
    );
}

#[test]
fn gesture_modifiers_become_state_bits_and_press_order() {
    let modifiers = Modifiers {
        ctrl: true,
        alt: false,
        shift: true,
        meta: true,
    };

    assert_eq!(modifiers_mask(modifiers), 1 | (1 << 2) | (1 << 6));
    assert_eq!(
        modifier_keys(modifiers),
        [KeyName::Ctrl, KeyName::Shift, KeyName::Meta]
    );
}

#[test]
fn the_toolkit_filter_recognises_the_toolkits_that_drop_send_event() {
    let cases: [(&[u8], Option<Toolkit>); 8] = [
        (b"gtk3-demo\0Gtk3-demo\0", Some(Toolkit::Gtk)),
        (b"gedit\0Gdk-app\0", Some(Toolkit::Gtk)),
        (b"qterminal\0QTerminal\0", Some(Toolkit::Qt)),
        (b"google-chrome\0Google-chrome\0", Some(Toolkit::Chromium)),
        (b"chromium\0Chromium\0", Some(Toolkit::Chromium)),
        (b"Navigator\0firefox\0", Some(Toolkit::Firefox)),
        (b"xterm\0XTerm\0", None),
        (b"", None),
    ];
    for (class, expected) in cases {
        assert_eq!(
            filtering_toolkit(class),
            expected,
            "{}",
            String::from_utf8_lossy(class)
        );
    }
}

#[test]
fn held_keys_are_released_most_recent_first_and_forgotten_once_up() {
    let mut held = Held::default();
    let ctrl = HeldKey {
        route: Route::Xtest,
        code: 12,
    };
    let c = HeldKey {
        route: Route::Window(7),
        code: 9,
    };
    held.key_down(ctrl);
    held.key_down(c);
    held.key_down(c);

    assert_eq!(held.keys(), [c, ctrl]);
    held.key_up(c);
    assert_eq!(held.keys(), [ctrl]);
    held.key_up(HeldKey {
        route: Route::Window(7),
        code: 12,
    });
    assert_eq!(
        held.keys(),
        [ctrl],
        "a release on another route is a different key"
    );
}

#[test]
fn a_held_button_is_tracked_per_route_and_button() {
    let mut held = Held::default();
    let spot = Spot {
        root: (1, 2),
        local: (1, 2),
    };
    let left = HeldButton {
        route: Route::Xtest,
        detail: 1,
        at: spot,
    };
    held.button_down(left);
    held.button_down(left);

    assert_eq!(held.buttons(), [left]);
    held.button_up(Route::Window(7), 1);
    assert_eq!(held.buttons(), [left]);
    held.button_up(Route::Xtest, 1);
    assert!(held.is_empty());
}
