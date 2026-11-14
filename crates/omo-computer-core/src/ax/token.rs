//! The ref token `s<generation>:e<n>`: the generation of the window snapshot that minted it
//! and the session-wide element number. A bare `e<n>` is the v1 spelling.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefToken {
    Qualified { generation: u64, n: u64 },
    Bare { n: u64 },
}

impl RefToken {
    /// `None` for anything but `s<u64>:e<u64>` or `e<u64>` with no sign, space or zero `n`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let number = |digits: &str| -> Option<u64> {
            if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            digits.parse().ok()
        };
        let element = |part: &str| part.strip_prefix('e').and_then(number).filter(|n| *n > 0);
        match text.split_once(':') {
            Some((snapshot, part)) => Some(Self::Qualified {
                generation: snapshot.strip_prefix('s').and_then(number)?,
                n: element(part)?,
            }),
            None => element(text).map(|n| Self::Bare { n }),
        }
    }

    #[must_use]
    pub const fn n(self) -> u64 {
        match self {
            Self::Qualified { n, .. } | Self::Bare { n } => n,
        }
    }
}

impl fmt::Display for RefToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Qualified { generation, n } => write!(f, "s{generation}:e{n}"),
            Self::Bare { n } => write!(f, "e{n}"),
        }
    }
}
