//! The protected DACL of the Windows lock directory (A-IS-65 L3; d-windows.md:308): owned by
//! this user (or the token's default owner, which an elevated token sets for what it creates),
//! a PROTECTED DACL with exactly two allow entries, full control for the user and for SYSTEM.
//! The check reads the descriptor back as SDDL text, so it is pure and tested on every OS;
//! the Windows calls that create, apply and read it are in `dir`.

use std::io;

const SYSTEM: [&str; 2] = ["SY", "S-1-5-18"];

fn refused(why: String) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("the lock directory is not protected as A-IS-65 L3 requires: {why}"),
    )
}

/// Full control, written as the alias or as the access mask.
fn full_control(rights: &str) -> bool {
    rights == "FA" || rights.eq_ignore_ascii_case("0x1f01ff")
}

/// The owner SID (or alias) of the descriptor `sddl`, as read back.
pub(crate) fn owner(sddl: &str) -> Option<&str> {
    let rest = sddl.strip_prefix("O:")?;
    let end = ["D:", "G:"]
        .iter()
        .filter_map(|part| rest.find(part))
        .min()
        .unwrap_or(rest.len());
    Some(&rest[..end]).filter(|owner| !owner.is_empty())
}

/// Admits the descriptor `sddl` (owner and DACL, as read back): its owner is one of `owners`
/// and its DACL is protected with exactly `(allow, full control)` for `user` and for SYSTEM.
///
/// # Errors
/// Anything else, naming what was read.
pub(crate) fn admit_dacl(sddl: &str, owners: &[&str], user: &str) -> io::Result<()> {
    let owner = owner(sddl).ok_or_else(|| refused(format!("no owner in {sddl:?}")))?;
    let (_, dacl) = sddl
        .split_once("D:")
        .ok_or_else(|| refused(format!("no DACL in {sddl:?}")))?;
    if !owners.contains(&owner) {
        return Err(refused(format!("its owner is {owner}")));
    }
    let (flags, entries) = dacl
        .split_once('(')
        .map_or((dacl, ""), |(flags, rest)| (flags, rest));
    if !flags.contains('P') {
        return Err(refused(format!("its DACL is not protected ({flags:?})")));
    }
    let entries = format!("({entries}");
    let mut granted: Vec<&str> = Vec::new();
    for entry in entries.split(')').filter(|entry| !entry.is_empty()) {
        let fields: Vec<&str> = entry.trim_start_matches('(').split(';').collect();
        match fields.as_slice() {
            ["A", _, rights, _, _, sid] if full_control(rights) => granted.push(sid),
            _ => return Err(refused(format!("it has the entry {entry})"))),
        }
    }
    let user_entry = granted.iter().filter(|sid| **sid == user).count();
    let system_entry = granted.iter().filter(|sid| SYSTEM.contains(sid)).count();
    if granted.len() == 2 && user_entry == 1 && system_entry == 1 {
        Ok(())
    } else {
        Err(refused(format!("its entries grant {granted:?}")))
    }
}
