//! SP-W's probe ledger (`probes/wayland-portal.tsv`, cu-v3 row 8), shipped inside the engine:
//! the measured per-compositor facts the input route decides by. A compositor the ledger has
//! no row for reads as unmeasured, the most conservative answer.

use omo_computer_core::capabilities::CompositorName;

const SHIPPED: &str = include_str!("../probes/wayland-portal.tsv");

/// Whether the compositor releases what a closed client's virtual devices held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseProof {
    /// SP-W measured the release.
    Confirmed,
    /// SP-W has not measured it for this compositor (no row, or `UNMEASURED`).
    Unproven,
    /// SP-W measured NO release on socket close.
    Contradicts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Row {
    compositor: String,
    question: String,
    verdict: String,
}

/// The parsed ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ledger {
    rows: Vec<Row>,
}

impl Ledger {
    /// The ledger this engine was built with.
    #[must_use]
    pub fn shipped() -> Self {
        Self::parse(SHIPPED)
    }

    /// Parses the TSV: `id compositor question condition verdict ...`, one header line. The
    /// row's question key is the id's tail after `SPW-<compositor>-`.
    #[must_use]
    pub fn parse(text: &str) -> Self {
        let rows = text
            .lines()
            .skip(1)
            .filter_map(|line| {
                let mut columns = line.split('\t');
                let id = columns.next()?;
                let compositor = columns.next()?.to_owned();
                let verdict = columns.nth(2)?.to_owned();
                let question = id.strip_prefix(&format!("SPW-{compositor}-"))?.to_owned();
                Some(Row {
                    compositor,
                    question,
                    verdict,
                })
            })
            .collect();
        Self { rows }
    }

    /// The release-on-close proof for `compositor`.
    #[must_use]
    pub fn release(&self, compositor: CompositorName) -> ReleaseProof {
        match self.verdict(compositor, "release-on-close") {
            Some("CONFIRMS") => ReleaseProof::Confirmed,
            Some("CONTRADICTS") => ReleaseProof::Contradicts,
            Some(_) | None => ReleaseProof::Unproven,
        }
    }

    /// Whether a second `ConnectToEIS` on one live session was measured to succeed; `None`
    /// when unmeasured (the engine then simply tries it).
    #[must_use]
    pub fn second_connect(&self, compositor: CompositorName) -> Option<bool> {
        match self.verdict(compositor, "eis-second-connect") {
            Some("CONFIRMS") => Some(true),
            Some("CONTRADICTS") => Some(false),
            Some(_) | None => None,
        }
    }

    /// The same ledger with `compositor`'s release row replaced: a fake SP-W row for tests and
    /// fixtures.
    #[must_use]
    pub fn with_release_verdict(mut self, compositor: CompositorName, proof: ReleaseProof) -> Self {
        let Some(name) = ledger_name(compositor) else {
            return self;
        };
        let verdict = match proof {
            ReleaseProof::Confirmed => "CONFIRMS",
            ReleaseProof::Unproven => "UNMEASURED",
            ReleaseProof::Contradicts => "CONTRADICTS",
        };
        self.rows
            .retain(|row| !(row.compositor == name && row.question == "release-on-close"));
        self.rows.push(Row {
            compositor: name.to_owned(),
            question: "release-on-close".to_owned(),
            verdict: verdict.to_owned(),
        });
        self
    }

    fn verdict(&self, compositor: CompositorName, question: &str) -> Option<&str> {
        let name = ledger_name(compositor)?;
        self.rows
            .iter()
            .find(|row| row.compositor == name && row.question == question)
            .map(|row| row.verdict.as_str())
    }
}

/// The ledger's compositor column for a compositor the ladder named.
const fn ledger_name(compositor: CompositorName) -> Option<&'static str> {
    match compositor {
        CompositorName::Mutter => Some("gnome"),
        CompositorName::Kwin => Some("kde"),
        CompositorName::Sway => Some("sway"),
        CompositorName::Hyprland
        | CompositorName::River
        | CompositorName::Labwc
        | CompositorName::Weston
        | CompositorName::Xfwm4
        | CompositorName::Openbox
        | CompositorName::I3
        | CompositorName::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_ledger_reads_the_measured_release_rows() {
        let ledger = Ledger::shipped();
        assert_eq!(
            ledger.release(CompositorName::Mutter),
            ReleaseProof::Confirmed
        );
        assert_eq!(
            ledger.release(CompositorName::Kwin),
            ReleaseProof::Confirmed
        );
        assert_eq!(
            ledger.release(CompositorName::Sway),
            ReleaseProof::Unproven,
            "sway's row is UNMEASURED"
        );
        assert_eq!(
            ledger.release(CompositorName::Weston),
            ReleaseProof::Unproven,
            "weston has no row"
        );
        assert_eq!(
            ledger.second_connect(CompositorName::Mutter),
            Some(false),
            "GNOME refuses a second ConnectToEIS"
        );
        assert_eq!(ledger.second_connect(CompositorName::Kwin), Some(false));
    }
}
