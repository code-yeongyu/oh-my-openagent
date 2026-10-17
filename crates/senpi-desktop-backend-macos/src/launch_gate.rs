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
pub fn check_launch() -> Result<(), String> {
    // SAFETY: getpid takes no arguments and cannot fail.
    let pid = unsafe { libc::getpid() };
    decide(pid, crate::responsible::responsible_pid(pid))
}

fn decide(pid: libc::pid_t, responsible: Option<libc::pid_t>) -> Result<(), String> {
    match responsible {
        Some(responsible) if responsible != pid => Ok(()),
        Some(_) => Err(format!(
            "refusing to run as its own responsible process (pid {pid}): spawn the engine as a \
             child of the app, terminal or host that holds the computer-use grants, without the \
             responsibility-disclaim attribute and not as a launchd job or through a shell exec"
        )),
        None => Err(format!(
            "refusing to run: the responsible process of engine pid {pid} cannot be resolved"
        )),
    }
}

#[cfg(test)]
#[path = "launch_gate/tests.rs"]
mod tests;
