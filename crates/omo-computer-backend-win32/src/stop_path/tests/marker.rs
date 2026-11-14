//! The stop marker and resume token are owner-only (d-windows.md '## Identity and permissions',
//! Per-user resources; acceptance 29): a protected DACL granting the user SID and SYSTEM only.

use crate::marker_acl::{is_owner_only, owner_only_sddl};

const USER: &str = "S-1-5-21-1-2-3-1001";

/// This machine's account domain is S-1-5-21-1-2-3: `LA` and `LG` are its RID-500 and RID-501.
fn local(alias: &str) -> Option<String> {
    match alias {
        "LA" => Some("S-1-5-21-1-2-3-500".to_owned()),
        "LG" => Some("S-1-5-21-1-2-3-501".to_owned()),
        _ => None,
    }
}

#[test]
fn marker_acl_is_owner_only() {
    let sddl = owner_only_sddl(USER);
    assert_eq!(sddl, "D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)");
    assert!(is_owner_only(&sddl, USER, &local));
    // Inherited (not protected), a third trustee, or a deny-free Everyone grant all fail.
    assert!(!is_owner_only(
        "D:(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)",
        USER,
        &local
    ));
    assert!(!is_owner_only(
        "D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)(A;;FR;;;WD)",
        USER,
        &local
    ));
    assert!(!is_owner_only("D:P(A;;FA;;;S-1-5-21-9-9-9-1001)", USER, &local));
    assert!(
        !is_owner_only("D:P", USER, &local),
        "an empty DACL locks the owner out too"
    );
}

/// Review L2 (#13350): SDDL read-back writes well-known account SIDs as aliases ("LA" for the
/// RID-500 local administrator, "LG" for RID-501), so the user's own ACE may read back as an alias.
#[test]
fn marker_acl_read_back_accepts_the_alias_of_the_users_own_sid() {
    let admin = "S-1-5-21-1-2-3-500";
    assert!(is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", admin, &local));
    assert!(is_owner_only(
        "D:P(A;;FA;;;LG)(A;;FA;;;SY)",
        "S-1-5-21-1-2-3-501",
        &local
    ));
    assert!(
        !is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", USER, &local),
        "LA is not a RID-1001 user"
    );
    assert!(
        !is_owner_only(
            "D:P(A;;FA;;;LA)(A;;FA;;;S-1-5-21-1-2-3-500)(A;;FA;;;SY)(A;;FA;;;WD)",
            admin,
            &local
        ),
        "a third trustee still fails"
    );
}

/// Review L2 of the #13350 delta: `LA`/`LG` name THIS machine's RID-500/501 accounts, so a domain
/// RID-500 user does not own a DACL that grants the local Administrator, and an alias the OS
/// cannot resolve is nobody.
#[test]
fn marker_acl_alias_is_the_local_machines_account_only() {
    let domain_admin = "S-1-5-21-7-7-7-500";
    assert!(
        !is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", domain_admin, &local),
        "the local Administrator is another principal"
    );
    assert!(!is_owner_only(
        "D:P(A;;FA;;;LG)(A;;FA;;;SY)",
        "S-1-5-21-7-7-7-501",
        &local
    ));
    assert!(
        !is_owner_only("D:P(A;;FA;;;LA)(A;;FA;;;SY)", "S-1-5-21-1-2-3-500", &|_| None),
        "an alias the OS cannot resolve is not the user"
    );
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
