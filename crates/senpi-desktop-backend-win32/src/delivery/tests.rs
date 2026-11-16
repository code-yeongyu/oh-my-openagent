use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::report::Disposition;

use super::*;
use crate::input::keys::{VK_CONTROL, VK_F1, VK_SHIFT};

const VK_K: u16 = 0x4B;

#[test]
fn recognizes_real_classes_and_rejects_lookalikes() {
    assert!(is_chromium_class("Chrome_WidgetWin_1"));
    assert!(is_chromium_class("CefBrowserWindow"));
    assert!(is_chromium_class("Chrome_RenderWidgetHostHWND"));
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
    assert!(is_gtk_class("gdkSurfaceToplevelExtra"));
    assert!(is_gtk_class("gdkWindowChild"));

    assert!(is_vcl_class("SALFRAME"));
    assert!(!is_vcl_class("SAL"));
    assert!(!is_vcl_class("XSALFRAME"));
}

#[test]
fn classifies_uwp_and_terminal_hosts() {
    assert!(is_uwp_frame_class("ApplicationFrameWindow"));
    assert!(is_uwp_frame_class("Windows.UI.Core.CoreWindow"));
    assert!(is_terminal_class("CASCADIA_HOSTING_WINDOW_CLASS"));
    assert!(is_terminal_class("ConsoleWindowClass"));
    assert!(is_terminal_class("mintty"));
}

fn assert_matrix(target: TargetTraits<'_>, expected: [bool; 6]) {
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
            would_be_silently_dropped(target, kind).is_some(),
            expected,
            "unexpected {target:?}/{} delivery decision",
            kind.name(),
        );
    }
}

const fn background(class: &str) -> TargetTraits<'_> {
    TargetTraits {
        class,
        chromium_descendant: false,
        foreground: false,
        xaml_host: false,
    }
}

#[test]
fn covers_the_full_known_silent_drop_matrix() {
    assert_matrix(background("Chrome_WidgetWin_1"), [true; 6]);
    assert_matrix(background("CefBrowserWindow"), [true; 6]);
    assert_matrix(background("Chrome_RenderWidgetHostHWND"), [true; 6]);
    assert_matrix(
        background("WinUIDesktopWin32WindowClass"),
        [true, true, true, false, false, false],
    );
    assert_matrix(background("HwndWrapper[App;;abc]"), [true, true, false, true, true, true]);
    assert_matrix(background("TkTopLevel.1"), [true, false, false, true, true, true]);
    assert_matrix(background("gdkSurfaceToplevel"), [true, false, false, false, false, false]);
    assert_matrix(background("gdkWindowToplevel"), [true, false, false, false, false, false]);
    assert_matrix(background("SALFRAME"), [false, false, false, true, true, false]);
    assert_matrix(background("Chrome_WidgetWin"), [false; 6]);
    assert_matrix(background("HwndWrapperApp;;abc]"), [false; 6]);
    assert_matrix(background("TkTopLevelish"), [false; 6]);
    assert_matrix(
        background("gdkSurfaceToplevelExtra"),
        [true, false, false, false, false, false],
    );
    assert_matrix(background("XSALFRAME"), [false; 6]);
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
fn a_posted_chord_holding_a_modifier_is_refused_with_nothing_sent() {
    // Given: ctrl+k as posted virtual keys; the target reads Ctrl from
    // GetKeyState, which a posted WM_KEYDOWN never sets (omo#13297)
    // When
    let refusal = posted_chord_refusal("4242", &[VK_CONTROL, VK_K]);
    // Then: refused before anything is posted, naming the modifier
    let error = refusal.expect("a posted ctrl+k arrives as a bare k");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("ctrl"), "{}", error.message);
    let report = error.report.expect("the refusal carries its report");
    assert_eq!(report.reason.as_deref(), Some("key_route_unproven"));
    assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
}

#[test]
fn a_layout_shifted_key_is_a_held_modifier_too() {
    // Given: `K` on a layout that needs Shift held for it
    let refusal = posted_chord_refusal("4242", &[VK_SHIFT, VK_K]);
    // Then
    assert_eq!(refusal.map(|error| error.code), Some(ErrorCode::BackgroundUnavailable));
}

#[test]
fn plain_keys_and_modifier_only_chords_still_post() {
    for vks in [&[VK_K][..], &[VK_F1 + 4], &[VK_CONTROL], &[VK_CONTROL, VK_SHIFT], &[VK_F1, VK_K]] {
        assert!(posted_chord_refusal("4242", vks).is_none(), "{vks:?}");
    }
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

#[test]
fn caption_and_sizing_regions_refuse_posted_drags() {
    assert_eq!(non_client_drag_region(2), Some("caption"));
    assert_eq!(non_client_drag_region(4), Some("size box"));
    for hit in 10..=17 {
        assert_eq!(non_client_drag_region(hit), Some("resize border"));
    }
    for hit in [-2, 0, 1, 3, 8, 18, 20] {
        assert_eq!(non_client_drag_region(hit), None);
    }
}

#[test]
fn double_click_messages_follow_class_style_and_press_parity() {
    let presses = |wants_double| (0..4).map(move |index| posts_double_click(index, wants_double));
    assert!(presses(true).eq([false, true, false, true]));
    assert!(presses(false).eq([false; 4]));
}

#[test]
fn every_line_break_style_becomes_exactly_one_return() {
    use TextUnit::{Char, Enter};

    assert_eq!(
        text_units("a\r\nb\nc\rd").collect::<Vec<_>>(),
        [
            Char('a'),
            Enter,
            Char('b'),
            Enter,
            Char('c'),
            Enter,
            Char('d')
        ]
    );
    assert_eq!(text_units("\r\r\n\n").collect::<Vec<_>>(), [Enter, Enter, Enter]);
}
