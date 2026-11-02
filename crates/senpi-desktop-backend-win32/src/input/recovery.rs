use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
};

use super::events::{key_event, mouse_event};

pub(super) fn release_accepted_prefix(
    events: &[INPUT],
    accepted: usize,
    mut release: impl FnMut(&INPUT) -> bool,
) -> bool {
    let mut succeeded = true;
    for event in pending_input_releases(&events[..accepted]).iter().rev() {
        if !release(event) {
            succeeded = false;
        }
    }
    succeeded
}

/// Releases unmatched presses in an accepted SendInput prefix. Inputs come
/// from this module's tagged constructors, never arbitrary union storage.
fn pending_input_releases(events: &[INPUT]) -> Vec<INPUT> {
    let mut pending = Vec::new();
    for event in events {
        let Some((down, release)) = release_transition(event) else {
            continue;
        };
        let previous = pending.iter().position(|held| same_release(held, &release));
        if down {
            if previous.is_none() {
                pending.push(release);
            }
        } else if let Some(index) = previous {
            pending.remove(index);
        }
    }
    pending
}

fn release_transition(event: &INPUT) -> Option<(bool, INPUT)> {
    // SAFETY: [Category 5 - Invalid values] callers use events.rs constructors
    // which initialize the union member selected by the INPUT type tag.
    unsafe {
        match event.r#type {
            INPUT_KEYBOARD => {
                let key = event.Anonymous.ki;
                Some((
                    key.dwFlags & KEYEVENTF_KEYUP == 0,
                    key_event(key.wVk, key.wScan, key.dwFlags | KEYEVENTF_KEYUP),
                ))
            }
            INPUT_MOUSE => {
                let flags = event.Anonymous.mi.dwFlags;
                for (down, up) in [
                    (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
                    (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
                    (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
                ] {
                    if flags & (down | up) != 0 {
                        return Some((flags & down != 0, mouse_event(up, 0, 0, 0)));
                    }
                }
                None
            }
            _ => None,
        }
    }
}

const fn same_release(left: &INPUT, right: &INPUT) -> bool {
    if left.r#type != right.r#type {
        return false;
    }
    // SAFETY: [Category 5 - Invalid values] matching tags select initialized
    // members produced by release_transition using the tagged constructors.
    unsafe {
        if left.r#type == INPUT_KEYBOARD {
            let a = left.Anonymous.ki;
            let b = right.Anonymous.ki;
            a.wVk == b.wVk && a.wScan == b.wScan && a.dwFlags == b.dwFlags
        } else {
            left.Anonymous.mi.dwFlags == right.Anonymous.mi.dwFlags
        }
    }
}

#[cfg(test)]
mod cleanup_tests;
#[cfg(test)]
mod tests;
