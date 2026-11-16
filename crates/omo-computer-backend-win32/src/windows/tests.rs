use omo_computer_core::error::{EngineCode, Reason};

use super::{still_same, WindowIdentity};

#[test]
fn recycled_hwnd_is_identity_changed() {
    let saved = WindowIdentity { hwnd: 0x1234, pid: 10, process_start: 1_000 };
    assert!(still_same(saved, saved).is_ok());
    for now in [
        WindowIdentity { pid: 11, ..saved },
        WindowIdentity { process_start: 2_000, ..saved },
    ] {
        let refused = still_same(saved, now).expect_err("the handle was recycled");
        assert_eq!(refused.code, EngineCode::StaleRef);
        assert_eq!(refused.reason, Some(Reason::IdentityChanged.wire()));
    }
}
