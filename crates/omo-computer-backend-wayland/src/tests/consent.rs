//! Until the owner rules on persisting restore tokens (D5, card X10), a Wayland hand asks its
//! user for input consent again after every engine lifecycle, and writes no token.

use std::os::unix::fs::PermissionsExt;

use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::EngineCode;

use super::support::{key, send, Rig, US};
use crate::consent::Consent;
use crate::fake::Mode;

#[test]
fn wayland_input_consent_is_asked_again_after_an_engine_lifecycle() {
    let rig = Rig::new(US, Mode::Serve);
    let portal = rig.portal().issuing_restore_tokens(true);

    let mut first = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut first, &key("a", true))
        .and_then(|_| send(&mut first, &key("a", false)))
        .is_ok());
    assert_eq!(
        portal.log().dialogs,
        1,
        "the first input call opens the one combined session"
    );
    assert!(send(&mut first, &key("b", true))
        .and_then(|_| send(&mut first, &key("b", false)))
        .is_ok());
    assert_eq!(
        portal.log().dialogs,
        1,
        "one dialog per lifecycle, not per call"
    );
    drop(first);

    let mut second = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut second, &key("a", true))
        .and_then(|_| send(&mut second, &key("a", false)))
        .is_ok());
    let seen = portal.log();
    assert_eq!(seen.dialogs, 2, "a new engine lifecycle asks again");
    assert_eq!(
        seen.restore_tokens_presented, 0,
        "no persisted token was presented"
    );
    assert!(
        !rig.state_file().exists(),
        "the restore token is not written by default"
    );
}

#[test]
fn a_cancelled_consent_dialog_is_denied_and_not_asked_again_in_the_lifecycle() {
    let rig = Rig::new(US, Mode::Serve);
    let portal = rig.portal().cancelling_dialogs(true);
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);

    for call in 0..2 {
        let refused = send(&mut backend, &key("a", true)).expect_err("the user denied input");
        assert_eq!(
            (refused.code, refused.reason),
            (EngineCode::PermissionDenied, None),
            "call {call}: a cancel is a denial, not input_unsupported"
        );
    }
    let seen = portal.log();
    assert_eq!(seen.dialogs, 1, "one dialog per lifecycle, even after a cancel");
    assert_eq!(seen.connects, 0, "nothing reached ConnectToEIS");
    assert!(rig.eis.log().keys.is_empty(), "nothing was sent");
}

#[test]
fn a_kept_token_is_read_back_from_a_file_that_existed_with_a_loose_mode() {
    let rig = Rig::new(US, Mode::Serve);
    let file = rig.state_file();
    std::fs::write(&file, "old-token").expect("pre-create the state file");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).expect("chmod 0644");
    let consent = Consent::new(true, file.clone());

    consent.keep(Some("token-1"));

    assert_eq!(consent.token().as_deref(), Some("token-1"));
    let mode = std::fs::metadata(&file).expect("state file").permissions().mode();
    assert_eq!(mode & 0o777, 0o600, "the kept token is owner-only");
}
