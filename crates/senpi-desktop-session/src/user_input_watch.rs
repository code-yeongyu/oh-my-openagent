//! When the session starts the backend's watch of the user's own key presses
//! and clicks: lazily, on the first request that reads or acts on an app, so
//! a session that only lists or captures the desktop installs no event tap.

use senpi_desktop_core::types::Target;

use crate::request::Op;
use crate::worker::Worker;

impl Worker {
    /// Starts the watch once per backend and publishes the capabilities that
    /// report it. Its only caller today is the request dispatch. Foreground
    /// arming (a takeover, or a live human grant) does not call it yet: the
    /// #11465 plan's todo 27 adds that caller, before anything is sent.
    pub(crate) fn watch_user_input(&mut self) {
        if self.watching_user_input {
            return;
        }
        let Ok(backend) = self.backend.as_mut() else {
            return;
        };
        backend.watch_user_input();
        self.watching_user_input = true;
        self.refresh_capabilities();
    }
}

/// Whether `op` reads or acts on an app: anything aimed at a window, an
/// accessibility element, or a menu. Desktop- and display-wide requests,
/// listings, the clipboard and control requests name no app.
pub(crate) fn reads_or_acts_on_an_app(op: &Op) -> bool {
    match op {
        Op::Capture(params) => names_a_window(&params.target),
        Op::Observe(params) => names_a_window(&params.target),
        Op::CaptureRegion(params) => names_a_window(&params.target),
        Op::Click(params) | Op::MoveMouse(params) => names_a_window(&params.target),
        Op::Drag(params) => names_a_window(&params.target),
        Op::Scroll(params) => names_a_window(&params.target),
        Op::TypeText(params) => names_a_window(&params.target),
        Op::KeyChord(params) => names_a_window(&params.target),
        Op::HoldKeys(params) => names_a_window(&params.target),
        Op::HoldMouse(params) => names_a_window(&params.target),
        Op::RaiseWindow(_)
        | Op::MenuItems(_)
        | Op::MenusSelect(_)
        | Op::AxSnapshot(_)
        | Op::AxQuery(_)
        | Op::AxElementAt(_)
        | Op::AxFocused
        | Op::AxNode(_)
        | Op::AxAttributes(_)
        | Op::AxChildren(_)
        | Op::AxParent(_)
        | Op::AxPerform(_)
        | Op::AxSetValue(_)
        | Op::AxFocus(_)
        | Op::AxClick(_)
        | Op::AxTypeText(_) => true,
        Op::Displays
        | Op::Windows
        | Op::ClipboardRead
        | Op::ClipboardWrite(_)
        | Op::ControlGrant(_)
        | Op::ControlRevoke
        | Op::ControlState => false,
    }
}

fn names_a_window(target: &str) -> bool {
    matches!(Target::parse(target), Target::Window(_))
}

#[cfg(test)]
#[path = "user_input_watch/tests.rs"]
mod tests;
