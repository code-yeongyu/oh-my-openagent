//! Pure scalar packing of posted pointer messages and of `SendInput`
//! absolute coordinates, plus the wheel-step rule both routes share. No
//! Windows imports, so the arithmetic is tested on every host.

use senpi_desktop_core::backend::{Modifiers, MouseButton};
use senpi_desktop_core::error::{CoreResult, DesktopError};

pub const WM_MOUSEMOVE: u32 = 0x0200;
pub const WM_MOUSEWHEEL: u32 = 0x020A;
pub const WM_MOUSEHWHEEL: u32 = 0x020E;
pub const WM_CHAR: u32 = 0x0102;
pub const WHEEL_DELTA: i32 = 120;

const MK_LBUTTON: usize = 0x0001;
const MK_RBUTTON: usize = 0x0002;
const MK_SHIFT: usize = 0x0004;
const MK_CONTROL: usize = 0x0008;
const MK_MBUTTON: usize = 0x0010;

/// The posted messages of one mouse button.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ButtonMessages {
    pub down: u32,
    pub up: u32,
    pub double: u32,
    /// The `MK_*` bit reported while the button is down.
    pub flag: usize,
}

pub const fn button_messages(button: MouseButton) -> ButtonMessages {
    let (down, flag) = match button {
        MouseButton::Left => (0x0201, MK_LBUTTON),
        MouseButton::Right => (0x0204, MK_RBUTTON),
        MouseButton::Middle => (0x0207, MK_MBUTTON),
    };
    ButtonMessages {
        down,
        up: down + 1,
        double: down + 2,
        flag,
    }
}

/// The `MK_*` key-state bits a posted mouse message reports.
pub const fn modifier_flags(modifiers: Modifiers) -> usize {
    (if modifiers.ctrl { MK_CONTROL } else { 0 }) | (if modifiers.shift { MK_SHIFT } else { 0 })
}

/// Wheel notches for a pixel-ish delta: 0 for no motion, otherwise at least
/// one notch per 100 units, rounded half up.
pub fn scroll_steps(delta: f64) -> i32 {
    if delta.abs() < f64::EPSILON {
        return 0;
    }
    let magnitude = ((delta.abs() + 50.0) / 100.0)
        .floor()
        .clamp(1.0, f64::from(i32::MAX));
    // Float-to-int `as` saturates; `magnitude` is already within i32.
    let steps = magnitude as i32;
    if delta.is_sign_negative() {
        -steps
    } else {
        steps
    }
}

/// A client or screen point as a message `lParam` (two signed 16-bit words).
///
/// # Errors
/// `InputFailed` when a coordinate does not fit a signed 16-bit word.
pub fn packed_point(x: i32, y: i32) -> CoreResult<isize> {
    let x = i16::try_from(x)
        .map_err(|_| DesktopError::input_failed(format!("window x coordinate {x} exceeds i16")))?;
    let y = i16::try_from(y)
        .map_err(|_| DesktopError::input_failed(format!("window y coordinate {y} exceeds i16")))?;
    let bits = u32::from(u16::from_ne_bytes(x.to_ne_bytes()))
        | (u32::from(u16::from_ne_bytes(y.to_ne_bytes())) << 16);
    isize::try_from(i32::from_ne_bytes(bits.to_ne_bytes()))
        .map_err(|_| DesktopError::input_failed("packed point exceeds the lParam width"))
}

/// A wheel delta in the high word of a wheel message's `wParam`.
///
/// # Errors
/// `InputFailed` when the delta does not fit a signed 16-bit word.
pub fn wheel_wparam(delta: i32) -> CoreResult<usize> {
    let delta = i16::try_from(delta)
        .map_err(|_| DesktopError::input_failed(format!("scroll delta {delta} exceeds Win32 range")))?;
    Ok(usize::from(u16::from_ne_bytes(delta.to_ne_bytes())) << 16)
}

/// A physical virtual-desktop coordinate normalized to `SendInput`'s
/// 0..=65535 absolute range over an axis starting at `origin` spanning
/// `extent` pixels; `None` when the axis is degenerate.
pub fn absolute_coordinate(value: i32, origin: i32, extent: i32) -> Option<i32> {
    if extent <= 1 {
        return None;
    }
    let scaled = (i64::from(value) - i64::from(origin)) * 65_535 / (i64::from(extent) - 1);
    i32::try_from(scaled.clamp(0, 65_535)).ok()
}
