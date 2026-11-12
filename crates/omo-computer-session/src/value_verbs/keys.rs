//! Row 24's key verbs: `press` (one press of a chord, `repeat` times) and `keyChord`. Every
//! key goes down in order and comes up in reverse, paired; a key verb is never `confirmed`
//! from a read-back (no requested value).

use omo_computer_core::backend::{InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::methods::Method;
use omo_computer_core::params::{KeyChordParams, PressParams};
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::ExecReply;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::mutate::{key_event, route_for, Mutation, Refused};
use crate::Session;

/// One press of `keys`: down in order, up in reverse.
fn paired(keys: &[String]) -> Vec<InputEvent> {
    let mut events: Vec<InputEvent> = keys.iter().map(|key| key_event(key, true)).collect();
    events.extend(keys.iter().rev().map(|key| key_event(key, false)));
    events
}

fn chord_events(keys: &[String], repeat: u32) -> Vec<InputEvent> {
    (0..repeat.max(1)).flat_map(|_| paired(keys)).collect()
}

impl Session {
    /// `press`.
    ///
    /// # Errors
    /// `InvalidKey{unknown_key}` for a chord that does not parse, or the funnel's refusal.
    pub fn press(&mut self, params: PressParams) -> Result<ExecReply, Refused> {
        let keys = omo_computer_core::keys::chord_keys(&params.chord)
            .map_err(|_| Refused::from(Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey.wire())))?;
        let target = params.target.clone();
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let call = Call { verb: VerbKind::Keyboard, target: TargetRef::read(target.as_deref()), points: Vec::new(), chord: Some(params.chord.clone()), force: params.force.unwrap_or(false) };
        let events = chord_events(&keys, params.repeat.unwrap_or(1));
        let route = route_for(target.as_deref(), params.delivery);
        self.mutate(Mutation::exec(Method::Press, call, events, route, &authority).with_keys(keys))
    }

    /// `keyChord` (v1): the keys pressed together once, then released in reverse.
    ///
    /// # Errors
    /// The funnel's refusal.
    pub fn key_chord(&mut self, params: KeyChordParams) -> Result<ExecReply, Refused> {
        let call = Call { verb: VerbKind::Keyboard, target: TargetRef::read(Some(&params.target)), points: Vec::new(), chord: None, force: false };
        let events = paired(&params.keys);
        let route = route_for(Some(&params.target), None);
        self.mutate(Mutation::exec(Method::KeyChord, call, events, route, &CallAuthority::default()).with_keys(params.keys))
    }
}
