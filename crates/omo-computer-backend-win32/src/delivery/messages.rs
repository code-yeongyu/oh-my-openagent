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

/// `floor((|d| + 50) / 100)` notches, at least one and at most [`MAX_NOTCHES`].
#[must_use]
pub fn notches(distance: f64) -> u32 {
    let mut count = 1;
    while count < MAX_NOTCHES && f64::from(count + 1) * 100.0 - 50.0 <= distance.abs() {
        count += 1;
    }
    count
}
