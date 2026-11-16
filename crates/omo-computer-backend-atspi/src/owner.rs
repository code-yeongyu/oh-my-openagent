//! Which native window an AT-SPI frame is: joined by pid, exact title and geometry, failing
//! closed to unknown or ambiguous, never a topmost guess (`d-linux.md` '### Tree').

use crate::bus::{Extents, NodeFacts, NodeId};

/// How far a frame's extents may sit from the native window's and still be the same window.
pub const GEOMETRY_TOLERANCE: i32 = 160;

/// One window as the host backend lists it (an X11 XID with its `_NET_WM_PID`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeWindow {
    pub id: String,
    pub pid: Option<u32>,
    pub app: String,
    pub title: String,
    pub bounds: Extents,
}

/// The host's window list, read when a native window id is targeted.
pub trait WindowSource: Send {
    fn windows(&mut self) -> Vec<NativeWindow>;
}

impl WindowSource for Vec<NativeWindow> {
    fn windows(&mut self) -> Vec<NativeWindow> {
        self.clone()
    }
}

/// The frame roles a toplevel can carry.
pub const FRAME_ROLES: &[&str] = &["frame", "window", "dialog", "file chooser", "alert"];

/// The outcome of joining one native window to the frames of its application.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Join {
    Frame(NodeId),
    /// No frame carries the window's title (or every titled one sits elsewhere).
    Unknown,
    /// Two or more windows or frames fit: the native ids that share the identity.
    Ambiguous(Vec<String>),
}

/// GTK4 on X11 reports every frame at `(0,0)`: such extents prove nothing.
#[must_use]
pub fn trusted(extents: Option<Extents>) -> Option<Extents> {
    extents.filter(|e| e.width > 0 && e.height > 0 && (e.x, e.y) != (0, 0))
}

fn near(a: Extents, b: Extents) -> bool {
    [
        (a.x, b.x),
        (a.y, b.y),
        (a.width, b.width),
        (a.height, b.height),
    ]
    .iter()
    .all(|(left, right)| (left - right).abs() <= GEOMETRY_TOLERANCE)
}

/// Whether at most one of `twins` sits within the tolerance of the placed frame `facts`.
fn fits_one(facts: &NodeFacts, twins: &[NativeWindow]) -> bool {
    let Some(frame) = trusted(facts.extents) else {
        return false;
    };
    twins
        .iter()
        .filter(|twin| trusted(Some(twin.bounds)).is_some_and(|b| near(frame, b)))
        .count()
        <= 1
}

/// Joins `target` to one of `frames` (the frames of the application owning its pid). `twins`
/// is every native window of the same pid and exact title, `target` included.
#[must_use]
pub fn join(target: &NativeWindow, twins: &[NativeWindow], frames: &[(NodeId, NodeFacts)]) -> Join {
    let titled: Vec<&(NodeId, NodeFacts)> = frames
        .iter()
        .filter(|(_, facts)| FRAME_ROLES.contains(&facts.role.as_str()))
        .filter(|(_, facts)| facts.name.as_deref() == Some(target.title.as_str()))
        .collect();
    let ambiguous = || Join::Ambiguous(twins.iter().map(|w| w.id.clone()).collect());
    if trusted(Some(target.bounds)).is_none() {
        return match (titled.as_slice(), twins.len()) {
            ([(node, _)], 1) => Join::Frame(node.clone()),
            ([], _) => Join::Unknown,
            _ => ambiguous(),
        };
    }
    let placed: Vec<&(NodeId, NodeFacts)> = titled
        .iter()
        .copied()
        .filter(|(_, facts)| trusted(facts.extents).is_some_and(|e| near(e, target.bounds)))
        .collect();
    match placed.as_slice() {
        [(node, facts)] if fits_one(facts, twins) => return Join::Frame(node.clone()),
        [_] => return ambiguous(),
        [_, _, ..] => return ambiguous(),
        [] => {}
    }
    let unplaced: Vec<&(NodeId, NodeFacts)> = titled
        .iter()
        .copied()
        .filter(|(_, facts)| trusted(facts.extents).is_none())
        .collect();
    match (unplaced.as_slice(), twins.len()) {
        ([(node, _)], 1) => Join::Frame(node.clone()),
        ([], _) => Join::Unknown,
        _ => ambiguous(),
    }
}
