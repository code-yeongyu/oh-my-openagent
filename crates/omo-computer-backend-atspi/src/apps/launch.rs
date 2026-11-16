//! Launching a resolved entry: the argument vector and the child's environment. The child
//! never inherits the engine's activation token or startup id, so it cannot claim focus on
//! the agent's behalf.

use std::ffi::OsString;
use std::process::{Command, Stdio};

/// What is spawned: a program, its arguments and the whole child environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub program: String,
    pub args: Vec<String>,
    /// Taken as the OS gives it: a key or value that is not Unicode passes through untouched.
    pub env: Vec<(OsString, OsString)>,
}

/// Spawns a plan and answers the child's pid.
pub trait Launcher {
    /// # Errors
    /// The spawn failed.
    fn launch(&mut self, plan: &LaunchPlan) -> std::io::Result<u32>;
}

/// The variables the child never inherits.
pub const STRIPPED: &[&str] = &["XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"];

/// The child's environment from the engine's.
#[must_use]
pub fn child_env(
    parent: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    parent
        .into_iter()
        .filter(|(key, _)| !STRIPPED.iter().any(|stripped| key == stripped))
        .collect()
}

/// Starts the program directly (no shell), detached from the engine's standard streams and
/// in its own process group, with exactly the plan's environment.
#[derive(Debug, Default)]
pub struct SpawnLauncher;

impl Launcher for SpawnLauncher {
    fn launch(&mut self, plan: &LaunchPlan) -> std::io::Result<u32> {
        use std::os::unix::process::CommandExt;
        let child = Command::new(&plan.program)
            .args(&plan.args)
            .env_clear()
            .envs(plan.env.iter().map(|(key, value)| (key, value)))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()?;
        Ok(child.id())
    }
}
