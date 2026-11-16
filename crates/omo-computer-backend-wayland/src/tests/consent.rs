//! Until the owner rules on persisting restore tokens (D5, card X10), a Wayland hand asks its
//! user for input consent again after every engine lifecycle, and writes no token.

use omo_computer_core::capabilities::CompositorName;

use super::support::{key, send, Rig, US};
use crate::fake::Mode;

#[test]
fn wayland_input_consent_is_asked_again_after_an_engine_lifecycle() {
    let rig = Rig::new(US, Mode::Serve);
    let portal = rig.portal().issuing_restore_tokens(true);

    let mut first = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut first, &key("a", true)).and_then(|_| send(&mut first, &key("a", false))).is_ok());
    assert_eq!(portal.log().dialogs, 1, "the first input call opens the one combined session");
    assert!(send(&mut first, &key("b", true)).and_then(|_| send(&mut first, &key("b", false))).is_ok());
    assert_eq!(portal.log().dialogs, 1, "one dialog per lifecycle, not per call");
    drop(first);

    let mut second = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut second, &key("a", true)).and_then(|_| send(&mut second, &key("a", false))).is_ok());
    let seen = portal.log();
    assert_eq!(seen.dialogs, 2, "a new engine lifecycle asks again");
    assert_eq!(seen.restore_tokens_presented, 0, "no persisted token was presented");
    assert!(!rig.state_file().exists(), "the restore token is not written by default");
}
