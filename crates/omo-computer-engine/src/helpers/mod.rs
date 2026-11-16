//! The engine's out-of-process helpers (d-arch.md 'Crash isolation'): each runs as the same
//! binary in its own process group and exits within 2 s of its parent's death.

pub mod parent;
pub mod presence;
