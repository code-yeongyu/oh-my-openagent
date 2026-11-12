//! Windows input (d-windows.md '## Input'): keys only through `SendInput` and `PostMessageW`, one
//! tagged constructor, typed text on the two layout-independent routes, partial sends that
//! release only what they inserted, and the posted-route chord rules. The OS calls are the one
//! `SendInput` site and the one `PostMessageW` site in [`os`].

pub mod chords;
pub mod ledger;
pub mod partial;
pub mod text;

#[cfg(windows)]
#[allow(dead_code, reason = "post_input calls these once row 23's verbs carry the target window and row 57's lease exists")]
pub(crate) mod os;

#[cfg(test)]
mod tests;

/// `dwExtraInfo` of every synthetic event the engine inserts, so the low-level hooks and
/// `GetMessageExtraInfo` readers tell ours from the user's (d-windows.md '## Input').
pub const ENGINE_TAG: usize = 0x0073_656E_7069;

/// `VK_RETURN`.
pub const VK_RETURN: u16 = 0x0D;
/// `VK_TAB`.
pub const VK_TAB: u16 = 0x09;
/// `VK_SHIFT`.
pub const VK_SHIFT: u16 = 0x10;
/// `VK_CONTROL`.
pub const VK_CONTROL: u16 = 0x11;
/// `VK_MENU` (Alt).
pub const VK_MENU: u16 = 0x12;
/// `VK_LWIN`.
pub const VK_LWIN: u16 = 0x5B;
/// The virtual key of the letter F.
pub const VK_F: u16 = 0x46;
/// The scan code of Return on every PC layout.
pub const SCAN_RETURN: u16 = 0x1C;

/// `WM_KEYDOWN`.
pub const WM_KEYDOWN: u32 = 0x0100;
/// `WM_KEYUP`.
pub const WM_KEYUP: u32 = 0x0101;
/// `WM_CHAR`.
pub const WM_CHAR: u32 = 0x0102;
/// `WM_SYSKEYDOWN`.
pub const WM_SYSKEYDOWN: u32 = 0x0104;
/// `WM_SYSKEYUP`.
pub const WM_SYSKEYUP: u32 = 0x0105;

/// One keyboard `INPUT` the tagged constructor builds: a virtual key, a scan-coded key, or one
/// UTF-16 unit (`KEYEVENTF_UNICODE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyUnit {
    /// The virtual key; 0 for a unicode unit.
    pub vk: u16,
    /// The scan code, or the UTF-16 unit of a unicode unit.
    pub scan: u16,
    pub unicode: bool,
    pub scan_coded: bool,
    pub down: bool,
}

impl KeyUnit {
    #[must_use]
    pub const fn unicode(unit: u16, down: bool) -> Self {
        Self {
            vk: 0,
            scan: unit,
            unicode: true,
            scan_coded: false,
            down,
        }
    }

    /// Return as its scan code, so no layout maps it.
    #[must_use]
    pub const fn scan_coded(vk: u16, down: bool) -> Self {
        let scan = if vk == VK_RETURN { SCAN_RETURN } else { 0 };
        Self {
            vk,
            scan,
            unicode: false,
            scan_coded: true,
            down,
        }
    }

    #[must_use]
    pub const fn virtual_key(vk: u16, down: bool) -> Self {
        Self {
            vk,
            scan: 0,
            unicode: false,
            scan_coded: false,
            down,
        }
    }

    /// The same key, released.
    #[must_use]
    pub const fn up(self) -> Self {
        Self {
            down: false,
            ..self
        }
    }

    /// Whether `other` releases this press.
    #[must_use]
    pub const fn same_key(&self, other: &Self) -> bool {
        self.vk == other.vk && self.scan == other.scan && self.unicode == other.unicode
    }
}

/// One posted window message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Posted {
    pub msg: u32,
    pub wparam: usize,
    pub lparam: isize,
}

/// The lParam of a posted key message: repeat count 1, the scan code in bits 16-23, Alt as the
/// context code in bit 29, and the previous-state and transition bits on a release.
#[must_use]
pub fn key_lparam(scan: u16, down: bool, alt: bool) -> isize {
    let mut bits: u32 = 1 | (u32::from(scan & 0xFF) << 16);
    if alt {
        bits |= 1 << 29;
    }
    if !down {
        bits |= (1 << 30) | (1 << 31);
    }
    isize::try_from(i32::from_ne_bytes(bits.to_ne_bytes())).unwrap_or_default()
}

/// A posted key down or up; Alt makes it a `WM_SYSKEY*` with the context bit.
#[must_use]
pub fn posted_key(vk: u16, down: bool, alt: bool) -> Posted {
    let msg = match (down, alt) {
        (true, true) => WM_SYSKEYDOWN,
        (true, false) => WM_KEYDOWN,
        (false, true) => WM_SYSKEYUP,
        (false, false) => WM_KEYUP,
    };
    Posted {
        msg,
        wparam: usize::from(vk),
        lparam: key_lparam(0, down, alt),
    }
}
