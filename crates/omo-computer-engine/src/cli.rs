//! Command-line parsing: the engine's flags and the mode they select.

use std::path::PathBuf;

use crate::mcp::tier::{self, Tier};

pub const USAGE: &str = "usage: omo-computer-engine [--stdio | --oneshot | --mcp [--tier read|exec] | --schema | --selftest [--json] | --presence-helper | --version]";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    /// NDJSON JSON-RPC on stdin/stdout, the default.
    Stdio,
    /// One request line in, one reply line out, a standalone session.
    Oneshot,
    /// The MCP stdio shim over the engine's own router.
    Mcp { tier: Tier },
    /// The detached presence renderer.
    PresenceHelper,
    /// Lifts the engine's held inputs after the engine dies (G3).
    ReleaseHelper,
    /// A same-uid server on a caller-chosen endpoint and lock (row 29 builds the daemon).
    Serve { endpoint: PathBuf, lock: PathBuf },
    /// Prints the committed protocol schema.
    Schema,
    /// Drives a fake-backend session through the router and reports the checks.
    Selftest { json: bool },
    Version,
}

/// # Errors
/// An unknown flag or a combination no mode takes.
pub fn parse(args: &[String]) -> Result<Mode, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] | ["--stdio"] => Ok(Mode::Stdio),
        ["--oneshot"] => Ok(Mode::Oneshot),
        ["--mcp", rest @ ..] => tier::parse(rest).map(|tier| Mode::Mcp { tier }),
        ["--presence-helper"] => Ok(Mode::PresenceHelper),
        ["--release-helper"] => Ok(Mode::ReleaseHelper),
        ["--enable-daemon", "--serve", "--endpoint", endpoint, "--lock", lock] => Ok(Mode::Serve {
            endpoint: PathBuf::from(endpoint),
            lock: PathBuf::from(lock),
        }),
        ["--schema"] => Ok(Mode::Schema),
        ["--selftest"] => Ok(Mode::Selftest { json: false }),
        ["--selftest", "--json"] | ["--json", "--selftest"] => Ok(Mode::Selftest { json: true }),
        ["--version"] => Ok(Mode::Version),
        other => Err(format!("unsupported arguments: {}", other.join(" "))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn modes_parse_and_unknown_flags_refuse() {
        assert_eq!(parse(&args(&[])), Ok(Mode::Stdio));
        assert_eq!(parse(&args(&["--stdio"])), Ok(Mode::Stdio));
        assert_eq!(parse(&args(&["--oneshot"])), Ok(Mode::Oneshot));
        assert_eq!(parse(&args(&["--mcp"])), Ok(Mode::Mcp { tier: Tier::Read }));
        assert_eq!(parse(&args(&["--mcp", "--tier", "exec"])), Ok(Mode::Mcp { tier: Tier::Exec }));
        assert!(parse(&args(&["--mcp", "--tier", "admin"])).is_err());
        assert_eq!(parse(&args(&["--schema"])), Ok(Mode::Schema));
        assert_eq!(parse(&args(&["--selftest", "--json"])), Ok(Mode::Selftest { json: true }));
        assert!(parse(&args(&["--stdio", "--schema"])).is_err());
    }
}
