//! Argument and exit-code contract (design v4.2 sections 3 and 6). Portable, so it is unit-tested on every host.

pub const DEFAULT_LINGER_MS: u32 = 600_000;

/// Exit codes the writer and the contract rows read. Every code is observable: after the join, F's handle is never
/// closed before exit (`job::JoinedJob`), and the two job-wide kills terminate with the code they stand for.
/// `LingerKill` is `LINGER_KILL_CODE`: `TerminateJobObject(F, LINGER_KILL_CODE)` normally ends the helper with it
/// first, and if that call fails the helper exits with the same code and process rundown closes F, which
/// kill-on-close turns into the same kill. A separate "kill failed" code would describe an outcome no observer
/// can tell apart, so there is none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Ok,
    Usage,
    SelfId,
    Pipe,
    SecurityDescriptor,
    JobExists,
    JobCreate,
    Limits,
    LimitsMismatch,
    Port,
    Assign,
    Verify,
    Cancelled,
    SpawnFailed,
    PortFailed,
    LingerKill,
}

pub const LINGER_KILL_CODE: u32 = 0xC0DE_0001;

impl Exit {
    pub const fn code(self) -> i32 {
        match self {
            Self::Ok => 0,
            Self::Usage => 2,
            Self::SelfId => 10,
            Self::Pipe => 11,
            Self::SecurityDescriptor => 12,
            Self::JobExists => 13,
            Self::JobCreate => 14,
            Self::Limits => 15,
            Self::LimitsMismatch => 16,
            Self::Port => 17,
            Self::Assign => 18,
            Self::Verify => 19,
            Self::Cancelled => 20,
            Self::SpawnFailed => 21,
            Self::PortFailed => 22,
            Self::LingerKill => i32::from_ne_bytes(LINGER_KILL_CODE.to_ne_bytes()),
        }
    }

    /// The same code as the unsigned process exit status Windows reports (`TerminateJobObject`, `GetExitCodeProcess`).
    pub const fn status(self) -> u32 {
        u32::from_ne_bytes(self.code().to_ne_bytes())
    }
}

/// An operation id: 1-64 of `[A-Za-z0-9-]`. It names both `\\.\pipe\omo-git-op-<id>` and
/// `Global\omo-memory-git-<id>`, so nothing else can reach either namespace through it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpId(String);

impl OpId {
    pub fn parse(text: &str) -> Option<Self> {
        let valid = (1..=64).contains(&text.len())
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        valid.then(|| Self(text.to_owned()))
    }

    pub fn pipe_name(&self) -> String {
        format!(r"\\.\pipe\omo-git-op-{}", self.0)
    }

    pub fn job_name(&self) -> String {
        format!(r"Global\omo-memory-git-{}", self.0)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Run { op: OpId, linger_ms: u32 },
    Probe,
    Selftest,
}

pub fn parse(args: &[String]) -> Option<Command> {
    match args {
        [mode] if mode == "probe" => Some(Command::Probe),
        [mode] if mode == "selftest" => Some(Command::Selftest),
        [mode, flag, op] if mode == "run" && flag == "--op" => Some(Command::Run {
            op: OpId::parse(op)?,
            linger_ms: DEFAULT_LINGER_MS,
        }),
        [mode, flag, op, linger, millis]
            if mode == "run" && flag == "--op" && linger == "--linger-ms" =>
        {
            Some(Command::Run {
                op: OpId::parse(op)?,
                linger_ms: millis.parse().ok()?,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(text: &str) -> Vec<String> {
        text.split(' ').map(str::to_owned).collect()
    }

    #[test]
    fn modes_parse_and_anything_else_is_usage() {
        assert_eq!(parse(&args("probe")), Some(Command::Probe));
        assert_eq!(parse(&args("selftest")), Some(Command::Selftest));
        let op = OpId::parse("a-1").expect("valid id");
        assert_eq!(
            parse(&args("run --op a-1")),
            Some(Command::Run {
                op: op.clone(),
                linger_ms: DEFAULT_LINGER_MS
            })
        );
        assert_eq!(
            parse(&args("run --op a-1 --linger-ms 2000")),
            Some(Command::Run {
                op,
                linger_ms: 2000
            })
        );
        for bad in [
            "run",
            "run --op",
            "run --op a/b",
            "run --op a-1 --linger-ms x",
            "probe extra",
            "unknown",
        ] {
            assert_eq!(parse(&args(bad)), None, "{bad}");
        }
    }

    #[test]
    fn op_ids_cannot_leave_their_namespace() {
        assert_eq!(
            OpId::parse("ok-123").map(|op| op.job_name()),
            Some(r"Global\omo-memory-git-ok-123".to_owned())
        );
        for bad in ["", "a\\b", "..", "a b", "x".repeat(65).as_str()] {
            assert_eq!(OpId::parse(bad), None, "{bad:?}");
        }
    }
}
