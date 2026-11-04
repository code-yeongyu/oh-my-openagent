//! Live checks against the real WindowServer. `#[ignore]`d: they need a
//! logged-in macOS session with an Accessibility grant for the launcher. Run
//! with `--ignored --nocapture`; each prints machine-read `key=value` facts.

use senpi_desktop_core::error::CoreResult;

use super::bring_to_current_space;
use super::native::window_on_another_space;

fn never_stopped() -> CoreResult<()> {
    Ok(())
}

#[test]
#[ignore = "live: needs a logged-in session and an Accessibility grant"]
fn the_front_window_is_already_on_the_current_space() {
    // Given: the user's front window, which is on the Space the user sees
    let front = crate::focus::front_window().unwrap().expect("a front window");
    let id = front.window_id.clone().expect("a front window id");
    // When
    let result = bring_to_current_space(&id, &never_stopped);
    // Then: a no-op success (nothing moves), and its app has nothing elsewhere
    let pid = libc::pid_t::try_from(front.pid).unwrap();
    println!("window_id={id} result={result:?} on_another_space={:?}", window_on_another_space(pid));
    assert_eq!(result, Ok(()));
}
