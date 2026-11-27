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

/// How the platform compares environment variable names: exactly on Unix, ASCII
/// case-insensitively on Windows, where `omo_computer_backend` and `OMO_COMPUTER_BACKEND`
/// are the same variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameCase {
    Sensitive,
    AsciiInsensitive,
}

impl NameCase {
    /// The rule of the platform this engine runs on.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(windows) {
            Self::AsciiInsensitive
        } else {
            Self::Sensitive
        }
    }
}

/// Whether the environment name `candidate` names the variable `name` under `case`.
#[must_use]
pub fn env_name_matches(candidate: &str, name: &str, case: NameCase) -> bool {
    match case {
        NameCase::Sensitive => candidate == name,
        NameCase::AsciiInsensitive => candidate.eq_ignore_ascii_case(name),
    }
}

fn has_seam_prefix(name: &str, case: NameCase) -> bool {
    name.get(..SEAM_PREFIX.len())
        .is_some_and(|prefix| env_name_matches(prefix, SEAM_PREFIX, case))
}

/// Checks a launch environment under this platform's name rule; see [`check_launch_env_on`].
///
/// # Errors
/// The first refusal in name order.
pub fn check_launch_env<'a>(
    vars: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<Vec<EnvSeam>, SeamRefusal> {
    check_launch_env_on(vars, NameCase::current())
}

/// Checks a launch environment: refuses an unknown `OMO_COMPUTER_*` name and a fake-only
/// seam without `OMO_COMPUTER_BACKEND=fake`, comparing names under `case`. Returns the seams
/// that are set, in table order.
///
/// # Errors
/// The first refusal in name order.
pub fn check_launch_env_on<'a>(
    vars: impl IntoIterator<Item = (&'a str, &'a str)>,
    case: NameCase,
) -> Result<Vec<EnvSeam>, SeamRefusal> {
    let mut set: Vec<(&str, &str)> = vars
        .into_iter()
        .filter(|(name, _)| has_seam_prefix(name, case))
        .collect();
    set.sort_unstable();
    let fake = set.iter().any(|(name, value)| {
        env_name_matches(name, "OMO_COMPUTER_BACKEND", case) && *value == FAKE_BACKEND
    });
    for (name, _) in &set {
        let Some(seam) = ENV_SEAMS
            .iter()
            .find(|seam| env_name_matches(name, seam.name, case))
        else {
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
        .filter(|seam| {
            set.iter()
                .any(|(name, _)| env_name_matches(name, seam.name, case))
        })
        .collect())
}
