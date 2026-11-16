//! What one read of one accessibility element returns, with the tri-state evidence that keeps
//! an unread field apart from an empty one.

use crate::listing::Rect;

/// Whether a field was read: present, read and empty, or not read at all (a hung control).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Seen {
    #[default]
    Known,
    Absent,
    Unknown,
}

/// Evidence for the fields the identity tuple and the outline depend on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Evidence {
    pub title: Seen,
    pub value: Seen,
    pub description: Seen,
}

impl Evidence {
    /// `known` where the field is present, `absent` where it is not.
    #[must_use]
    pub const fn of(title: bool, value: bool, description: bool) -> Self {
        const fn seen(present: bool) -> Seen {
            if present {
                Seen::Known
            } else {
                Seen::Absent
            }
        }
        Self {
            title: seen(title),
            value: seen(value),
            description: seen(description),
        }
    }

    /// A label or a value the read could not see.
    #[must_use]
    pub fn any_unknown(&self) -> bool {
        [self.title, self.value, self.description].contains(&Seen::Unknown)
    }
}

/// The reader's handle to a live element; opaque outside the reader that issued it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AxHandle(pub u64);

/// The identity the backend reports for the native object behind an element (a retained
/// `AXUIElement`, a UIA `RuntimeId`, an AT-SPI object path), stable while the object lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NativeObject(pub u64);

/// One element as one read returned it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NodeRead {
    pub handle: Option<AxHandle>,
    pub object: Option<NativeObject>,
    pub role: String,
    pub native_role: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub value: Option<String>,
    /// `AXIdentifier` / UIA `AutomationId` / AT-SPI accessible-id.
    pub native_id: Option<String>,
    pub enabled: Option<bool>,
    pub focused: Option<bool>,
    pub selected: Option<bool>,
    pub expanded: Option<bool>,
    pub checked: Option<bool>,
    pub secure: bool,
    pub actions: Vec<String>,
    pub bounds: Option<Rect>,
    pub child_count: u32,
    pub evidence: Evidence,
}

impl NodeRead {
    /// The label the identity tuple keys on: the title, else the description; never the value.
    #[must_use]
    pub fn stable_text(&self) -> Option<&str> {
        self.title
            .as_deref()
            .or(self.description.as_deref())
            .filter(|text| !text.trim().is_empty())
    }

    /// The label could not be read, so the stable text is not known.
    #[must_use]
    pub fn stable_text_unknown(&self) -> bool {
        self.evidence.title == Seen::Unknown || self.evidence.description == Seen::Unknown
    }
}

/// The identity refs of a window bind to: a different pid, process start or window is a
/// different window.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WindowKey {
    pub id: String,
    pub pid: u32,
    pub process_start: u64,
}

/// The root read of a window walk.
#[derive(Debug, Clone, PartialEq)]
pub struct RootRead {
    pub window: WindowKey,
    pub app: String,
    /// The roster's focus flag for the window itself.
    pub focused: bool,
    pub node: NodeRead,
}
