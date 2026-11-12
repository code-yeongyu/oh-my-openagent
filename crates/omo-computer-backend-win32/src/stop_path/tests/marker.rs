//! The stop marker and resume token are owner-only (d-windows.md '## Identity and permissions',
//! Per-user resources; acceptance 29): a protected DACL granting the user SID and SYSTEM only.

use crate::marker_acl::{is_owner_only, owner_only_sddl};

const USER: &str = "S-1-5-21-1-2-3-1001";

#[test]
fn marker_acl_is_owner_only() {
    let sddl = owner_only_sddl(USER);
    assert_eq!(sddl, "D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)");
    assert!(is_owner_only(&sddl, USER));
    // Inherited (not protected), a third trustee, or a deny-free Everyone grant all fail.
    assert!(!is_owner_only("D:(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)", USER));
    assert!(!is_owner_only("D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)(A;;FR;;;WD)", USER));
    assert!(!is_owner_only("D:P(A;;FA;;;S-1-5-21-9-9-9-1001)", USER));
    assert!(!is_owner_only("D:P", USER), "an empty DACL locks the owner out too");
}

#[cfg(windows)]
#[test]
fn marker_acl_applies_and_reads_back_owner_only_on_a_real_file() {
    let dir = std::env::temp_dir().join(format!("omo-cu-marker-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let marker = dir.join("global-stop");
    std::fs::write(&marker, b"x").expect("marker");
    crate::marker_acl::apply_owner_only(&marker).expect("apply");
    assert!(crate::marker_acl::read_back_owner_only(&marker).expect("read back"));
    std::fs::remove_dir_all(&dir).expect("cleanup");
}
