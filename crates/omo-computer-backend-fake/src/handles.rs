//! The long-lived handles the fake hands out: epoch source, presence, stop listener and the
//! observer-event source. Each shares the backend's state; none reads the host.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::{
    AxEvent, AxEventSource, BackendResult, EpochChange, EpochSource, Presence, Refusal,
    RefusalCode, StopListener,
};

use crate::backend::StopPathScript;
use crate::clock::FakeClock;
use crate::sink::RecordingSink;
use crate::state::FakeState;
use crate::timeline;

fn lock(shared: &Arc<Mutex<FakeState>>) -> MutexGuard<'_, FakeState> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct FakeEpochSource {
    shared: Arc<Mutex<FakeState>>,
}

impl FakeEpochSource {
    pub const fn new(shared: Arc<Mutex<FakeState>>) -> Self {
        Self { shared }
    }
}

impl EpochSource for FakeEpochSource {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        Ok(lock(&self.shared).epochs.pop_front())
    }
}

/// Showing and hiding the overlay are side effects: each is one sink line.
pub struct FakePresence {
    sink: RecordingSink,
}

impl FakePresence {
    pub const fn new(sink: RecordingSink) -> Self {
        Self { sink }
    }
}

impl Presence for FakePresence {
    fn show(&mut self) -> BackendResult<()> {
        self.sink.record("presence show".to_owned());
        Ok(())
    }

    fn hide(&mut self) -> BackendResult<()> {
        self.sink.record("presence hide".to_owned());
        Ok(())
    }
}

pub struct FakeStopListener {
    shared: Arc<Mutex<FakeState>>,
    script: StopPathScript,
}

impl FakeStopListener {
    pub const fn new(shared: Arc<Mutex<FakeState>>, script: StopPathScript) -> Self {
        Self { shared, script }
    }
}

impl StopListener for FakeStopListener {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        if self.script == StopPathScript::Deaf {
            return Err(Refusal::new(RefusalCode::StopPathUnavailable, "deaf"));
        }
        Ok(std::mem::take(&mut lock(&self.shared).stop_pressed))
    }
}

pub struct FakeAxEvents {
    shared: Arc<Mutex<FakeState>>,
    clock: FakeClock,
}

impl FakeAxEvents {
    pub const fn new(shared: Arc<Mutex<FakeState>>, clock: FakeClock) -> Self {
        Self { shared, clock }
    }
}

impl AxEventSource for FakeAxEvents {
    fn next_event(&mut self) -> BackendResult<Option<AxEvent>> {
        let mut state = lock(&self.shared);
        let elapsed = state.elapsed(&self.clock);
        let from = state.ax_event_pos;
        let Some(index) =
            timeline::next_due(&state.scenario.ax_notification_timeline, from, elapsed)
        else {
            return Ok(None);
        };
        state.ax_event_pos = index + 1;
        Ok(state
            .scenario
            .ax_notification_timeline
            .get(index)
            .map(|event| AxEvent {
                kind: event.kind.clone(),
                window: event.window.clone(),
            }))
    }
}
