use senpi_desktop_core::error::ErrorCode;

use super::*;

#[test]
fn recognizes_real_classes_and_rejects_lookalikes() {
    assert!(is_chromium_class("Chrome_WidgetWin_1"));
    assert!(!is_chromium_class("Chrome_WidgetWin_"));
    assert!(!is_chromium_class("ChromeWidgetWin_1"));

    assert!(is_winui3_class("WinUIDesktopWin32WindowClass"));
    assert!(!is_winui3_class("WinUIDesktopWin32WindowClass2"));

    assert!(is_wpf_class("HwndWrapper[App;;abc]"));
    assert!(!is_wpf_class("HwndWrapper[App;;abc"));
    assert!(!is_wpf_class("HwndWrapperApp;;abc]"));

    assert!(is_tk_class("TkTopLevel.1"));
    assert!(is_tk_class("TkTopLevel"));
    assert!(!is_tk_class("TkTopLevelish"));
    assert!(!is_tk_class("TkTopLevel."));

    assert!(is_gtk_class("gdkSurfaceToplevel"));
    assert!(is_gtk_class("gdkWindowToplevel"));
    assert!(!is_gtk_class("gdkSurfaceToplevelExtra"));
    assert!(!is_gtk_class("gdkWindowChild"));

    assert!(is_vcl_class("SALFRAME"));
    assert!(!is_vcl_class("SAL"));
    assert!(!is_vcl_class("XSALFRAME"));
}

fn assert_matrix(class: &str, expected: [bool; 6]) {
    let kinds = [
        EventKind::MouseClick,
        EventKind::MouseMove,
        EventKind::MouseScroll,
        EventKind::Keystroke,
        EventKind::KeyCombo,
        EventKind::TextInput,
    ];
    for (kind, expected) in kinds.into_iter().zip(expected) {
        assert_eq!(
            would_be_silently_dropped(class, kind).is_some(),
            expected,
            "unexpected {class}/{} delivery decision",
            kind.name(),
        );
    }
}

#[test]
fn covers_the_full_known_silent_drop_matrix() {
    assert_matrix("Chrome_WidgetWin_1", [true, true, true, true, true, true]);
    assert_matrix(
        "WinUIDesktopWin32WindowClass",
        [true, true, true, false, false, false],
    );
    assert_matrix("HwndWrapper[App;;abc]", [true, true, false, true, true, true]);
    assert_matrix("TkTopLevel.1", [false, false, false, true, true, true]);
    assert_matrix("gdkSurfaceToplevel", [true, false, false, false, false, false]);
    assert_matrix("gdkWindowToplevel", [true, false, false, false, false, false]);
    assert_matrix("SALFRAME", [false, false, false, true, true, false]);
    assert_matrix("Chrome_WidgetWin", [false, false, false, false, false, false]);
    assert_matrix("HwndWrapperApp;;abc]", [false, false, false, false, false, false]);
    assert_matrix("TkTopLevelish", [false, false, false, false, false, false]);
    assert_matrix(
        "gdkSurfaceToplevelExtra",
        [false, false, false, false, false, false],
    );
    assert_matrix("XSALFRAME", [false, false, false, false, false, false]);
}

#[test]
fn background_text_into_chromium_is_refused_naming_the_class() {
    // Given: a Chromium frame, which only reads the system input queue
    // When
    let refusal = background_refusal("4242", "Chrome_WidgetWin_1", EventKind::TextInput);
    // Then
    let error = refusal.expect("Chromium drops posted text");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(
        error.message.contains("(Chrome_WidgetWin_1)"),
        "{}",
        error.message
    );
    assert!(error.message.contains("text_input"), "{}", error.message);
}

#[test]
fn background_text_into_an_unlisted_class_is_posted() {
    assert!(background_refusal("4242", "SomeCustomClass", EventKind::TextInput).is_none());
}

#[test]
fn only_an_elevated_window_is_refused_as_permission_denied() {
    let refused = uipi_check("4242", Some(true)).map_err(|error| error.code);
    let examined = [uipi_check("4242", Some(false)), uipi_check("4242", None)];

    assert_eq!(refused, Err(ErrorCode::PermissionDenied));
    assert!(examined.iter().all(Result::is_ok), "{examined:?}");
}
