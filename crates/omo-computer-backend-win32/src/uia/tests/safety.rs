//! `ensure_pattern_safe`: XAML hosts, Chromium and WPF call `SetForegroundWindow(self)` from their
//! patterns, so an action on one of them off the foreground is refused before any call; Chromium is
//! excluded from `invoke_at_point` because its `Invoke` reports success without acting.

use omo_computer_core::error::{EngineCode, Reason};

use crate::uia::safety::{ensure_pattern_safe, host_of, invoke_at_point_allowed, Host};

#[test]
fn hosts_are_classified_from_the_shipped_lists() {
    assert_eq!(host_of("ApplicationFrameWindow", "calc.exe"), Host::Xaml);
    assert_eq!(host_of("WinUIDesktopWin32WindowClass", "x.exe"), Host::Xaml);
    assert_eq!(host_of("Windows.UI.Core.CoreWindow", "x.exe"), Host::Xaml);
    assert_eq!(
        host_of("Microsoft.UI.Content.DesktopChildSiteBridge", "x.exe"),
        Host::Xaml
    );
    assert_eq!(host_of("Chrome_WidgetWin_1", "msedge.exe"), Host::Chromium);
    assert_eq!(host_of("HwndWrapper[App;;1a2b]", "app.exe"), Host::Wpf);
    assert_eq!(host_of("Notepad", "notepad.exe"), Host::Other);
    assert_eq!(
        host_of("WindowsForms10.Window.8.app.0.1", "app.exe"),
        Host::Other
    );
}

#[test]
fn self_activating_hosts_refuse_off_the_foreground_and_admit_on_it() {
    for host in [Host::Xaml, Host::Chromium, Host::Wpf] {
        let refusal =
            ensure_pattern_safe(host, false).expect_err("refused before any pattern call");
        assert_eq!(refusal.code, EngineCode::BackgroundUnavailable);
        assert_eq!(refusal.reason, Some(Reason::ProviderSelfActivates.wire()));
        assert!(
            ensure_pattern_safe(host, true).is_ok(),
            "{host:?} on the foreground"
        );
    }
    assert!(
        ensure_pattern_safe(Host::Other, false).is_ok(),
        "Win32 and WinForms providers do not self-activate"
    );
}

#[test]
fn chromium_is_excluded_from_invoke_at_point() {
    assert!(!invoke_at_point_allowed(Host::Chromium));
    for host in [Host::Xaml, Host::Wpf, Host::Other] {
        assert!(invoke_at_point_allowed(host), "{host:?}");
    }
}
