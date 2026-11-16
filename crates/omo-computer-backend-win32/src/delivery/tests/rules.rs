use omo_computer_core::error::{EngineCode, Reason};

use crate::barrier::{evidence, Barrier};
use crate::delivery::family::{admit, admit_in, family_of, Family, NextDelivery, Verb};
use crate::delivery::integrity;
use crate::delivery::observation::{judge_events, Effect, EvidenceKind};
use crate::route::{ladder, Call, Rung};

#[test]
fn chromium_family_is_refused_with_foreground_next_call() {
    for class in [
        "Chrome_WidgetWin_1",
        "Chrome_WidgetWin_0",
        "CefBrowserWindow",
        "Chrome_RenderWidgetHostHWND",
    ] {
        assert_eq!(family_of(class), Family::Chromium, "{class}");
        for verb in [Verb::LeftClick, Verb::RightClick, Verb::Text, Verb::Key] {
            let refused =
                admit(Family::Chromium, verb).expect_err("Chromium reads only the system queue");
            assert_eq!(refused.refusal.code, EngineCode::BackgroundUnavailable);
            assert_eq!(refused.next, NextDelivery::Foreground);
        }
    }
    for lookalike in ["ChromeLikeWidgetWin", "Widget_Chrome_Host"] {
        assert_eq!(
            family_of(lookalike),
            Family::Unknown,
            "a lookalike is not a member: {lookalike}"
        );
    }
    assert!(admit(Family::Classic, Verb::Text).is_ok());
}

#[test]
fn a_cell_the_spike_did_not_measure_refuses_every_background_verb() {
    assert_eq!(family_of("Edit"), Family::Classic, "the measured cell");
    let rich_edit = family_of("RichEditD2DPT");
    assert_ne!(rich_edit, Family::Classic, "not the measured classic Edit");
    for verb in Verb::ALL {
        let refused = admit(rich_edit, verb).expect_err("unmeasured: refused until row 69");
        assert_eq!(refused.refusal.code, EngineCode::BackgroundUnavailable);
        assert_eq!(refused.next, NextDelivery::Foreground);
    }
    assert!(admit(family_of("Edit"), Verb::Text).is_ok());
}

#[test]
fn a_class_with_no_matrix_row_refuses_every_background_verb() {
    for class in [
        "RICHEDIT50W",
        "Scintilla",
        "WindowsForms10.BUTTON.app.0.1",
        "ChromeLikeWidgetWin",
    ] {
        let family = family_of(class);
        for verb in Verb::ALL {
            let refused = admit(family, verb).expect_err("no measured cell: refused");
            assert_eq!(
                refused.refusal.code,
                EngineCode::BackgroundUnavailable,
                "{class} {verb:?}"
            );
            assert_eq!(refused.next, NextDelivery::Foreground);
        }
    }
}

#[test]
fn a_matrix_that_fails_to_load_refuses_every_verb_as_route_table_invalid() {
    for verb in Verb::ALL {
        let refused = admit_in(None, Family::Classic, verb).expect_err("fail closed");
        assert_eq!(
            (refused.refusal.code, refused.refusal.reason),
            (EngineCode::Internal, Some(Reason::RouteTableInvalid)),
            "{verb:?}"
        );
        assert_eq!(refused.next, NextDelivery::Foreground);
    }
}

#[test]
fn barrier_consumed_is_delivery_not_effect() {
    let consumed = evidence(Barrier::Consumed).expect("consumed is evidence");
    assert_eq!(consumed.kind, "barrier_consumed");
    assert!(!consumed.confirms_effect, "delivery evidence only");
    assert_eq!(evidence(Barrier::Pending), None);
}

#[test]
fn uipi_higher_integrity_target_is_permission_denied() {
    let refused =
        integrity::admit(0x3000, 0x2000).expect_err("a high-integrity target drops posts");
    assert_eq!(refused.code, EngineCode::PermissionDenied);
    assert!(integrity::admit(0x2000, 0x2000).is_ok());
    assert!(integrity::admit(0x1000, 0x2000).is_ok());
}

fn call(family: Family, verb: Verb) -> Call {
    Call {
        family,
        verb,
        pattern_safe: false,
        classic_message: false,
        foreground_granted: false,
    }
}

#[test]
fn posted_click_falls_back_to_uia_invoke() {
    assert_eq!(
        ladder(call(Family::Wpf, Verb::LeftClick)),
        Rung::InvokeAtPoint,
        "a dropped plain left click"
    );
    assert_eq!(
        ladder(call(Family::Chromium, Verb::LeftClick)),
        Rung::Refused,
        "Chromium's Invoke acts on nothing"
    );
    assert_eq!(
        ladder(call(Family::Wpf, Verb::RightClick)),
        Rung::Refused,
        "only a plain left click"
    );
}

#[test]
fn windows_route_ladder_matches_the_class_and_uses_one_route_per_call() {
    let safe = Call {
        pattern_safe: true,
        ..call(Family::Wpf, Verb::Text)
    };
    assert_eq!(ladder(safe), Rung::UiaPattern);
    let classic = Call {
        classic_message: true,
        ..call(Family::Classic, Verb::Text)
    };
    assert_eq!(ladder(classic), Rung::ClassicMessage);
    assert_eq!(ladder(call(Family::Classic, Verb::Text)), Rung::Posted);
    let granted = Call {
        foreground_granted: true,
        ..call(Family::Chromium, Verb::Text)
    };
    assert_eq!(
        ladder(granted),
        Rung::Foreground,
        "only when the grant allows it"
    );
    assert_eq!(
        ladder(call(Family::Chromium, Verb::Text)),
        Rung::Refused,
        "never a silent fallback"
    );
}

#[test]
fn window_opened_alone_reads_observed_with_an_ax_notification_observation_never_confirmed() {
    assert_eq!(
        judge_events(1),
        (Effect::Observed, EvidenceKind::AxNotification)
    );
    assert_eq!(judge_events(0), (Effect::Unverifiable, EvidenceKind::None));
}
