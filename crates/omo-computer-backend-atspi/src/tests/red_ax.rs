//! RED-first behaviour of the tree, refs, actions and focus (AC-89, L8, GAP-7).

use omo_computer_core::backend::{Delivered, Semantic};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::BusyIndicator;

use super::{gedit, observe, ref_of, GEDIT_XID};
use crate::bus::States;
use crate::fake::{extents, FakeBus};
use crate::owner::NativeWindow;
use crate::types::Detail;
use crate::AtspiBackend;

#[test]
fn focus_is_event_driven() {
    let mut fx = gedit();
    let button = fx.bus.node(&fx.frame, "push button", "OK");
    fx.bus.set_states(&button, States { focused: true, enabled: true, ..States::default() });
    fx.bus.push_event(0, "object:state-changed:focused", &button);
    let (mut backend, handle) = fx.backend();
    let before = handle.counts();

    let focused = backend.focused().expect("focus read");

    let after = handle.counts();
    assert_eq!(focused, Some(button));
    assert_eq!(after.applications, before.applications, "no registry walk");
    assert_eq!(after.children, before.children, "no descent into any tree");
    assert_eq!(after.reads - before.reads, 1, "the event's sender is verified once");
}

#[test]
fn press_resolves_to_activate_when_only_activate_exists() {
    let mut fx = gedit();
    let ok = fx.bus.node(&fx.frame, "push button", "OK");
    fx.bus.set_actions(&ok, &["activate"]);
    let both = fx.bus.node(&fx.frame, "push button", "Both");
    fx.bus.set_actions(&both, &["click", "activate"]);
    let (mut backend, handle) = fx.backend();
    let tree = observe(&mut backend, GEDIT_XID).expect("observe").snapshot.tree;
    let press = Semantic("press".to_owned());

    let delivered = backend.perform_detailed(&ref_of(&tree, "OK"), &press).expect("press");
    let ambiguous = backend.perform_detailed(&ref_of(&tree, "Both"), &press).expect_err("two rungs");

    assert_eq!(delivered, Delivered { count: 1, of: 1 });
    assert_eq!(handle.performed(), vec![(ok, 0)], "activate is index 0, Both never acted");
    assert_eq!(ambiguous.code(), EngineCode::AmbiguousTarget);
    let candidates = vec!["click".to_owned(), "activate".to_owned()];
    assert_eq!(ambiguous.detail, Some(Detail::AmbiguousAction { candidates }));
}

#[test]
fn no_action_role_is_typed_refusal() {
    let mut fx = gedit();
    fx.bus.node(&fx.frame, "image", "Logo");
    let (mut backend, handle) = fx.backend();
    let tree = observe(&mut backend, GEDIT_XID).expect("observe").snapshot.tree;
    let before = handle.counts();

    let refused = backend
        .perform_detailed(&ref_of(&tree, "Logo"), &Semantic("press".to_owned()))
        .expect_err("an image has no action");

    assert_eq!(refused.refusal.code, EngineCode::AxUnsupported);
    assert_eq!(refused.refusal.reason, None);
    let detail = Detail::NoAction { role: "image".to_owned(), actions: Vec::new() };
    assert_eq!(refused.detail, Some(detail));
    assert_eq!(handle.counts().calls, before.calls, "refused before any bus call");
}

#[test]
fn twin_title_windows_are_ambiguous() {
    let (mut bus, handle) = FakeBus::new();
    let app = bus.app(77, "report-viewer");
    for _ in 0..2 {
        let frame = bus.node(&app, "frame", "Report");
        bus.set_extents(&frame, extents(0, 0, 0, 0));
    }
    let window = |id: &str, x| NativeWindow {
        id: id.to_owned(),
        pid: Some(77),
        app: "report-viewer".to_owned(),
        title: "Report".to_owned(),
        bounds: extents(x, 10, 500, 400),
    };
    let windows = vec![window("0x1", 10), window("0x2", 600)];
    let mut backend = AtspiBackend::new(Some(bus), Box::new(windows));
    let _ = handle;

    let refused = observe(&mut backend, "0x1").expect_err("two frames fit the window");

    assert_eq!(refused.refusal.code, EngineCode::InvalidTarget);
    assert_eq!(refused.refusal.reason, Some("ambiguous"));
    let candidates = vec!["0x1".to_owned(), "0x2".to_owned()];
    assert_eq!(refused.detail, Some(Detail::AmbiguousWindow { candidates }));
}

#[test]
fn busy_state_reports_loading() {
    let mut fx = gedit();
    let frame = fx.frame.clone();
    fx.bus.set_states(&frame, States { busy: true, enabled: true, ..States::default() });
    let (mut backend, _) = fx.backend();
    let mut idle = gedit().backend().0;

    assert_eq!(backend.busy(GEDIT_XID), Some(BusyIndicator::AxBusy));
    assert_eq!(idle.busy(GEDIT_XID), None);
}

#[test]
fn linux_app_not_on_bus_is_refused_typed_with_zero_bus_calls() {
    let mut fx = gedit();
    fx.windows.push(NativeWindow {
        id: "0x9000001".to_owned(),
        pid: Some(31337),
        app: "slack".to_owned(),
        title: "Slack".to_owned(),
        bounds: extents(0, 0, 1200, 900),
    });
    let (mut backend, handle) = fx.backend();
    let before = handle.counts();

    let refused = observe(&mut backend, "0x9000001").expect_err("slack is not on the bus");

    assert_eq!(refused.refusal.code, EngineCode::AxUnsupported);
    assert_eq!(refused.refusal.reason, Some("not_on_bus"));
    assert!(matches!(refused.detail, Some(Detail::NotOnBus { ref app, .. }) if app == "slack"));
    assert_eq!(handle.counts().calls, before.calls, "zero bus calls to the absent app");
}
