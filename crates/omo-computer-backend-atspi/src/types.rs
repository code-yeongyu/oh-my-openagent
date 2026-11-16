//! The crate's own shapes: the audited accessibility-flag write and the detail a refusal
//! carries beside its code and reason (R52's `Refusal.data`, threaded here until that member is
//! on the base). Banners and menus use the core's `NotificationFingerprint` and `MenuNode`.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;

/// The audit record of the engine's `org.a11y.Status.IsEnabled` write:
/// `a11y_enabled{by:"engine", before, persisted:"unknown"}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct A11yAudit {
    pub before: bool,
}

impl A11yAudit {
    pub const KIND: &'static str = "a11y_enabled";
    pub const BY: &'static str = "engine";
    pub const PERSISTED: &'static str = "unknown";
}

/// What `session.open` did with the accessibility flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionOpen {
    /// Present when the engine wrote the flag.
    pub audit: Option<A11yAudit>,
    /// The bus refused the read or the write.
    pub write_refused: bool,
}

/// The data a refusal carries beside its code and reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detail {
    /// `AxUnsupported{role, actions[]}`: the action ladder resolved nothing.
    NoAction { role: String, actions: Vec<String> },
    /// Two ladder rungs matched: the action is ambiguous.
    AmbiguousAction { candidates: Vec<String> },
    /// `AxUnsupported{reason:"not_on_bus", app, hint}`.
    NotOnBus { app: String, hint: &'static str },
    /// Two menu items carry the label of one level.
    AmbiguousItem { candidates: Vec<String> },
    /// Two windows or frames are the target: never a topmost guess.
    AmbiguousWindow { candidates: Vec<String> },
    /// Re-identification found this many live matches (0 or 2+).
    Matches { count: usize },
    /// `ax:{available:false, reason:"no_bus"}`.
    NoBus,
}

/// A typed refusal with its detail; the trait methods answer `refusal` alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxRefusal {
    pub refusal: Refusal,
    pub detail: Option<Detail>,
}

impl AxRefusal {
    #[must_use]
    pub const fn new(refusal: Refusal, detail: Detail) -> Self {
        Self {
            refusal,
            detail: Some(detail),
        }
    }

    #[must_use]
    pub const fn plain(refusal: Refusal) -> Self {
        Self {
            refusal,
            detail: None,
        }
    }

    /// No accessibility bus: `observe` answers the typed unavailability, nothing is read.
    #[must_use]
    pub const fn no_bus() -> Self {
        Self::new(Refusal::bare(EngineCode::AxUnsupported), Detail::NoBus)
    }

    #[must_use]
    pub const fn code(&self) -> EngineCode {
        self.refusal.code
    }
}

impl From<Refusal> for AxRefusal {
    fn from(refusal: Refusal) -> Self {
        Self::plain(refusal)
    }
}

/// The hint `not_on_bus` carries.
pub const NOT_ON_BUS_HINT: &str = "started before accessibility was enabled; restart it";
