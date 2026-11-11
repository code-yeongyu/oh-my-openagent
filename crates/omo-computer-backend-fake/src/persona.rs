//! Per-OS personas.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Persona {
    Macos,
}

impl Persona {
    pub const ALL: [Self; 1] = [Self::Macos];
}
