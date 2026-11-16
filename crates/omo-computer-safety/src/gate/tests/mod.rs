//! The gate's tests: the fixed order, the table rows of every stage, the target stage and
//! multi-point requests.

mod order;
mod points;
mod rows;
mod target;

use omo_computer_core::params::Point;

use super::{GateFacts, Identity, PointTarget, Resolution, Tables, Tier, VerbKind};
use crate::protected::{Os, ProtectedTable};
use crate::self_set::{HostAdditions, ProcessSnapshot, SelfSet, SelfSetInputs};
use crate::stop_path::{GlobalListener, RelayBeat, StopPathView, StopPolicy, Transport};

/// The pid of the session's own terminal in these tests: a self-set member.
pub(super) const TERMINAL: u32 = 9001;

pub(super) fn fresh() -> StopPathView {
    StopPathView {
        global: GlobalListener::Fresh,
        relay: RelayBeat::Absent,
        policy: StopPolicy::default_for(Transport::Local),
    }
}

pub(super) fn deaf() -> StopPathView {
    StopPathView {
        global: GlobalListener::Deaf { reason: None },
        ..fresh()
    }
}

pub(super) fn exec(verb: VerbKind) -> GateFacts {
    GateFacts::clear(Tier::Exec, verb, fresh())
}

pub(super) fn window(pid: u32, app_key: &str) -> Resolution {
    Resolution::Window(Identity {
        pid,
        app_key: app_key.to_owned(),
        surface: None,
    })
}

pub(super) fn at(x: f64, y: f64, resolution: Resolution) -> PointTarget {
    PointTarget::new(Some(Point { x, y }), resolution)
}

pub(super) fn plain() -> Vec<PointTarget> {
    vec![at(10.0, 10.0, window(4242, "com.example.Notes"))]
}

pub(super) fn terminal() -> Vec<PointTarget> {
    vec![at(10.0, 10.0, window(TERMINAL, "com.example.Terminal"))]
}

/// A self set holding the terminal (the host's addition).
pub(super) fn self_set() -> SelfSet {
    SelfSet::compute(&SelfSetInputs {
        own_pid: 100,
        snapshot: &ProcessSnapshot::default(),
        brain_locks: &[],
        brain_names: &[],
        additions: &HostAdditions {
            pids: vec![TERMINAL],
            app_keys: Vec::new(),
        },
    })
}

/// The macOS table over `set`.
pub(super) fn tables(set: &SelfSet) -> Tables<'_> {
    Tables {
        self_set: set,
        protected: ProtectedTable::of(Os::Macos),
        allowed_apps: &[],
    }
}
