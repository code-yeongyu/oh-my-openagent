//! The enumerated environment seam list (design row C17, amendment A9).
//!
//! Exactly nine `OMO_COMPUTER_*` variables exist. Every behaviour switch that is not a
//! seam lives in the `computer.*` settings table passed in `session.open`.

use serde::Serialize;

/// The backend value that admits the fake-only seams.
pub const FAKE_BACKEND: &str = "fake";

/// When a seam is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SeamPhase {
    /// Read by the engine process at launch.
    Launch,
    /// Read by the build (`option_env!`), never at run time.
    BuildTime,
    /// Read by the test harness only.
    Test,
}

/// One environment seam.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvSeam {
    pub name: &'static str,
    pub phase: SeamPhase,
    /// Honoured only when `OMO_COMPUTER_BACKEND=fake`; with a real backend its presence refuses the launch.
    pub fake_only: bool,
    pub purpose: &'static str,
}

const fn seam(
    name: &'static str,
    phase: SeamPhase,
    fake_only: bool,
    purpose: &'static str,
) -> EnvSeam {
    EnvSeam {
        name,
        phase,
        fake_only,
        purpose,
    }
}

/// Every seam, in a fixed order. Nothing else named `OMO_COMPUTER_*` is read.
pub const ENV_SEAMS: &[EnvSeam] = &[
    seam(
        "OMO_COMPUTER_BACKEND",
        SeamPhase::Launch,
        false,
        "selects the backend; `fake` admits the fake-only seams",
    ),
    seam(
        "OMO_COMPUTER_FAKE_CLOCK",
        SeamPhase::Launch,
        true,
        "installs the fake clock",
    ),
    seam(
        "OMO_COMPUTER_FAKE_STOP_PATH",
        SeamPhase::Launch,
        true,
        "scripts the fake stop listener",
    ),
    seam(
        "OMO_COMPUTER_FAKE_SCENARIO",
        SeamPhase::Launch,
        true,
        "selects the fake backend's scenario file",
    ),
    seam(
        "OMO_COMPUTER_RUNTIME_DIR",
        SeamPhase::Launch,
        true,
        "moves the marker and stop files into a test directory",
    ),
    seam(
        "OMO_COMPUTER_DISABLE_SKYLIGHT",
        SeamPhase::Launch,
        false,
        "turns the macOS SkyLight capture route off",
    ),
    seam(
        "OMO_COMPUTER_UPDATE_SCHEMA",
        SeamPhase::Test,
        false,
        "rewrites the generated schema and protocol doc",
    ),
    seam(
        "OMO_COMPUTER_CONFORMANCE_DIR",
        SeamPhase::Test,
        false,
        "points the conformance replay at a fixture directory",
    ),
    seam(
        "OMO_COMPUTER_BUILD_SHA",
        SeamPhase::BuildTime,
        false,
        "the commit the engine was built from",
    ),
];

/// Why a launch environment is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeamRefusal {
    /// A fake-only seam is set while the backend is not the fake.
    FakeOnlySeamWithRealBackend { name: String },
    /// A variable with the seam prefix that is not in [`ENV_SEAMS`].
    UnknownSeam { name: String },
}

/// The prefix every seam carries.
pub const SEAM_PREFIX: &str = "OMO_COMPUTER_";

/// Checks a launch environment: refuses an unknown `OMO_COMPUTER_*` name and a fake-only
/// seam without `OMO_COMPUTER_BACKEND=fake`. Returns the seams that are set, in table order.
///
/// # Errors
/// The first refusal in name order.
pub fn check_launch_env<'a>(
    vars: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<Vec<EnvSeam>, SeamRefusal> {
    let mut set: Vec<(&str, &str)> = vars
        .into_iter()
        .filter(|(name, _)| name.starts_with(SEAM_PREFIX))
        .collect();
    set.sort_unstable();
    let fake = set
        .iter()
        .any(|(name, value)| *name == "OMO_COMPUTER_BACKEND" && *value == FAKE_BACKEND);
    for (name, _) in &set {
        let Some(seam) = ENV_SEAMS.iter().find(|seam| seam.name == *name) else {
            return Err(SeamRefusal::UnknownSeam {
                name: (*name).to_owned(),
            });
        };
        if seam.fake_only && !fake {
            return Err(SeamRefusal::FakeOnlySeamWithRealBackend {
                name: (*name).to_owned(),
            });
        }
    }
    Ok(ENV_SEAMS
        .iter()
        .copied()
        .filter(|seam| set.iter().any(|(name, _)| *name == seam.name))
        .collect())
}
