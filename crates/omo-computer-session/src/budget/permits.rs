//! Permits (RED stub).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermitKind {
    Read,
    Exec,
}

#[derive(Debug, Clone, Default)]
pub struct Permits;

#[derive(Debug)]
pub struct Permit;

impl Permits {
    #[must_use]
    pub const fn try_take(&self, _kind: PermitKind) -> Option<Permit> {
        None
    }
}
