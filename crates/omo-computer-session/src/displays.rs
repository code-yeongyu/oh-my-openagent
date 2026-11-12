//! `displays()`. Signatures only at the test-first commit.

use omo_computer_core::backend::Refusal;
use omo_computer_core::results::DisplayInfo;

use crate::Session;

impl Session {
    /// Signature only at the test-first commit.
    ///
    /// # Errors
    /// None at this commit.
    pub fn displays(&mut self) -> Result<Vec<DisplayInfo>, Refusal> {
        Ok(Vec::new())
    }
}
