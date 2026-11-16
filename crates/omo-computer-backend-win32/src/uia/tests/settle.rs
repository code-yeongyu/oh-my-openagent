use omo_computer_core::backend::SettleSource;
use omo_computer_core::error::{EngineCode, Reason};

use super::fake::FakeUia;
use crate::uia::counters::{ChangeKind, UiaSettle};
use crate::uia::element::Toast;

fn settle(source: FakeUia) -> UiaSettle<FakeUia> {
    UiaSettle::new(source)
}

#[test]
fn change_counter_drives_settle() {
    let mut settle = settle(FakeUia::winforms());
    let counters = settle.counters();
    assert_eq!(settle.wait_event(0).expect("observer alive"), None, "nothing changed: quiet at the deadline");
    counters.record("4660", ChangeKind::Structure);
    counters.record("4660", ChangeKind::Property);
    assert_eq!(counters.count("4660"), 2, "every event advances the window's counter");
    let first = settle.wait_event(0).expect("observer alive").expect("an event");
    assert_eq!((first.kind.as_str(), first.window.as_str()), ("structure_changed", "4660"));
    let second = settle.wait_event(0).expect("observer alive").expect("an event");
    assert_eq!(second.kind, "property_changed");
    assert_eq!(settle.wait_event(0).expect("observer alive"), None);
}

#[test]
fn loading_reports_unsupported() {
    let mut settle = settle(FakeUia::winforms());
    let refused = settle.busy("4660").expect_err("no probe-ledger row defines a Windows loading predicate (A4)");
    assert_eq!(refused.code, EngineCode::Internal);
    assert_eq!(refused.reason, Some(Reason::SurfaceUnsupported));
}

#[test]
fn uia_toast_fingerprint_and_unavailable_without_the_shell() {
    let mut shell = FakeUia::winforms();
    shell.clock_ms = 900;
    shell.toasts = Some(vec![Toast {
        app: "Mail".to_owned(),
        title: "New message".to_owned(),
        body: "the body text".to_owned(),
    }]);
    let listed = settle(shell).notifications().expect("the shell lists toasts");
    assert_eq!(listed.len(), 1);
    assert_eq!((listed[0].app.as_str(), listed[0].title.as_str()), ("Mail", "New message"));
    assert_ne!(listed[0].body_hash, "the body text", "the body is kept only as a hash");
    assert_eq!(listed[0].body_hash.len(), 16);
    assert_eq!(listed[0].arrived_at_ms, 900);
    let refused = settle(FakeUia::winforms()).notifications().expect_err("no ShellExperienceHost");
    assert_eq!(refused.reason, Some(Reason::NoNotificationSurface));
}
