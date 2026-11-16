//! The `omo doctor computer` Windows chain (row 60): `--json`, exit 1 on a hard failure, never a
//! dialog; the signer line reports `unsigned` with the binary's sha256 and is not a failure (A13).

/// What the doctor reads on this host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub session_id: u32,
    pub input_desktop: String,
    pub signer: Option<String>,
    pub sha256: String,
}

/// The doctor's lines and exit code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Doctor {
    pub lines: Vec<String>,
    pub exit_code: i32,
    pub dialog: bool,
}

#[must_use]
pub fn doctor(probe: &Probe) -> Doctor {
    let _ = probe;
    Doctor { lines: Vec::new(), exit_code: 0, dialog: false }
}

#[cfg(test)]
mod tests {
    use super::{doctor, Probe};

    fn interactive() -> Probe {
        Probe { session_id: 1, input_desktop: "Default".to_owned(), signer: Some("Example".to_owned()), sha256: "ab".repeat(32) }
    }

    #[test]
    fn doctor_session0_exits_1_without_dialog() {
        let report = doctor(&Probe { session_id: 0, input_desktop: "Winlogon".to_owned(), ..interactive() });
        assert_eq!(report.exit_code, 1);
        assert!(!report.dialog);
        assert!(report.lines.iter().any(|l| l == "input_desktop:not_default"), "{:?}", report.lines);
        assert!(report.lines.iter().any(|l| l == "session:session0"), "{:?}", report.lines);
    }

    #[test]
    fn doctor_prints_signer_unsigned_with_the_sha256_and_does_not_exit_1_for_it() {
        let probe = Probe { signer: None, ..interactive() };
        let report = doctor(&probe);
        assert_eq!(report.exit_code, 0, "unsigned is reported, not a failure");
        assert!(report.lines.contains(&format!("signer:unsigned sha256:{}", probe.sha256)), "{:?}", report.lines);
    }
}
