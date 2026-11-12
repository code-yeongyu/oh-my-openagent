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

fn consent(view: serde_json::Value) -> Consent {
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
    assert_eq!(consent.admit_exec(Some(&unreadable)).map(|a| a.binding), Ok(Some(Binding::PathOnly)));
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
        ConsentView::from_host(json!({ "apps": { "allow": [{ "appKey": "1Password.exe" }] } })),
        LOCAL_HAND,
        Os::Windows,
    );
    assert!(allowed.admit_exec(Some(&app("1Password.exe", "aa"))).is_ok(), "unless explicitly allowed");
}
