//! The `--stdio` loop over the router: lines are read on their own thread so a `$/cancel` or a
//! stop is seen while an earlier reply is still due. A reply leaves when its call is done; on the
//! fake WITHOUT the fake-clock seam a call is done once real time has caught up with what the
//! backend's clock advanced during it (the fake never waits, so its scripted delay becomes the
//! hold here). A pending reply that a `$/cancel{id}` names answers `Cancelled`; one that a stop
//! overtook answers `Suspended` - a late reply is never delivered across a stop. Notifications
//! follow the reply they belong to.

pub mod framing;

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use omo_computer_core::error::EngineCode;
use serde_json::Value;

use crate::router::{overtaken, reply, Peer, Router, WireError};
use framing::{parse, Line};

struct Pending {
    id: Value,
    due: Instant,
    outcome: Result<Value, WireError>,
    notes: Vec<Value>,
    stop_epoch: u64,
    stop_proof: bool,
}

pub struct Executor<W: Write> {
    router: Router,
    output: W,
    pending: Vec<Pending>,
    pace: bool,
    #[cfg(unix)]
    release: Option<crate::helpers::release_link::ReleaseLink>,
}

impl<W: Write> Executor<W> {
    /// `pace` holds replies by the fake clock's advance (the fake without its clock seam).
    pub fn new(router: Router, output: W, pace: bool) -> Self {
        Self {
            router,
            output,
            pending: Vec::new(),
            pace,
            #[cfg(unix)]
            release: None,
        }
    }

    /// Streams the session's held inputs to the release helper after every call.
    #[cfg(unix)]
    #[must_use]
    pub fn with_release(mut self, link: crate::helpers::release_link::ReleaseLink) -> Self {
        self.release = Some(link);
        self
    }

    /// Serves until the input closes and every due reply is written; hands the router back.
    ///
    /// # Errors
    /// Writing a reply failed.
    pub fn run(mut self, input: impl BufRead + Send + 'static) -> io::Result<Router> {
        let (lines, received) = mpsc::channel();
        std::thread::spawn(move || {
            for line in input.split(b'\n') {
                if line.map_or(true, |line| lines.send(line).is_err()) {
                    return;
                }
            }
        });
        loop {
            let due = self.next_due().map(|due| due.saturating_duration_since(Instant::now()));
            let hold = self.router.session().hold_wait();
            let wait = match (due, hold) {
                (Some(due), Some(hold)) => Some(due.min(hold)),
                (due, hold) => due.or(hold),
            };
            let next = match wait {
                Some(wait) => received.recv_timeout(wait),
                None => received.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match next {
                Ok(line) => self.handle(&line)?,
                Err(RecvTimeoutError::Timeout) => {
                    self.router.session_mut().release_due_holds();
                    self.stream_holds();
                }
                Err(RecvTimeoutError::Disconnected) => return self.drain(),
            }
            self.flush_due(Instant::now())?;
        }
    }

    fn next_due(&self) -> Option<Instant> {
        self.pending.iter().map(|pending| pending.due).min()
    }

    fn handle(&mut self, line: &[u8]) -> io::Result<()> {
        match parse(line) {
            Line::Blank => Ok(()),
            Line::Invalid(id, error) => self.write(&reply(&id, &Err(error)), &[]),
            Line::Notification { method, params } => {
                if method == "$/cancel" {
                    self.cancel(&params["id"]);
                }
                Ok(())
            }
            Line::Request { id, method, params } => self.call(id, &method, params),
        }
    }

    fn call(&mut self, id: Value, method: &str, params: Value) -> io::Result<()> {
        let before = self.router.fake_now_ms();
        let stop_epoch = self.router.stop_epoch();
        let outcome = self.router.call(Peer::Host, method, params);
        let notes = self.router.take_notifications();
        self.stream_holds();
        let held = match (self.pace, before, self.router.fake_now_ms()) {
            (true, Some(before), Some(after)) => after.saturating_sub(before),
            _ => 0,
        };
        self.pending.push(Pending {
            id,
            due: Instant::now() + Duration::from_millis(held),
            outcome,
            notes,
            stop_epoch,
            stop_proof: method.starts_with("stopPath."),
        });
        Ok(())
    }

    fn cancel(&mut self, id: &Value) {
        if let Some(pending) = self.pending.iter_mut().find(|pending| pending.id == *id) {
            pending.outcome = Err(WireError::bare(EngineCode::Cancelled));
            pending.notes.clear();
            pending.due = Instant::now();
        }
    }

    fn flush_due(&mut self, now: Instant) -> io::Result<()> {
        self.pending.sort_by_key(|pending| pending.due);
        while self.pending.first().is_some_and(|pending| pending.due <= now) {
            let mut pending = self.pending.remove(0);
            if !pending.stop_proof && pending.stop_epoch < self.router.stop_epoch() && pending.outcome.is_ok() {
                pending.outcome = Err(overtaken());
            }
            self.write(&reply(&pending.id, &pending.outcome), &pending.notes)?;
        }
        Ok(())
    }

    fn stream_holds(&mut self) {
        #[cfg(unix)]
        if let Some(link) = self.release.as_mut() {
            link.update(&self.router.session().held_inputs());
        }
    }

    /// The input closed: due replies are written, then the session closes, which releases
    /// every hold (row 23, R49).
    fn drain(mut self) -> io::Result<Router> {
        while let Some(due) = self.next_due() {
            std::thread::sleep(due.saturating_duration_since(Instant::now()));
            self.flush_due(Instant::now())?;
        }
        self.router.session_mut().close();
        self.stream_holds();
        Ok(self.router)
    }

    fn write(&mut self, message: &Value, notes: &[Value]) -> io::Result<()> {
        writeln!(self.output, "{message}")?;
        for note in notes {
            writeln!(self.output, "{note}")?;
        }
        self.output.flush()
    }
}

#[cfg(test)]
mod tests;
