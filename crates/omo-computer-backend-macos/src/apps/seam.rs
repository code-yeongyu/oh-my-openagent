//! The macOS reads and the launch `apps` makes.

use omo_computer_core::backend::Refusal;

/// A running application with windows or a regular activation policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningApp {
    pub pid: u32,
    pub bundle_id: Option<String>,
    pub name: String,
    /// The `.app` bundle path.
    pub path: Option<String>,
    /// `NSApplicationActivationPolicyRegular` (a background agent is not listed).
    pub regular: bool,
}

/// An installed application LaunchServices knows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledApp {
    pub bundle_id: String,
    pub name: String,
    pub path: String,
}

/// The OS side of `apps`.
pub trait AppsOs: Send {
    fn running(&mut self) -> Vec<RunningApp>;
    fn installed(&mut self) -> Vec<InstalledApp>;
    /// `NSWorkspace.openApplication(at:configuration:)` with `activates` as given; the pid.
    ///
    /// # Errors
    /// The launch failed or no launch route exists.
    fn launch(&mut self, bundle: &str, activate: bool) -> Result<u32, Refusal>;
    /// `NSWorkspace.activateFileViewerSelecting` on the bundle.
    fn reveal(&mut self, bundle: &str) -> bool;
    /// `proc_pidpath`.
    fn process_path(&mut self, pid: u32) -> Option<String>;
}
