//! G2 (R70k): `--mcp --tier <read|exec>` is a narrowing REQUEST, never a grant. Absent means
//! `read`; any other value refuses to start (exit 2, one stderr line, no fallback). The grant is
//! the hand's `consent.json`, which the engine reads itself: absent admits `computer:read` only
//! (d-remote.md:207), untrustworthy reads `tampered`, `computerUse:false` is consent off.

use omo_computer_session::host_view::ConsentNarrowing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Read,
    Exec,
}

/// The tier after `--mcp`: `[]` or `["--tier", "read"|"exec"]`.
///
/// # Errors
/// An unknown value or flag, as the stderr line.
pub fn parse(rest: &[&str]) -> Result<Tier, String> {
    match rest {
        [] | ["--tier", "read"] => Ok(Tier::Read),
        ["--tier", "exec"] => Ok(Tier::Exec),
        ["--tier", other] => Err(format!("--tier must be read or exec, not {other:?}")),
        other => Err(format!("unsupported --mcp arguments: {}", other.join(" "))),
    }
}

/// The narrowing a host-less engine applies after its `session.open`: the requested tier over
/// what the hand's file grants.
#[must_use]
pub fn narrowing(lookup: impl Fn(&str) -> Option<String>, fake: bool, requested: Tier) -> ConsentNarrowing {
    let file = file_view(lookup, fake);
    ConsentNarrowing {
        computer_use: file.computer_use,
        exec_tier: requested == Tier::Exec && file.exec,
        tampered: file.tampered,
    }
}

struct FileView {
    computer_use: bool,
    exec: bool,
    tampered: bool,
}

#[cfg(unix)]
fn file_view(lookup: impl Fn(&str) -> Option<String>, fake: bool) -> FileView {
    let read = crate::host::host_paths(lookup, fake).and_then(|paths| crate::host::read_consent(&paths));
    match read {
        Ok(Some(file)) => FileView {
            computer_use: file["computerUse"].as_bool() == Some(true),
            exec: true,
            tampered: false,
        },
        Ok(None) => FileView { computer_use: true, exec: false, tampered: false },
        Err(_) => FileView { computer_use: true, exec: false, tampered: true },
    }
}

/// Windows reads `consent.json` with the host's DACL reader (row 60, owed): until then the
/// file grants nothing beyond `computer:read`.
#[cfg(not(unix))]
fn file_view(_lookup: impl Fn(&str) -> Option<String>, _fake: bool) -> FileView {
    FileView { computer_use: true, exec: false, tampered: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flag_is_read_or_exec_and_absent_is_read() {
        assert_eq!(parse(&[]), Ok(Tier::Read));
        assert_eq!(parse(&["--tier", "exec"]), Ok(Tier::Exec));
        assert!(parse(&["--tier", "admin"]).is_err());
        assert!(parse(&["--tier"]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn exec_without_a_consent_file_stays_read() {
        let dir = tempfile::tempdir().expect("dir");
        let seam = dir.path().to_string_lossy().into_owned();
        let lookup = |name: &str| (name == "OMO_COMPUTER_RUNTIME_DIR").then(|| seam.clone());
        let narrowed = narrowing(lookup, true, Tier::Exec);
        assert!(!narrowed.exec_tier, "{narrowed:?}");
    }
}
