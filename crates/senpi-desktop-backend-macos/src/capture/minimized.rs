//! Whether an off-screen window is minimized. ScreenCaptureKit reports
//! `isOnScreen == false` for a minimized window and for one on another Space
//! alike; only Accessibility's `AXMinimized` tells them apart. `None` means
//! unknown (no Accessibility grant, or no AX window matched the id).

use crate::ax::element;

pub(crate) fn window_minimized(pid: i32, window_id: u32) -> Option<bool> {
    #[cfg(test)]
    if let Some(probe) = TEST_PROBE.with(std::cell::Cell::get) {
        return probe(pid, window_id);
    }
    if !element::is_trusted() {
        return None;
    }
    let application = element::create_application(pid).ok()?;
    element::copy_elements(&application, "AXWindows")?
        .iter()
        .find(|window| element::window_id(window) == Some(window_id))
        .and_then(|window| element::copy_bool(window, "AXMinimized"))
}

#[cfg(test)]
type MinimizedProbe = fn(i32, u32) -> Option<bool>;

#[cfg(test)]
thread_local! {
    static TEST_PROBE: std::cell::Cell<Option<MinimizedProbe>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn override_probe(probe: Option<MinimizedProbe>) {
    TEST_PROBE.with(|cell| cell.set(probe));
}
