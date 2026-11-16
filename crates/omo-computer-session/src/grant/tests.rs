use omo_computer_core::methods::{Exposure, Method, METHODS};
use omo_computer_safety::gate::verdicts::LeaseRefusal;
use serde_json::json;

use super::*;
use crate::consent::ConsentView;

#[test]
fn full_access_implies_grant_for_eight_methods_only() {
    let implied: Vec<Method> = METHODS
        .iter()
        .map(|spec| spec.method)
        .filter(|method| implied_by_full_access(*method, Some("desktop"), LOCAL_HAND))
        .collect();
    assert_eq!(implied, GLOBAL_INPUT.to_vec());
    for method in GLOBAL_INPUT {
        assert!(implied_by_full_access(method, Some("display:2"), LOCAL_HAND));
        assert!(implied_by_full_access(method, Some("DeskTop"), LOCAL_HAND));
        assert!(!implied_by_full_access(method, Some("101"), LOCAL_HAND), "a window target stays background");
        assert!(!implied_by_full_access(method, Some("desktop"), "hand-2"), "never a remote hand");
    }
    let full = ConsentView::from_host(json!({ "fullAccess": true }));
    let none = ForegroundGrant::default();
    assert_eq!(none.admit(&full, (Method::Click, Some("desktop")), LOCAL_HAND), Ok(GrantKind::ImpliedFullAccess));
    assert_eq!(none.admit(&full, (Method::AppsOpen, Some("desktop")), LOCAL_HAND), Err(LeaseRefusal::Grant));
    let left = ConsentView::default();
    assert_eq!(
        none.admit(&left, (Method::Click, Some("desktop")), LOCAL_HAND),
        Err(LeaseRefusal::Grant),
        "leaving full access revokes the implied grant"
    );
}

#[test]
fn a_human_grant_dies_with_its_stop_epoch_and_never_reaches_a_remote_hand() {
    let view = ConsentView::default();
    let mut grant = ForegroundGrant::default();
    grant.grant(Some("confirm-1".to_owned()), 0);
    assert!(matches!(grant.admit(&view, (Method::Click, None), LOCAL_HAND), Ok(GrantKind::Human { .. })));
    assert_eq!(grant.admit(&view, (Method::Click, None), "hand-2"), Err(LeaseRefusal::HeadlessHost));
    let never = ConsentView::from_host(json!({ "foreground": "never" }));
    assert_eq!(grant.admit(&never, (Method::Click, None), LOCAL_HAND), Err(LeaseRefusal::Foreground));
    grant.reconcile(1);
    assert!(!grant.is_held(), "any stop revokes; resume never restores");
}

#[test]
fn display_release_verbs_are_not_model_callable() {
    let host_only = [
        Method::DisplayRelease,
        Method::DisplayResume,
        Method::ControlGrant,
        Method::ControlRevoke,
        Method::ControlAcquire,
        Method::ControlRelease,
        Method::PreviewSubscribe,
    ];
    for method in host_only {
        assert!(
            !matches!(method.spec().exposure, Exposure::Public),
            "{} must not be in a bridge or relay catalog",
            method.spec().name
        );
    }
}
