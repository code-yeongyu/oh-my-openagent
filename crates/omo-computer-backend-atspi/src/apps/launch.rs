//! Launching a resolved entry: the argument vector and the child's environment.

/// What is spawned: a program, its arguments and the whole child environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Spawns a plan and answers the child's pid.
pub trait Launcher {
    /// # Errors
    /// The spawn failed.
    fn launch(&mut self, plan: &LaunchPlan) -> std::io::Result<u32>;
}

/// The child's environment from the engine's.
#[must_use]
pub fn child_env(parent: impl IntoIterator<Item = (String, String)>) -> Vec<(String, String)> {
    parent.into_iter().collect()
}
