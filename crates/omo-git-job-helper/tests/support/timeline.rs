use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::HANDLE;

use super::process;
use super::win::Owned;

/// Events stamped against one origin and printed in time order, so a receipt shows what happened when.
pub struct Timeline {
    origin: Instant,
    events: Mutex<Vec<(Duration, String)>>,
}

impl Timeline {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            origin: Instant::now(),
            events: Mutex::new(Vec::new()),
        })
    }

    pub fn mark(&self, what: impl Into<String>) -> Duration {
        let at = self.origin.elapsed();
        self.events
            .lock()
            .expect("timeline")
            .push((at, what.into()));
        at
    }

    /// Every event as `+<ms>ms <what>`, relative to `zero`.
    pub fn render(&self, zero: Duration) -> String {
        let mut events = self.events.lock().expect("timeline").clone();
        events.sort_by_key(|(at, _)| *at);
        events
            .iter()
            .map(|(at, what)| format!("{:+.3}ms {what}", signed_ms(*at, zero)))
            .collect::<Vec<_>>()
            .join("; ")
    }

    /// Stamps `<label> signaled` from its own thread when `handle` signals (bounded by `bound`).
    pub fn watch_exit(
        self: &Arc<Self>,
        handle: Owned,
        label: String,
        bound: Duration,
    ) -> JoinHandle<Option<Duration>> {
        let timeline = Arc::clone(self);
        std::thread::spawn(move || {
            process::signaled_within(handle.raw(), bound)
                .then(|| timeline.mark(format!("{label} signaled")))
        })
    }
}

fn signed_ms(at: Duration, zero: Duration) -> f64 {
    if at >= zero {
        ms(at - zero)
    } else {
        -ms(zero - at)
    }
}

pub fn ms(value: Duration) -> f64 {
    value.as_secs_f64() * 1000.0
}

pub fn median(values: &mut [Duration]) -> Duration {
    values.sort();
    values
        .get(values.len() / 2)
        .copied()
        .unwrap_or(Duration::MAX)
}

/// `<image>:<pid>` for a receipt.
pub fn member_label(process: HANDLE, pid: u32) -> String {
    let path = process::image_path(process);
    format!("{}:{pid}", path.rsplit('\\').next().unwrap_or(&path))
}
