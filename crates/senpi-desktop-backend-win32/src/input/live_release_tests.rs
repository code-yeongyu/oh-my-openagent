use senpi_desktop_core::error::ErrorCode;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

use super::barrier;
use super::foreground::raise_window;
use super::keys::VK_RETURN;
use super::live_tests::LIVE_INPUT;
use super::native::{self, Window};
use super::system;
use crate::ax::live_tests::Notepad;

struct ReleaseReturn;

impl Drop for ReleaseReturn {
    fn drop(&mut self) {
        if let Err(error) = system::key(VK_RETURN, false, None) {
            eprintln!("Return test cleanup failed: {error}");
        }
    }
}

struct RestoreFront(Option<Window>);

impl Drop for RestoreFront {
    fn drop(&mut self) {
        if let Some(window) = self.0 {
            if window.is_live() && !native::set_foreground(window) {
                eprintln!("Return test could not restore the previous foreground");
            }
        }
    }
}

fn return_is_down() -> bool {
    // SAFETY: [Category 8 - FFI boundary] reads the scalar virtual-key state.
    (unsafe { GetAsyncKeyState(i32::from(VK_RETURN)) }) < 0
}

#[test]
#[ignore = "live: requires the hosted Windows interactive desktop and Notepad"]
fn accepted_return_is_released_after_a_foreground_handoff() {
    let _input = LIVE_INPUT.lock();
    let _restore = RestoreFront(native::foreground());
    let mut target = Notepad::open("return-target");
    let target_window = target.wait_for_window();
    let mut other = Notepad::open("return-other");
    let other_window = other.wait_for_window();
    let target = Window::parse(&target_window.id).unwrap();
    let other = Window::parse(&other_window.id).unwrap();
    raise_window(&target_window.id).unwrap();
    assert!(!return_is_down(), "Return must start released");
    let _release = ReleaseReturn;

    system::key(VK_RETURN, true, Some(target)).unwrap();
    barrier::delivered(target).unwrap();
    assert!(return_is_down(), "the actual Return press must have landed");
    raise_window(&other_window.id).unwrap();
    assert_eq!(native::foreground(), Some(other));

    let refused = system::key(VK_RETURN, true, Some(target)).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InputFailed);
    let released = system::key(VK_RETURN, false, Some(target));
    println!("return_release_after_handoff={released:?}");
    assert_eq!(released, Ok(()));
    barrier::delivered(other).unwrap();
    assert!(
        !return_is_down(),
        "Return must not remain held after handoff"
    );
    assert_eq!(native::foreground(), Some(other));
}
