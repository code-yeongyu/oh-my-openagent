//! A-IS-65 L3 and T11's pure leg: the Windows lock directory is admitted only with the
//! protected DACL of d-windows.md:308 (owner SID + SYSTEM, full control, protected), read back
//! as SDDL; an owner other than this user (or the token's default owner), an unprotected DACL,
//! a missing or extra entry, or a weaker right refuses. The hosted Windows legs read the real
//! descriptor of the runner's lock directory.

use super::dacl::admit_dacl;

const USER: &str = "S-1-5-21-1-2-3-1001";

fn protected(owner: &str) -> String {
    format!("O:{owner}D:P(A;OICI;FA;;;{USER})(A;OICI;FA;;;SY)")
}

#[test]
fn the_protected_dacl_of_the_user_and_system_is_admitted() {
    assert!(admit_dacl(&protected(USER), &[USER], USER).is_ok());
    let reordered = format!("O:{USER}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;{USER})");
    assert!(admit_dacl(&reordered, &[USER], USER).is_ok(), "{reordered}");
    let numeric = format!("O:{USER}D:P(A;OICI;0x1f01ff;;;{USER})(A;OICI;0x1f01ff;;;SY)");
    assert!(admit_dacl(&numeric, &[USER], USER).is_ok(), "{numeric}");
}

#[test]
fn the_token_default_owner_may_own_the_directory() {
    assert!(admit_dacl(&protected("BA"), &[USER, "BA"], USER).is_ok());
}

#[test]
fn a_directory_owned_by_another_principal_refuses() {
    let error = admit_dacl(&protected("S-1-5-21-9-9-9-500"), &[USER], USER).expect_err("owner");
    assert!(error.to_string().contains("owner"), "{error}");
}

#[test]
fn an_unprotected_dacl_refuses() {
    let inherited = format!("O:{USER}D:AI(A;OICI;FA;;;{USER})(A;OICI;FA;;;SY)");
    let error = admit_dacl(&inherited, &[USER], USER).expect_err("unprotected");
    assert!(error.to_string().contains("protected"), "{error}");
}

#[test]
fn a_missing_extra_or_weaker_entry_refuses() {
    for sddl in [
        format!("O:{USER}D:P(A;OICI;FA;;;{USER})"),
        format!("O:{USER}D:P(A;OICI;FA;;;{USER})(A;OICI;FA;;;SY)(A;OICI;FR;;;WD)"),
        format!("O:{USER}D:P(A;OICI;FA;;;{USER})(A;OICI;FA;;;SY)(D;OICI;FA;;;BG)"),
        format!("O:{USER}D:P(A;OICI;FR;;;{USER})(A;OICI;FA;;;SY)"),
        format!("O:{USER}D:P(A;OICI;FA;;;{USER})(A;OICI;FA;;;BA)"),
        format!("O:{USER}D:P"),
        format!("O:{USER}"),
        String::new(),
    ] {
        assert!(admit_dacl(&sddl, &[USER], USER).is_err(), "{sddl}");
    }
}
