//! Key names to X keysyms, and keysyms to the keycodes of the server's core
//! keyboard map. Shared by input delivery and the XI2 stop chord.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use x11rb::protocol::xproto::KeyButMask;
use xkeysym::Keysym;

/// One key to press: its keycode and the modifier bit it holds while down
/// (0 for a non-modifier), which later events of the same chord carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stroke {
    pub code: u8,
    pub mask: u16,
}

/// The core keyboard map (`GetKeyboardMapping`), row `i` = keycode
/// `min_keycode + i`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keymap {
    pub min_keycode: u8,
    pub keysyms_per_keycode: u8,
    pub keysyms: Vec<u32>,
}

impl Keymap {
    /// Keycodes whose unshifted or shifted keysym is `keysym`.
    pub fn codes(&self, keysym: u32) -> Vec<u8> {
        self.rows()
            .filter(|(_, row)| row.iter().take(2).any(|&candidate| candidate == keysym))
            .map(|(code, _)| code)
            .collect()
    }

    /// The keycode producing `keysym` and whether Shift is needed for it; an
    /// unshifted match wins over a shifted one.
    ///
    /// # Errors
    /// `InvalidKey` when no keycode produces the keysym.
    pub fn lookup(&self, keysym: u32) -> CoreResult<(u8, bool)> {
        for column in 0..2 {
            if let Some((code, _)) = self.rows().find(|(_, row)| row.get(column) == Some(&keysym)) {
                return Ok((code, column == 1));
            }
        }
        Err(DesktopError::invalid_key(format!(
            "the X11 keyboard map has no keycode for keysym {keysym:#x}"
        )))
    }

    /// The strokes that type `key`: a Shift press first when its keysym is
    /// on the shifted level.
    ///
    /// # Errors
    /// `InvalidKey` when the key (or Shift) has no keycode.
    pub fn strokes(&self, key: KeyName) -> CoreResult<Vec<Stroke>> {
        let (code, shifted) = self.lookup(keysym(key))?;
        let stroke = Stroke {
            code,
            mask: modifier_mask(key),
        };
        if shifted && !matches!(key, KeyName::Shift) {
            Ok(vec![self.stroke(KeyName::Shift)?, stroke])
        } else {
            Ok(vec![stroke])
        }
    }

    /// The single stroke of a key that needs no Shift level (chord keys).
    ///
    /// # Errors
    /// `InvalidKey` when the key has no keycode.
    pub fn stroke(&self, key: KeyName) -> CoreResult<Stroke> {
        let (code, _) = self.lookup(keysym(key))?;
        Ok(Stroke {
            code,
            mask: modifier_mask(key),
        })
    }

    fn rows(&self) -> impl Iterator<Item = (u8, &[u32])> {
        let width = usize::from(self.keysyms_per_keycode).max(1);
        self.keysyms
            .chunks_exact(width)
            .zip(self.min_keycode..=u8::MAX)
            .map(|(row, code)| (code, row))
    }
}

/// The modifier bit a held key contributes to later events' `state`.
pub fn modifier_mask(key: KeyName) -> u16 {
    let mask = match key {
        KeyName::Shift => KeyButMask::SHIFT,
        KeyName::Ctrl => KeyButMask::CONTROL,
        KeyName::Alt => KeyButMask::MOD1,
        KeyName::Meta => KeyButMask::MOD4,
        _ => return 0,
    };
    u16::from(mask)
}

/// The `state` bits of a pointer gesture's modifiers.
pub fn modifiers_mask(modifiers: Modifiers) -> u16 {
    let mut mask = 0;
    if modifiers.shift {
        mask |= modifier_mask(KeyName::Shift);
    }
    if modifiers.ctrl {
        mask |= modifier_mask(KeyName::Ctrl);
    }
    if modifiers.alt {
        mask |= modifier_mask(KeyName::Alt);
    }
    if modifiers.meta {
        mask |= modifier_mask(KeyName::Meta);
    }
    mask
}

/// The modifier keys of `modifiers`, in press order.
pub fn modifier_keys(modifiers: Modifiers) -> Vec<KeyName> {
    [
        (modifiers.ctrl, KeyName::Ctrl),
        (modifiers.alt, KeyName::Alt),
        (modifiers.shift, KeyName::Shift),
        (modifiers.meta, KeyName::Meta),
    ]
    .into_iter()
    .filter_map(|(held, key)| held.then_some(key))
    .collect()
}

/// Every keysym a key name may arrive as: both sides of a modifier (plus
/// `Meta_*` for Alt, as most keymaps put it on the Alt keys), one keysym
/// otherwise.
pub fn keysym_variants(key: KeyName) -> Vec<u32> {
    let variants: &[Keysym] = match key {
        KeyName::Ctrl => &[Keysym::Control_L, Keysym::Control_R],
        KeyName::Shift => &[Keysym::Shift_L, Keysym::Shift_R],
        KeyName::Alt => &[Keysym::Alt_L, Keysym::Alt_R, Keysym::Meta_L, Keysym::Meta_R],
        KeyName::Meta => &[Keysym::Super_L, Keysym::Super_R],
        _ => return vec![keysym(key)],
    };
    variants.iter().map(|keysym| keysym.raw()).collect()
}

/// The keysym a key name types (left-hand side for modifiers).
pub fn keysym(key: KeyName) -> u32 {
    let keysym = match key {
        KeyName::Ctrl => Keysym::Control_L,
        KeyName::Alt => Keysym::Alt_L,
        KeyName::Shift => Keysym::Shift_L,
        KeyName::Meta => Keysym::Super_L,
        KeyName::Enter => Keysym::Return,
        KeyName::Escape => Keysym::Escape,
        KeyName::Tab => Keysym::Tab,
        KeyName::Space => Keysym::space,
        KeyName::Backspace => Keysym::BackSpace,
        KeyName::Delete => Keysym::Delete,
        KeyName::Insert => Keysym::Insert,
        KeyName::Home => Keysym::Home,
        KeyName::End => Keysym::End,
        KeyName::PageUp => Keysym::Prior,
        KeyName::PageDown => Keysym::Next,
        KeyName::Up => Keysym::Up,
        KeyName::Down => Keysym::Down,
        KeyName::Left => Keysym::Left,
        KeyName::Right => Keysym::Right,
        KeyName::CapsLock => Keysym::Caps_Lock,
        KeyName::NumLock => Keysym::Num_Lock,
        KeyName::PrintScreen => Keysym::Print,
        KeyName::F1 => Keysym::F1,
        KeyName::F2 => Keysym::F2,
        KeyName::F3 => Keysym::F3,
        KeyName::F4 => Keysym::F4,
        KeyName::F5 => Keysym::F5,
        KeyName::F6 => Keysym::F6,
        KeyName::F7 => Keysym::F7,
        KeyName::F8 => Keysym::F8,
        KeyName::F9 => Keysym::F9,
        KeyName::F10 => Keysym::F10,
        KeyName::F11 => Keysym::F11,
        KeyName::F12 => Keysym::F12,
        KeyName::F13 => Keysym::F13,
        KeyName::F14 => Keysym::F14,
        KeyName::F15 => Keysym::F15,
        KeyName::F16 => Keysym::F16,
        KeyName::F17 => Keysym::F17,
        KeyName::F18 => Keysym::F18,
        KeyName::F19 => Keysym::F19,
        KeyName::F20 => Keysym::F20,
        KeyName::F21 => Keysym::F21,
        KeyName::F22 => Keysym::F22,
        KeyName::F23 => Keysym::F23,
        KeyName::F24 => Keysym::F24,
        KeyName::Char('\n' | '\r') => Keysym::Return,
        KeyName::Char('\t') => Keysym::Tab,
        KeyName::Char(ch) => Keysym::from_char(ch),
    };
    keysym.raw()
}
