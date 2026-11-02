//! Pure Win32 key vocabulary: the virtual-key code of every named core key,
//! the implicit modifiers a layout needs for a character, and the `lParam`
//! bits of a posted key message. No Windows imports, so the table is tested
//! on every host; the Windows tests pin each code to `windows-sys`.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::keys::KeyName;

pub const VK_BACK: u16 = 0x08;
pub const VK_TAB: u16 = 0x09;
pub const VK_RETURN: u16 = 0x0D;
pub const VK_SHIFT: u16 = 0x10;
pub const VK_CONTROL: u16 = 0x11;
pub const VK_MENU: u16 = 0x12;
pub const VK_CAPITAL: u16 = 0x14;
pub const VK_ESCAPE: u16 = 0x1B;
pub const VK_SPACE: u16 = 0x20;
pub const VK_PRIOR: u16 = 0x21;
pub const VK_NEXT: u16 = 0x22;
pub const VK_END: u16 = 0x23;
pub const VK_HOME: u16 = 0x24;
pub const VK_LEFT: u16 = 0x25;
pub const VK_UP: u16 = 0x26;
pub const VK_RIGHT: u16 = 0x27;
pub const VK_DOWN: u16 = 0x28;
pub const VK_SNAPSHOT: u16 = 0x2C;
pub const VK_INSERT: u16 = 0x2D;
pub const VK_DELETE: u16 = 0x2E;
pub const VK_LWIN: u16 = 0x5B;
/// `VK_F1`; `VK_F1..=VK_F24` are contiguous.
pub const VK_F1: u16 = 0x70;
pub const VK_NUMLOCK: u16 = 0x90;

pub const WM_KEYDOWN: u32 = 0x0100;
pub const WM_KEYUP: u32 = 0x0101;
pub const WM_SYSKEYDOWN: u32 = 0x0104;
pub const WM_SYSKEYUP: u32 = 0x0105;

/// `VkKeyScanW` shift-state bits.
const SHIFT_STATE_SHIFT: u8 = 1;
const SHIFT_STATE_CTRL: u8 = 2;
const SHIFT_STATE_ALT: u8 = 4;

/// The virtual key of every named key; `None` for [`KeyName::Char`], whose
/// key depends on the active keyboard layout (`VkKeyScanW`).
pub const fn named_virtual_key(key: KeyName) -> Option<u16> {
    let vk = match key {
        KeyName::Ctrl => VK_CONTROL,
        KeyName::Alt => VK_MENU,
        KeyName::Shift => VK_SHIFT,
        KeyName::Meta => VK_LWIN,
        KeyName::Enter => VK_RETURN,
        KeyName::Escape => VK_ESCAPE,
        KeyName::Tab => VK_TAB,
        KeyName::Space => VK_SPACE,
        KeyName::Backspace => VK_BACK,
        KeyName::Delete => VK_DELETE,
        KeyName::Insert => VK_INSERT,
        KeyName::Home => VK_HOME,
        KeyName::End => VK_END,
        KeyName::PageUp => VK_PRIOR,
        KeyName::PageDown => VK_NEXT,
        KeyName::Up => VK_UP,
        KeyName::Down => VK_DOWN,
        KeyName::Left => VK_LEFT,
        KeyName::Right => VK_RIGHT,
        KeyName::CapsLock => VK_CAPITAL,
        KeyName::NumLock => VK_NUMLOCK,
        KeyName::PrintScreen => VK_SNAPSHOT,
        KeyName::F1 => VK_F1,
        KeyName::F2 => VK_F1 + 1,
        KeyName::F3 => VK_F1 + 2,
        KeyName::F4 => VK_F1 + 3,
        KeyName::F5 => VK_F1 + 4,
        KeyName::F6 => VK_F1 + 5,
        KeyName::F7 => VK_F1 + 6,
        KeyName::F8 => VK_F1 + 7,
        KeyName::F9 => VK_F1 + 8,
        KeyName::F10 => VK_F1 + 9,
        KeyName::F11 => VK_F1 + 10,
        KeyName::F12 => VK_F1 + 11,
        KeyName::F13 => VK_F1 + 12,
        KeyName::F14 => VK_F1 + 13,
        KeyName::F15 => VK_F1 + 14,
        KeyName::F16 => VK_F1 + 15,
        KeyName::F17 => VK_F1 + 16,
        KeyName::F18 => VK_F1 + 17,
        KeyName::F19 => VK_F1 + 18,
        KeyName::F20 => VK_F1 + 19,
        KeyName::F21 => VK_F1 + 20,
        KeyName::F22 => VK_F1 + 21,
        KeyName::F23 => VK_F1 + 22,
        KeyName::F24 => VK_F1 + 23,
        KeyName::Char(_) => return None,
    };
    Some(vk)
}

/// One key as the layout produces it: the virtual key plus the modifiers the
/// layout needs held for it (`VkKeyScanW`'s high byte).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stroke {
    pub vk: u16,
    pub shift_state: u8,
}

impl Stroke {
    pub const fn plain(vk: u16) -> Self {
        Self { vk, shift_state: 0 }
    }

    /// Splits a `VkKeyScanW` result into key and shift state; `None` for its
    /// "not on this layout" value (-1).
    pub const fn from_scan(scan: i16) -> Option<Self> {
        if scan == -1 {
            return None;
        }
        let [vk, shift_state] = scan.to_le_bytes();
        Some(Self {
            vk: vk as u16,
            shift_state,
        })
    }

    /// The virtual keys to press in order: the implicit modifiers (shift,
    /// ctrl, alt), then the key itself. Release runs in reverse.
    pub fn press_order(self) -> Vec<u16> {
        [
            (SHIFT_STATE_SHIFT, VK_SHIFT),
            (SHIFT_STATE_CTRL, VK_CONTROL),
            (SHIFT_STATE_ALT, VK_MENU),
        ]
        .into_iter()
        .filter(|(bit, _)| self.shift_state & bit != 0)
        .map(|(_, vk)| vk)
        .chain([self.vk])
        .collect()
    }
}

/// The modifier keys a pointer action holds, in press order.
pub fn modifier_keys(modifiers: Modifiers) -> impl Iterator<Item = KeyName> {
    [
        modifiers.ctrl.then_some(KeyName::Ctrl),
        modifiers.alt.then_some(KeyName::Alt),
        modifiers.shift.then_some(KeyName::Shift),
        modifiers.meta.then_some(KeyName::Meta),
    ]
    .into_iter()
    .flatten()
}

/// The virtual keys of the modifiers a pointer action holds, in press order.
pub fn modifier_virtual_keys(modifiers: Modifiers) -> Vec<u16> {
    modifier_keys(modifiers).filter_map(named_virtual_key).collect()
}

/// The virtual keys of a chord in press order: each stroke's implicit
/// modifiers, then its key; a key already down is not pressed twice.
pub fn chord_virtual_keys(strokes: &[Stroke]) -> Vec<u16> {
    let mut keys = Vec::with_capacity(strokes.len());
    for vk in strokes.iter().flat_map(|stroke| stroke.press_order()) {
        if !keys.contains(&vk) {
            keys.push(vk);
        }
    }
    keys
}

/// Keys whose scan code carries the extended-key prefix (E0).
pub const fn is_extended(vk: u16) -> bool {
    matches!(
        vk,
        VK_INSERT | VK_DELETE | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN
    )
}

/// The message and `lParam` of a posted key transition: repeat count 1, the
/// scan code, the extended bit, the context bit while Alt is down (which
/// also makes it a `WM_SYS*` message), and the previous-state and
/// transition bits on release.
pub const fn key_message(vk: u16, scan: u32, down: bool, alt_down: bool) -> (u32, isize) {
    let mut bits = 1u32 | ((scan & 0xff) << 16);
    if is_extended(vk) {
        bits |= 1 << 24;
    }
    let system = alt_down || vk == VK_MENU;
    if system {
        bits |= 1 << 29;
    }
    if !down {
        bits |= (1 << 30) | (1 << 31);
    }
    let message = match (down, system) {
        (true, true) => WM_SYSKEYDOWN,
        (true, false) => WM_KEYDOWN,
        (false, true) => WM_SYSKEYUP,
        (false, false) => WM_KEYUP,
    };
    (message, i32::from_ne_bytes(bits.to_ne_bytes()) as isize)
}
