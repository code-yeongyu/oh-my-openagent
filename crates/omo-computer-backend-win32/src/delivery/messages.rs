//! The posted pointer messages: buttons and moves at a client point, the wheel at a screen point
//! with 120 per notch, and the notch count of a scroll distance.

use omo_computer_core::params::Button;

use crate::input::Posted;

use super::target::ClientPoint;

pub const WM_MOUSEMOVE: u32 = 0x0200;
pub const WM_LBUTTONDOWN: u32 = 0x0201;
pub const WM_LBUTTONUP: u32 = 0x0202;
pub const WM_RBUTTONDOWN: u32 = 0x0204;
pub const WM_RBUTTONUP: u32 = 0x0205;
pub const WM_MBUTTONDOWN: u32 = 0x0207;
pub const WM_MBUTTONUP: u32 = 0x0208;
pub const WM_MOUSEWHEEL: u32 = 0x020A;
pub const WM_MOUSEHWHEEL: u32 = 0x020E;
/// One wheel notch.
pub const WHEEL_DELTA: i16 = 120;
/// The most notches one scroll call posts.
pub const MAX_NOTCHES: u32 = 40;

/// `MAKELPARAM(x, y)`: the low word x, the high word y, each the 16-bit two's complement.
#[must_use]
pub fn point_lparam(x: i16, y: i16) -> isize {
    let bits = u32::from(x.cast_unsigned()) | (u32::from(y.cast_unsigned()) << 16);
    isize::try_from(i32::from_ne_bytes(bits.to_ne_bytes())).unwrap_or_default()
}

/// A button press or release at `at`; a press carries its `MK_*` key state.
#[must_use]
pub fn button(button: Button, down: bool, at: ClientPoint) -> Posted {
    let (msg, mk) = match (button, down) {
        (Button::Left, true) => (WM_LBUTTONDOWN, 0x0001),
        (Button::Left, false) => (WM_LBUTTONUP, 0),
        (Button::Right, true) => (WM_RBUTTONDOWN, 0x0002),
        (Button::Right, false) => (WM_RBUTTONUP, 0),
        (Button::Middle, true) => (WM_MBUTTONDOWN, 0x0010),
        (Button::Middle, false) => (WM_MBUTTONUP, 0),
    };
    Posted {
        msg,
        wparam: mk,
        lparam: point_lparam(at.x, at.y),
    }
}

/// A pointer move to `at`.
#[must_use]
pub fn moved(at: ClientPoint) -> Posted {
    Posted {
        msg: WM_MOUSEMOVE,
        wparam: 0,
        lparam: point_lparam(at.x, at.y),
    }
}

/// One wheel notch at the screen point `screen`: `delta` in the high word of wParam.
#[must_use]
pub fn wheel(horizontal: bool, delta: i16, screen: ClientPoint) -> Posted {
    Posted {
        msg: if horizontal {
            WM_MOUSEHWHEEL
        } else {
            WM_MOUSEWHEEL
        },
        wparam: usize::from(delta.cast_unsigned()) << 16,
        lparam: point_lparam(screen.x, screen.y),
    }
}

/// The notches a scroll distance asks for: none for zero, else `floor((|d| + 50) / 100)` and at
/// least one, uncapped (the deliverer posts at most [`MAX_NOTCHES`] and reports the rest).
#[must_use]
pub fn notches(distance: f64) -> u32 {
    if distance.is_nan() || distance == 0.0 {
        return 0;
    }
    let asked = ((distance.abs() + 50.0) / 100.0).floor().max(1.0);
    if asked >= f64::from(u32::MAX) {
        return u32::MAX;
    }
    // In range by the checks above, so the cast neither truncates nor saturates.
    asked as u32
}

/// One notch's signed delta: a positive distance scrolls down or right, and down is a negative
/// `WM_MOUSEWHEEL` delta (the wheel turns toward the user) while right is a positive
/// `WM_MOUSEHWHEEL` one.
#[must_use]
pub fn notch_delta(horizontal: bool, distance: f64) -> i16 {
    if (distance > 0.0) == horizontal {
        WHEEL_DELTA
    } else {
        -WHEEL_DELTA
    }
}
