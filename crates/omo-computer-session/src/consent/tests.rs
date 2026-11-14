use omo_computer_core::listing::CodeIdentity;
use omo_computer_safety::gate::verdicts::ConsentRefusal;
use omo_computer_safety::protected::Os;
use serde_json::json;

use super::*;

fn app(key: &str, cdhash: &str) -> AppTarget {
    AppTarget {
        app_key: key.to_owned(),
        bound: BoundIdentity::new(
            None,
            Some(CodeIdentity {
                team_id: Some("TEAM123456".to_owned()),
                cdhash: Some(cdhash.to_owned()),
                signer: None,
                hash: None,
            }),
        ),
    }
}

/// A host view in the contract's shape: the member stopHotkey is always carried (R70ao(2)); a test
/// that does not name it gets null, "absent in the file".
fn consent(mut view: serde_json::Value) -> Consent {
    if let Some(map) = view.as_object_mut() {
        map.entry("stopHotkey").or_insert(serde_json::Value::Null);
    }
    Consent::new(ConsentView::from_host(view), LOCAL_HAND, Os::Macos)
}

fn refusal(result: Result<Admission, Denial>) -> Option<ConsentRefusal> {
    result.err().map(|denial| denial.refusal)
}

#[test]
fn denied_prompt_not_reasked_until_user_message() {
    let mut consent = consent(json!({ "scope": ["com.apple.TextEdit"] }));
    let notes = app("com.apple.Notes", "aa");
    assert_eq!(refusal(consent.admit_exec(Some(&notes))), Some(ConsentRefusal::AppScope));
    consent.record_denial(Part::AppScope, Some(&notes));
    assert_eq!(refusal(consent.admit_exec(Some(&notes))), Some(ConsentRefusal::DeniedThisTurn));
    let other = app("com.apple.Mail", "bb");
    assert_eq!(refusal(consent.admit_exec(Some(&other))), Some(ConsentRefusal::AppScope));
    consent.user_message();
    assert_eq!(refusal(consent.admit_exec(Some(&notes))), Some(ConsentRefusal::AppScope));
}

#[test]
fn app_scope_refuses_other_app_nothing_sent() {
    let consent = consent(json!({ "scope": ["com.apple.TextEdit"] }));
    let denial = consent.admit_exec(Some(&app("com.apple.Notes", "aa"))).expect_err("refused");
    assert_eq!(denial.refusal, ConsentRefusal::AppScope);
    assert_eq!(denial.detail, Some(json!({ "app": "com.apple.Notes" })));
    assert!(consent.admit_exec(Some(&app("com.apple.TextEdit", "aa"))).is_ok());
    assert!(consent.admit_exec(None).is_ok(), "a desktop call is not app-scoped");
}

#[test]
fn per_app_stop_narrows_scope_only() {
    let mut consent = consent(json!({}));
    let notes = app("com.apple.Notes", "aa");
    consent.stop_app(&notes);
    assert_eq!(refusal(consent.admit_exec(Some(&notes))), Some(ConsentRefusal::UserStopped));
    assert!(consent.admit_exec(Some(&app("com.apple.Mail", "bb"))).is_ok());
    assert!(consent.admit_exec(Some(&app("com.apple.Notes", "other-copy"))).is_ok(), "keyed on identity");
    consent.user_message();
    assert!(consent.admit_exec(Some(&notes)).is_ok());
}

#[test]
fn identity_changed_refuses_under_same_app_key() {
    let mut consent = consent(json!({ "apps": { "allow": [
        { "appKey": "com.example.app", "identity": { "teamId": "TEAM123456", "cdhash": "aa" } }
    ] } }));
    assert!(consent.admit_exec(Some(&app("com.example.app", "aa"))).is_ok());
    let copy = app("com.example.app", "bb");
    let denial = consent.admit_exec(Some(&copy)).expect_err("a different copy");
    assert_eq!(denial.refusal, ConsentRefusal::IdentityChanged);
    let detail = denial.detail.expect("detail");
    assert_eq!(detail["app"], json!("com.example.app"));
    assert_eq!(detail["identity"]["approved"]["identity"]["cdhash"], json!("aa"));
    assert_eq!(detail["identity"]["observed"]["identity"]["cdhash"], json!("bb"));
    consent.approve_app(&copy);
    assert!(consent.admit_exec(Some(&copy)).is_ok(), "the re-approval replaces the record");
    let unreadable = AppTarget {
        app_key: "com.example.app".to_owned(),
        bound: BoundIdentity::new(None, None),
    };
    // A-IS-61 (R70ah): an identity-bound entry never falls back to the path; an unreadable
    // identity refuses (this asserted a path-only admit before the amendment).
    assert_eq!(refusal(consent.admit_exec(Some(&unreadable))), Some(ConsentRefusal::IdentityChanged));
}

#[test]
fn consent_tampered_refuses_exec_reads_continue() {
    let consent = consent(json!({ "tampered": true }));
    assert_eq!(refusal(consent.admit_exec(None)), Some(ConsentRefusal::Tampered));
    assert!(consent.admit_read(Some(&app("com.apple.Notes", "aa"))).is_ok());
    let unparsable = consent_from_text("[1]");
    assert_eq!(refusal(unparsable.admit_exec(None)), Some(ConsentRefusal::Tampered));
}

fn consent_from_text(text: &str) -> Consent {
    consent(serde_json::from_str(text).expect("json"))
}

#[test]
fn stored_grant_without_a_hand_suffix_matches_the_local_hand_only() {
    let bare = vec!["computer:exec".to_owned()];
    assert!(covers(&bare, Tier::Exec, LOCAL_HAND));
    assert!(!covers(&bare, Tier::Exec, "hand-7"), "never widens to a remote hand");
    let suffixed = vec!["computer:exec@hand-7".to_owned()];
    assert!(covers(&suffixed, Tier::Exec, "hand-7"));
    assert!(!covers(&suffixed, Tier::Exec, "hand-8"));
    assert!(!covers(&suffixed, Tier::Exec, LOCAL_HAND));
    assert!(!covers(&bare, Tier::Read, LOCAL_HAND), "stored per tier, never widened");
    let remote = Consent::new(ConsentView::default(), "hand-7", Os::Macos);
    assert_eq!(refusal(remote.admit_exec(None)), Some(ConsentRefusal::TierMissing));
}

#[test]
fn denied_app_seeds_exist_per_os_in_the_scope_stage_keys() {
    let expected: [(Os, &[&str]); 3] = [
        (Os::Macos, &["com.1password.1password", "com.bitwarden.desktop", "org.keepassxc.keepassxc"]),
        (Os::Windows, &["1Password.exe", "Bitwarden.exe", "KeePassXC.exe", "KeePass.exe", "Dashlane.exe",
            "LastPass.exe", "NordPass.exe", "Proton Pass.exe", "control.exe:Microsoft.CredentialManager"]),
        (Os::Linux, &["1password", "Bitwarden", "keepassxc", "org.keepassxc.KeePassXC",
            "org.gnome.seahorse.Application", "kwalletmanager5"]),
    ];
    for (os, seeds) in expected {
        for seed in seeds {
            assert!(denied_app_seeds(os).iter().any(|s| s == seed), "{os:?} ships {seed}");
            let consent = Consent::new(ConsentView::default(), LOCAL_HAND, os);
            let target = app(seed, "aa");
            let denial = consent.admit_read(Some(&target)).expect_err("denied by default");
            assert_eq!(denial.refusal, ConsentRefusal::DeniedApp, "{os:?} {seed}");
        }
    }
    let allowed = Consent::new(
        ConsentView::from_host(json!({ "stopHotkey": null, "apps": { "allow": [
            { "appKey": "1Password.exe", "identity": { "teamId": "TEAM123456", "cdhash": "aa" } }
        ] } })),
        LOCAL_HAND,
        Os::Windows,
    );
    assert!(allowed.admit_exec(Some(&app("1Password.exe", "aa"))).is_ok(), "unless explicitly allowed, bound at grant");
    // A-IS-61: an allow entry with neither identity nor path is no grant, so it lifts no seed.
    let unbound = Consent::new(
        ConsentView::from_host(json!({ "stopHotkey": null, "apps": { "allow": [{ "appKey": "1Password.exe" }] } })),
        LOCAL_HAND,
        Os::Windows,
    );
    assert_eq!(refusal(unbound.admit_exec(Some(&app("1Password.exe", "aa")))), Some(ConsentRefusal::IdentityChanged));
}

/// R70ab (review M3 of #13346): an entry bound to its path alone is satisfied only by a path that
/// was READ and is equal. Equal: admitted path-only. Different: identity_changed. Unreadable
/// identity AND path against a stored path: identity_changed, never an admit.
#[test]
fn r70ab_a_path_bound_entry_needs_a_read_equal_path() {
    let consent = consent(json!({ "apps": { "allow": [{ "appKey": "com.example.app", "path": "/usr/bin/app" }] } }));
    let target = |path: Option<&str>| AppTarget {
        app_key: "com.example.app".to_owned(),
        bound: BoundIdentity::new(path.map(str::to_owned), None),
    };
    assert_eq!(consent.admit_exec(Some(&target(Some("/usr/bin/app")))).map(|a| a.binding), Ok(Some(Binding::PathOnly)));
    assert_eq!(refusal(consent.admit_exec(Some(&target(Some("/tmp/app"))))), Some(ConsentRefusal::IdentityChanged));
    let unread = consent.admit_exec(Some(&target(None))).expect_err("an unreadable path cannot satisfy a stored one");
    assert_eq!(unread.refusal, ConsentRefusal::IdentityChanged);
    let observed = &unread.detail.expect("detail")["identity"]["observed"];
    assert!(observed.get("path").is_none() && observed.get("identity").is_none(), "observed says both were unreadable: {observed}");
    // A-IS-61 supersedes R70ab's last case: an entry approved without path or identity is no grant.
    let pathless = self::consent(json!({ "apps": { "allow": [{ "appKey": "com.example.app" }] } }));
    assert_eq!(refusal(pathless.admit_exec(Some(&target(None)))), Some(ConsentRefusal::IdentityChanged));
}

/// A-IS-61 (R70ah): admission at use. An identity-bound entry admits only an identity read in full
/// and equal in every member, never falling back to the path; a path-bound entry admits only a read,
/// equal path; an entry with neither is no grant and refuses with approved "unbound".
#[test]
fn a_is_61_admission_at_use() {
    let id = |c: &str| Some(CodeIdentity { team_id: Some("T".into()), cdhash: Some(c.into()), signer: None, hash: None });
    let entry = |path: Option<&str>, ident| BoundIdentity::new(path.map(str::to_owned), ident);
    let refused = |approved: &BoundIdentity, observed: &BoundIdentity| approved.check(observed).is_err();
    // The five measured fail-open cases now refuse.
    assert!(refused(&entry(None, None), &entry(Some("/tmp/evil"), None)), "a1");
    assert!(refused(&entry(None, None), &entry(Some("/tmp/evil"), id("zz"))), "a2");
    assert!(refused(&entry(Some("/usr/bin/app"), id("aa")), &entry(Some("/usr/bin/app"), None)), "b1: never falls back to the path");
    assert!(refused(&entry(None, id("aa")), &entry(Some("/tmp/evil"), None)), "b2");
    assert!(refused(&entry(None, id("aa")), &entry(None, None)), "b3");
    // A partial identity is not read.
    let partial = Some(CodeIdentity { team_id: Some("T".into()), cdhash: None, signer: None, hash: None });
    assert!(refused(&entry(None, id("aa")), &entry(None, partial)), "partial identity");
    // What still admits.
    assert_eq!(entry(None, id("aa")).check(&entry(Some("/x"), id("aa"))).ok(), Some(Binding::Identity));
    assert_eq!(entry(Some("/usr/bin/app"), None).check(&entry(Some("/usr/bin/app"), id("zz"))).ok(), Some(Binding::PathOnly));
    // Unbound: approved "unbound", and the engine never binds it.
    let consent = consent(json!({ "apps": { "allow": [{ "appKey": "com.example.app" }] } }));
    let target = AppTarget { app_key: "com.example.app".to_owned(), bound: entry(Some("/usr/bin/app"), id("aa")) };
    let denial = consent.admit_exec(Some(&target)).expect_err("an unbound entry is no grant");
    assert_eq!(denial.refusal, ConsentRefusal::IdentityChanged);
    assert_eq!(denial.detail.expect("detail")["identity"]["approved"], json!("unbound"));
    assert!(consent.admit_exec(Some(&target)).is_err(), "still refused: never bound on first use");
}
