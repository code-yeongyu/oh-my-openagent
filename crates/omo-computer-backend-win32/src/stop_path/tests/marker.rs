//! The stop marker and resume token are owner-only (d-windows.md '## Identity and permissions',
//! Per-user resources; acceptance 29): a protected DACL granting the user SID and SYSTEM only.

use crate::marker_acl::{is_owner_only, owner_only_sddl};

const USER: &str = "S-1-5-21-1-2-3-1001";

#[test]
fn marker_acl_is_owner_only() {
    let sddl = owner_only_sddl(USER);
    assert_eq!(sddl, "D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)");
    assert!(is_owner_only(&sddl, &[USER]));
    // Inherited (not protected), a third trustee, or a deny-free Everyone grant all fail.
    assert!(!is_owner_only("D:(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)", &[USER]));
    assert!(!is_owner_only("D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)(A;;FR;;;WD)", &[USER]));
    assert!(!is_owner_only("D:P(A;;FA;;;S-1-5-21-9-9-9-1001)", &[USER]));
    assert!(!is_owner_only("D:P", &[USER]), "an empty DACL locks the owner out too");
}

/// D8: the user's spellings are its SID and row 17's `canonical_sid` of it. On this machine the
/// RID-500 administrator reads back as `LA` and RID-501 as `LG` (one test per alias).
#[test]
fn marker_acl_read_back_accepts_the_canonical_alias_of_the_users_own_sid() {
    let admin = "S-1-5-21-1-2-3-500";
    assert!(is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", &[admin, "LA"]), "LA");
    assert!(is_owner_only("D:P(A;;FA;;;LG)(A;;FA;;;SY)", &["S-1-5-21-1-2-3-501", "LG"]), "LG");
    assert!(!is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", &[USER, USER]), "LA is not a RID-1001 user");
    assert!(
        !is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;S-1-5-21-1-2-3-500)(A;;FA;;;SY)(A;;FA;;;WD)", &[admin, "LA"]),
        "a third trustee still fails"
    );
}

/// A domain RID-500/501 user's canonical spelling is its full SID (the alias names only this
/// machine's account), so a DACL granting `LA`/`LG` is another principal's.
#[test]
fn marker_acl_alias_is_the_local_machines_account_only() {
    let domain_admin = "S-1-5-21-7-7-7-500";
    assert!(!is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", &[domain_admin, domain_admin]), "LA");
    let domain_guest = "S-1-5-21-7-7-7-501";
    assert!(!is_owner_only("D:P(A;;FA;;;LG)(A;;FA;;;SY)", &[domain_guest, domain_guest]), "LG");
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
