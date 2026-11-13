//! The funnel's warnings: a result the funnel cannot act on and does not refuse for is logged
//! on stderr, never dropped (under test it is also kept, so a test sees it was not dropped).

use serde::Serialize;
use serde_json::Value;

use super::Funnel;

impl Funnel {
    pub(super) fn warn(&mut self, line: String) {
        eprintln!("omo-computer-engine: warn {line}");
        #[cfg(test)]
        self.warned.push(line);
    }

    /// The receipt a completed call stores: its reply as JSON. A reply that cannot be
    /// serialised is logged and stored as `null` (the call was delivered; the marker must
    /// still complete so the scope serves later calls).
    pub(super) fn receipt_of<T: Serialize>(&mut self, reply: &T) -> Value {
        serde_json::to_value(reply).unwrap_or_else(|error| {
            self.warn(format!("receipt not serialisable, null stored: {error}"));
            Value::Null
        })
    }
}
