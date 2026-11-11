//! `RecordingSink`: every OS-level side effect the fake performs, one line each, in order.
//! An empty sink is what a `nothingSent` assertion reads.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};

#[derive(Debug, Default)]
struct SinkInner {
    lines: Vec<String>,
    subscribers: Vec<mpsc::Sender<String>>,
    file: Option<File>,
    file_error: Option<String>,
}

/// Clones share one log, so a test keeps a handle while the backend moves elsewhere.
#[derive(Debug, Clone, Default)]
pub struct RecordingSink {
    inner: Arc<Mutex<SinkInner>>,
}

impl RecordingSink {
    /// A sink that also appends each line to `path` (created empty), for an out-of-process reader.
    ///
    /// # Errors
    /// The file cannot be created.
    pub fn with_file(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        let sink = Self::default();
        sink.lock().file = Some(file);
        Ok(sink)
    }

    fn lock(&self) -> MutexGuard<'_, SinkInner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn record(&self, line: String) {
        let mut inner = self.lock();
        if let Some(file) = inner.file.as_mut() {
            if let Err(error) = writeln!(file, "{line}") {
                inner.file_error = Some(error.to_string());
            }
        }
        inner
            .subscribers
            .retain(|subscriber| subscriber.send(line.clone()).is_ok());
        inner.lines.push(line);
    }

    /// Every line so far, oldest first.
    #[must_use]
    pub fn lines(&self) -> Vec<String> {
        self.lock().lines.clone()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.lock().lines.is_empty()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.lock().lines.len()
    }

    /// Every later line, delivered as it is recorded: subscribe before triggering the call.
    #[must_use]
    pub fn subscribe(&self) -> mpsc::Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        self.lock().subscribers.push(sender);
        receiver
    }

    /// The last error appending to the sink file, if any.
    #[must_use]
    pub fn file_error(&self) -> Option<String> {
        self.lock().file_error.clone()
    }
}

/// A string member of a sink line, quoted so a line always splits on spaces.
pub(crate) fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default()
}

#[cfg(test)]
mod tests;
