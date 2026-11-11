//! The fake clock.

#[derive(Debug, Clone, Default)]
pub struct FakeClock;

impl FakeClock {
    /// # Errors
    /// Never, in this signature stub.
    pub fn from_seam(value: Option<&str>) -> Result<Self, String> {
        let _ = value;
        Ok(Self)
    }

    #[must_use]
    pub fn now_ms(&self) -> u64 {
        0
    }

    pub fn advance(&self, ms: u64) -> u64 {
        let _ = ms;
        0
    }
}

#[cfg(test)]
mod tests;
