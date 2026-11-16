//! Until the owner rules on persisting restore tokens (D5, card X10), a Wayland hand asks its
//! user for input consent again after every engine lifecycle, and writes no token.

use std::os::unix::fs::PermissionsExt;

use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::EngineCode;

use super::support::{key, options, send, Rig, US};
use crate::fake::Mode;
use crate::{InputRoute, Options, WaylandBackend};

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
fn a_cancelled_consent_dialog_sticks_for_the_lifecycle_and_reads_permission_denied() {
    // Review M1 (#13909): only a user Cancel counts as denied (acceptance 31); it is reported
    // as its own refusal and never re-prompted inside a later input call.
    let rig = Rig::new(US, Mode::Serve);
    let portal = rig.portal();
    portal.cancel_dialogs(true);
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);

    let first = send(&mut backend, &key("a", true)).expect_err("the user cancelled the dialog");
    assert_eq!(
        first.code,
        EngineCode::PermissionDenied,
        "a typed consent refusal, not input_unsupported: {first:?}"
    );
    assert_eq!(first.wire_data()["permission"], "portal");
    let second = send(&mut backend, &key("b", true)).expect_err("the denial sticks");
    assert_eq!(
        (second.code, second.wire_data()),
        (first.code, first.wire_data()),
        "every later input call answers the same refusal"
    );
    let seen = portal.log();
    assert_eq!(
        seen.dialogs, 1,
        "a denial is never re-prompted inside an input call"
    );
    assert_eq!(seen.connects, 0, "no ConnectToEIS without consent");
    assert_eq!(rig.eis.log().connections, 0, "nothing reached libei");
    drop(backend);

    // Consent is asked once per engine lifecycle until D5: a new lifecycle asks again.
    portal.cancel_dialogs(false);
    let mut next = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut next, &key("a", true))
        .and_then(|_| send(&mut next, &key("a", false)))
        .is_ok());
    assert_eq!(portal.log().dialogs, 2, "the next lifecycle asks again");
}

#[test]
fn a_restore_token_is_never_written_into_a_state_file_others_can_read() {
    // Review L4 (#13909): the 0600 mode at creation does not apply to a file that already
    // exists, so a planted group/other-readable state file is refused, never written.
    let rig = Rig::new(US, Mode::Serve);
    let file = rig.state_file();
    std::fs::write(&file, "planted").expect("plant the state file");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).expect("chmod 0644");
    let portal = rig.portal().issuing_restore_tokens(true);
    let mut backend = WaylandBackend::new(Options {
        persist_consent: true,
        ..options(
            CompositorName::Mutter,
            InputRoute::Portal(Box::new(portal.client())),
            file.clone(),
        )
    });
    assert!(send(&mut backend, &key("a", true))
        .and_then(|_| send(&mut backend, &key("a", false)))
        .is_ok());
    assert_eq!(
        std::fs::read_to_string(&file).expect("read the state file"),
        "planted",
        "the token is not written into a file others can read"
    );
}
