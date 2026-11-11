//! The typed refusal every default backend method answers with. Nothing is sent on a
//! refusal: a default never reaches the OS.

/// The engine codes a default backend method refuses with.
// row 13: replace with the total `(engineCode, data.reason)` -> COMPUTER_* error table; these
// are the closest codes the contract names, mapped one to one below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalCode {
    /// The backend has no such capability (`Unavailable{reason}`).
    Unavailable,
    /// The backend cannot capture (`CaptureUnavailable{reason}`).
    CaptureUnavailable,
    /// The backend has no accessibility tree (`AxUnavailable{reason}`).
    AxUnavailable,
    /// The backend has no stop listener (`StopPathUnavailable{reason}`).
    StopPathUnavailable,
    /// The backend has no presence surface (`PresenceUnavailable{reason}`).
    PresenceUnavailable,
}

impl RefusalCode {
    /// The engine code's wire name.
    #[must_use]
    pub const fn engine_code(self) -> &'static str {
        match self {
            Self::Unavailable => "Unavailable",
            Self::CaptureUnavailable => "CaptureUnavailable",
            Self::AxUnavailable => "AxUnavailable",
            Self::StopPathUnavailable => "StopPathUnavailable",
            Self::PresenceUnavailable => "PresenceUnavailable",
        }
    }

    /// The `COMPUTER_*` code the tool and the adapter show.
    // row 13: StopPathUnavailable has no COMPUTER_* member of its own in the interface block;
    // COMPUTER_SUPERVISOR_NOT_LIVE is the closest until the total table decides the row.
    #[must_use]
    pub const fn computer_code(self) -> &'static str {
        match self {
            Self::Unavailable => "COMPUTER_UNAVAILABLE",
            Self::CaptureUnavailable => "COMPUTER_CAPTURE_UNAVAILABLE",
            Self::AxUnavailable => "COMPUTER_AX_UNAVAILABLE",
            Self::StopPathUnavailable => "COMPUTER_SUPERVISOR_NOT_LIVE",
            Self::PresenceUnavailable => "COMPUTER_PRESENCE_UNAVAILABLE",
        }
    }
}

/// A refusal before any send: `nothingSent` is always true.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: RefusalCode,
    pub reason: &'static str,
}

impl Refusal {
    #[must_use]
    pub const fn new(code: RefusalCode, reason: &'static str) -> Self {
        Self { code, reason }
    }
}

/// The result of every fallible backend method.
pub type BackendResult<T> = Result<T, Refusal>;
