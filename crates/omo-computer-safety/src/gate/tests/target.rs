//! The Target stage and the chord stage: the self set and the protected table refuse before
//! send, `force` included; `force` admits exactly the listed chords.

use omo_computer_core::backend::Refusal;

use super::super::verdicts::LeaseRefusal;
use super::super::{gate, Gate, PointTarget, Resolution, VerbKind};
use super::{at, exec, plain, self_set, tables, terminal, window};

fn refused(verb: VerbKind, targets: Vec<PointTarget>, force: bool) -> Option<(Gate, Refusal)> {
    let set_ = self_set();
    let mut facts = exec(verb);
    facts.force = force;
    gate(&facts, &tables(&set_), || targets)
        .err()
        .map(|r| (r.gate, r.refusal))
}

fn wire(refusal: &Refusal) -> (&'static str, Option<&'static str>) {
    (refusal.code.wire(), refusal.reason)
}

#[test]
fn self_target_is_refused() {
    for force in [false, true] {
        for verb in [VerbKind::Pointer, VerbKind::Keyboard] {
            let (gate_, refusal) =
                refused(verb, terminal(), force).expect("the terminal is in the self set");
            assert_eq!(gate_, Gate::Target);
            assert_eq!(
                wire(&refusal),
                ("ProtectedProcess", Some("self_target")),
                "{verb:?} force={force}"
            );
            assert_eq!(
                refusal.computer_code().map(|c| c.wire()),
                Ok("COMPUTER_SELF_TARGET")
            );
        }
        let (_, quit) = refused(VerbKind::AppsQuit, terminal(), force).expect("quit refused");
        assert_eq!(
            wire(&quit),
            ("ProtectedProcess", None),
            "apps.quit on the self set"
        );
    }
    assert_eq!(
        refused(VerbKind::Pointer, plain(), false),
        None,
        "another window is admitted"
    );
}

#[test]
fn unreadable_targets_fail_closed() {
    let unreadable = vec![PointTarget::new(None, Resolution::Unreadable)];
    let (_, pointer) = refused(VerbKind::Pointer, unreadable.clone(), false).expect("refused");
    assert_eq!(
        wire(&pointer),
        ("BackgroundUnavailable", Some("target_unknown"))
    );
    let (_, keyboard) = refused(VerbKind::Keyboard, unreadable, false).expect("refused");
    assert_eq!(
        wire(&keyboard),
        ("BackgroundUnavailable", Some("focus_unknown"))
    );
    let (_, none) = refused(VerbKind::Pointer, Vec::new(), false).expect("no target resolved");
    assert_eq!(
        wire(&none),
        ("BackgroundUnavailable", Some("target_unknown"))
    );
    let desktop = vec![at(1.0, 1.0, Resolution::Desktop)];
    assert_eq!(
        refused(VerbKind::Pointer, desktop, false),
        None,
        "the desktop itself is admitted"
    );
}

#[test]
fn dangerous_chord_requires_force() {
    let set_ = self_set();
    let mut facts = exec(VerbKind::Keyboard);
    facts.chord = Some("cmd+q".to_owned());
    let refusal = gate(&facts, &tables(&set_), plain).expect_err("cmd+q without force");
    assert_eq!(
        (refusal.gate, wire(&refusal.refusal)),
        (Gate::Consequential, ("InvalidKey", Some("dangerous_chord")))
    );
    facts.force = true;
    assert!(
        gate(&facts, &tables(&set_), plain).is_ok(),
        "force admits a listed chord"
    );
    let at_self =
        gate(&facts, &tables(&set_), terminal).expect_err("force never admits the self set");
    assert_eq!(
        wire(&at_self.refusal),
        ("ProtectedProcess", Some("self_target"))
    );
    facts.force = false;
    facts.chord = Some("cmd+c".to_owned());
    assert!(
        gate(&facts, &tables(&set_), plain).is_ok(),
        "an unlisted chord needs no force"
    );
}

#[test]
fn a_foreground_verb_without_the_grant_refuses_control_required() {
    let set_ = self_set();
    let mut facts = exec(VerbKind::Pointer);
    facts.lease = Some(LeaseRefusal::Grant);
    let refusal = gate(&facts, &tables(&set_), plain).expect_err("no grant");
    assert_eq!(
        (refusal.gate, wire(&refusal.refusal)),
        (Gate::Lease, ("ControlRequired", None))
    );
}

#[test]
fn a_denied_app_refuses_at_consent_unless_allowed() {
    let set_ = self_set();
    let facts = exec(VerbKind::Pointer);
    let manager = || vec![at(5.0, 5.0, window(77, "com.1password.1password"))];
    let refusal = gate(&facts, &tables(&set_), manager).expect_err("a password manager");
    assert_eq!(
        (refusal.gate, wire(&refusal.refusal)),
        (Gate::Consent, ("ControlRequired", Some("denied_app")))
    );
    let allowed = ["com.1password.1password".to_owned()];
    let mut allowing = tables(&set_);
    allowing.allowed_apps = &allowed;
    assert!(
        gate(&facts, &allowing, manager).is_ok(),
        "consent.apps.allow admits it"
    );
}
