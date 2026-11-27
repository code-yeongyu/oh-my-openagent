//! Command-line parsing: the engine's flags and the mode they select. The daemon modes
//! (`--serve`, `--oneshot`, `--mcp`) arrive with the rows that build them.

pub const USAGE: &str =
    "usage: omo-computer-engine [--stdio | --schema | --selftest [--json] | --version]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// NDJSON JSON-RPC on stdin/stdout, the default.
    Stdio,
    /// Prints the committed protocol schema.
    Schema,
    /// Drives a fake-backend session through the RPC layer and reports the checks.
    Selftest { json: bool },
    Version,
}

/// # Errors
/// An unknown flag or a combination no mode takes.
pub fn parse(args: &[String]) -> Result<Mode, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] | ["--stdio"] => Ok(Mode::Stdio),
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
        assert_eq!(parse(&args(&["--schema"])), Ok(Mode::Schema));
        assert_eq!(parse(&args(&["--selftest", "--json"])), Ok(Mode::Selftest { json: true }));
        assert!(parse(&args(&["--serve"])).is_err());
        assert!(parse(&args(&["--stdio", "--schema"])).is_err());
    }
}
