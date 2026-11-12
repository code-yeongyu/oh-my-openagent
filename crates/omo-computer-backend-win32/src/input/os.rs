//! The one `SendInput` call site and the one `PostMessageW` call site of the crate (acceptance
//! 30's source guard). Every unit carries [`super::ENGINE_TAG`]. `SendInput`'s return value is the
//! accepted count, used only to release a partial batch, never as delivery evidence.

use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

use super::{KeyUnit, Posted, ENGINE_TAG};

fn input(unit: &KeyUnit) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if unit.unicode {
        flags |= KEYEVENTF_UNICODE;
    }
    if unit.scan_coded {
        flags |= KEYEVENTF_SCANCODE;
    }
    if !unit.down {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(unit.vk),
                wScan: unit.scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: ENGINE_TAG,
            },
        },
    }
}

/// Inserts one batch; the count Windows accepted.
pub(crate) fn send(batch: &[KeyUnit]) -> usize {
    let inputs: Vec<INPUT> = batch.iter().map(input).collect();
    let size = i32::try_from(std::mem::size_of::<INPUT>()).unwrap_or(0);
    // SAFETY: `inputs` is a live slice of fully initialised keyboard INPUTs of the stated size.
    let sent = unsafe { SendInput(&inputs, size) };
    usize::try_from(sent).unwrap_or(0)
}

/// Posts one message to `window`; `false` when the queue refused it.
pub(crate) fn post(window: isize, message: &Posted) -> bool {
    let hwnd = HWND(window as *mut core::ffi::c_void);
    // SAFETY: a plain message post; an invalid window makes the call fail, never UB.
    unsafe {
        PostMessageW(
            Some(hwnd),
            message.msg,
            WPARAM(message.wparam),
            LPARAM(message.lparam),
        )
    }
    .is_ok()
}
