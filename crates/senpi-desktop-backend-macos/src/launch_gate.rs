//! Refuses an engine that macOS made its own responsible process (#10207).
//!
//! TCC charges a request to the responsible process. An engine started by an
//! app, a terminal or an agent host inherits that launcher as its responsible
//! process, so it can only use grants its launcher already holds. An engine
//! that is its own responsible process (a launcher set the responsibility
//! disclaim spawn attribute, or submitted the engine as a launchd job) is
//! checked against the engine binary's own TCC entries instead, which would
//! hand any same-user process the grants of our signed binary. That case is
//! refused, and so is every case the check cannot resolve. A launchd job gets
//! no exception: any same-user process can submit one, so launchd parentage
//! proves nothing until the engine authenticates its peers over XPC.

/// # Errors
/// The engine is its own responsible process, or its responsible process
/// cannot be resolved.
pub fn check_launch() -> Result<(), LaunchRefusal> {
    // SAFETY: getpid takes no arguments and cannot fail.
    let pid = unsafe { libc::getpid() };
    decide(pid, crate::responsible::responsible_pid(pid))
}

fn decide(pid: libc::pid_t, responsible: Option<libc::pid_t>) -> Result<(), LaunchRefusal> {
    match responsible {
        Some(responsible) if responsible != pid => Ok(()),
        Some(_) => Err(LaunchRefusal::new(
            Reason::SelfResponsible,
            format!(
                "refusing to run as its own responsible process (pid {pid}): spawn the engine as a \
             child of the app, terminal or host that holds the computer-use grants, without the \
             responsibility-disclaim attribute and not as a launchd job or through a shell exec"
            ),
        )),
        None => Err(LaunchRefusal::new(
            Reason::Unresolved,
            format!(
                "refusing to run: the responsible process of engine pid {pid} cannot be resolved"
            ),
        )),
    }
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum Reason {
    SelfResponsible,
    Unresolved,
}

/// The existing admission decision, with a machine reason separate from its diagnostic.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct LaunchRefusal {
    version: u8,
    reason: Reason,
    #[serde(skip)]
    diagnostic: String,
}

impl LaunchRefusal {
    fn new(reason: Reason, diagnostic: String) -> Self {
        Self {
            version: 1,
            reason,
            diagnostic,
        }
    }

    /// One bounded stderr line; never a protocol reply or an authorization credential.
    pub const fn record(&self) -> &'static str {
        match self.reason {
            Reason::SelfResponsible => {
                "SENPI_DESKTOP_LAUNCH_REFUSED {\"version\":1,\"reason\":\"self-responsible\"}"
            }
            Reason::Unresolved => {
                "SENPI_DESKTOP_LAUNCH_REFUSED {\"version\":1,\"reason\":\"unresolved\"}"
            }
        }
    }
}

impl std::fmt::Display for LaunchRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.diagnostic)
    }
}

#[cfg(test)]
#[path = "launch_gate/tests.rs"]
mod tests;
