//! Fault injection.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fault;

impl Fault {
    #[must_use]
    pub fn fail(code: &str) -> Self {
        let _ = code;
        Self
    }
}
