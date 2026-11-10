//! The steps the real background keyboard paths took on this thread, kept
//! only in test builds: a unit test drives `type_text`/`key_chord` to a window
//! of a process that does not exist and reads which steps ran, in order,
//! before the key window refused with nothing posted
//! (`keyboard_wiring_tests.rs`). Release builds record nothing.

/// One step of background keyboard delivery to a window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum KeyStep {
    /// Text was offered to AX insertion into the window's focused field.
    Insert,
    /// The window was being proven key ([`super::key_window::KeyWindow::prepare`]).
    KeyWindow,
}

#[cfg(test)]
thread_local! {
    static STEPS: std::cell::RefCell<Vec<KeyStep>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(super) fn record(step: KeyStep) {
    STEPS.with(|steps| steps.borrow_mut().push(step));
}

#[cfg(not(test))]
pub(super) const fn record(_step: KeyStep) {}

/// The steps recorded on this thread since the last call.
#[cfg(test)]
pub(super) fn take() -> Vec<KeyStep> {
    STEPS.with(std::cell::RefCell::take)
}
