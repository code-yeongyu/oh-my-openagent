//! Actionable TCC refusals. Probes never call this module; denied actions do.

use std::sync::OnceLock;

use senpi_desktop_core::error::{DesktopError, PermissionDeniedData, TccPermission};

const LAUNCHER: &str = "the app that launched OmO (for a terminal launch, that terminal app)";

fn settings_url(permission: TccPermission) -> &'static str {
    match permission {
        TccPermission::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        TccPermission::Accessibility => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
    }
}

fn host_app_name() -> String {
    launcher_name(std::env::var("SENPI_DESKTOP_HOST_APP").ok())
}

fn launcher_name(value: Option<String>) -> String {
    value.filter(|app| !app.trim().is_empty()).unwrap_or_else(|| LAUNCHER.to_owned())
}

#[derive(Default)]
struct Settings {
    screen_recording: OnceLock<bool>,
    accessibility: OnceLock<bool>,
}

impl Settings {
    fn permission_denied(
        &self,
        permission: TccPermission,
        opener: impl FnOnce(&str) -> bool,
    ) -> DesktopError {
        let (opened, opened_now) = self.open_settings_once(permission, opener);
        denial(permission, host_app_name(), opened, opened_now)
    }

    fn open_settings_once(
        &self,
        permission: TccPermission,
        opener: impl FnOnce(&str) -> bool,
    ) -> (bool, bool) {
        let opened = match permission {
            TccPermission::ScreenRecording => &self.screen_recording,
            TccPermission::Accessibility => &self.accessibility,
        };
        let mut opened_now = false;
        let opened = *opened.get_or_init(|| {
            opened_now = true;
            opener(settings_url(permission))
        });
        (opened, opened_now)
    }
}

static SETTINGS: Settings = Settings {
    screen_recording: OnceLock::new(),
    accessibility: OnceLock::new(),
};

#[cfg(not(test))]
fn open_settings(url: &str) -> bool {
    match std::process::Command::new("/usr/bin/open").arg(url).status() {
        Ok(status) => status.success(),
        Err(error) => {
            eprintln!("cannot open macOS privacy settings: {error}");
            false
        }
    }
}

// Unit tests simulate denied capture without touching the test runner's desktop.
#[cfg(test)]
fn open_settings(_: &str) -> bool {
    true
}

pub(crate) fn permission_denied(permission: TccPermission) -> DesktopError {
    SETTINGS.permission_denied(permission, open_settings)
}

fn denial(permission: TccPermission, app: String, opened: bool, opened_now: bool) -> DesktopError {
    denial_with_identity(permission, app, opened, opened_now, crate::responsible::current)
}

fn denial_with_identity(
    permission: TccPermission,
    app: String,
    opened: bool,
    opened_now: bool,
    lookup: impl FnOnce() -> Option<crate::responsible::ResponsibleProcess>,
) -> DesktopError {
    let pane = match permission {
        TccPermission::ScreenRecording => "Screen Recording",
        TccPermission::Accessibility => "Accessibility",
    };
    let url = settings_url(permission);
    let identity = crate::responsible::suffix_with(lookup);
    let opening = match (opened_now, opened) {
        (true, true) => format!("System Settings > Privacy & Security > {pane} has been opened"),
        (true, false) => format!(
            "System Settings > Privacy & Security > {pane} could not be opened automatically; open it"
        ),
        (false, true) => format!("In System Settings > Privacy & Security > {pane}, opened earlier"),
        (false, false) => format!("Open System Settings > Privacy & Security > {pane}"),
    };
    let message = format!(
        "macOS {pane} is not granted for {app}. {opening} ({url}): turn on \"{app}\", \
         then fully quit and relaunch {app} before retrying. \
         (TCC identity: {identity})"
    );
    DesktopError::permission_denied_with(
        PermissionDeniedData {
            permission,
            settings_url: url.to_owned(),
            app,
            relaunch_required: true,
        },
        message,
    )
}

#[cfg(test)]
#[path = "permissions/identity_tests.rs"]
mod identity_tests;

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use super::*;

    #[test]
    fn opens_each_permission_once_even_after_repeated_denials() {
        let settings = Settings::default();
        let opened = RefCell::new(Vec::new());
        let opener = |url: &str| { opened.borrow_mut().push(url.to_owned()); true };
        assert_eq!(settings.open_settings_once(TccPermission::ScreenRecording, opener), (true, true));
        assert_eq!(settings.open_settings_once(TccPermission::ScreenRecording, |_| panic!("retry")), (true, false));
        assert_eq!(settings.open_settings_once(TccPermission::Accessibility, opener), (true, true));
        assert_eq!(settings.open_settings_once(TccPermission::Accessibility, |_| panic!("retry")), (true, false));
        assert_eq!(*opened.borrow(), [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ]);
    }

    #[test]
    fn failed_open_is_not_retried_and_keeps_its_failure_state() {
        let settings = Settings::default();
        assert_eq!(settings.open_settings_once(TccPermission::Accessibility, |_| false), (false, true));
        assert_eq!(settings.open_settings_once(TccPermission::Accessibility, |_| panic!("retry")), (false, false));
    }

    #[test]
    fn absent_and_empty_host_names_use_the_launcher_phrase() {
        for value in [None, Some(String::new()), Some("  ".to_owned())] {
            assert_eq!(launcher_name(value), LAUNCHER);
        }
        assert_eq!(launcher_name(Some("QA App".to_owned())), "QA App");
        let error = denial(TccPermission::ScreenRecording, launcher_name(None), true, true);
        assert_eq!(error.permission.unwrap().app, LAUNCHER);
    }

    #[test]
    fn accessibility_error_carries_the_settings_contract() {
        let error = denial(TccPermission::Accessibility, "QA App".to_owned(), true, true);
        let data = error.permission.unwrap();
        assert_eq!(data.permission, TccPermission::Accessibility);
        assert_eq!(data.settings_url,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
        assert_eq!(data.app, "QA App");
        assert!(data.relaunch_required);
    }

    #[test]
    fn a_repeat_denial_does_not_reopen_the_settings_pane() {
        let settings = Settings::default();
        let opened = RefCell::new(0);
        drop(settings.permission_denied(TccPermission::ScreenRecording, |_| {
            *opened.borrow_mut() += 1;
            true
        }));
        drop(settings.permission_denied(TccPermission::ScreenRecording, |_| {
            panic!("repeat denial reopened Settings")
        }));
        assert_eq!(*opened.borrow(), 1);
    }

    #[test]
    fn a_repeat_denial_does_not_retry_a_failed_pane_opening() {
        let settings = Settings::default();
        let opened = RefCell::new(0);
        drop(settings.permission_denied(TccPermission::Accessibility, |_| {
            *opened.borrow_mut() += 1;
            false
        }));
        drop(settings.permission_denied(TccPermission::Accessibility, |_| {
            panic!("repeat denial retried Settings")
        }));
        assert_eq!(*opened.borrow(), 1);
    }
}
