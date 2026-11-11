//! The recording sink.

#[derive(Debug, Clone, Default)]
pub struct RecordingSink;

impl RecordingSink {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        true
    }

    #[must_use]
    pub fn lines(&self) -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests;
