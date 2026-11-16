//! `--release-helper` (DESIGN-GAPS-ROW28 G3, R70k): holds a copy of the engine's route-exact
//! held-input ledger, streamed over its stdin one full list per line. When the engine dies -
//! its end of the pipe closes, or the parent pid changes - and something is still held, the
//! helper builds the backend the engine built (on the fake: the same seams, its sink file under
//! the runtime dir) and posts the UP-only releases of the core ledger through the backend's one
//! post site; a key the user holds physically is left down. Then it exits.

use std::io::{BufRead, BufReader};
use std::process::ExitCode;
use std::sync::mpsc;

use omo_computer_core::backend::{Route, TaggedInput};
use omo_computer_core::holds::{Held, HoldLedger};
use serde_json::Value;

use super::parent::ParentWatch;
use crate::route;

/// One held input on the helper's pipe: `{"key":"shift"}` or `{"button":"left","origin":{"x":..,"y":..}}`.
#[cfg(unix)]
#[must_use]
pub fn to_wire(held: &Held) -> Value {
    match held {
        Held::Key { key } => serde_json::json!({ "key": key }),
        Held::Button { button, origin } => serde_json::json!({ "button": button, "origin": origin }),
    }
}

fn from_wire(value: &Value) -> Option<Held> {
    if let Some(key) = value["key"].as_str() {
        return Some(Held::Key { key: key.to_owned() });
    }
    Some(Held::Button {
        button: serde_json::from_value(value["button"].clone()).ok()?,
        origin: serde_json::from_value(value["origin"].clone()).ok()?,
    })
}

enum Event {
    Ledger(Vec<Held>),
    EngineGone,
}

pub fn run() -> ExitCode {
    let (events, received) = mpsc::channel();
    let pipe = events.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(std::io::stdin()).lines().map_while(Result::ok) {
            let list: Vec<Held> = serde_json::from_str::<Vec<Value>>(&line)
                .map(|items| items.iter().filter_map(from_wire).collect())
                .unwrap_or_default();
            if pipe.send(Event::Ledger(list)).is_err() {
                return;
            }
        }
        let _ = pipe.send(Event::EngineGone);
    });
    std::thread::spawn(move || {
        ParentWatch::new().wait_for_death();
        let _ = events.send(Event::EngineGone);
    });
    let mut held = Vec::new();
    for event in received {
        match event {
            Event::Ledger(list) => held = list,
            Event::EngineGone => return release(held),
        }
    }
    ExitCode::SUCCESS
}

fn release(held: Vec<Held>) -> ExitCode {
    if held.is_empty() {
        return ExitCode::SUCCESS;
    }
    let vars: Vec<(String, String)> = std::env::vars().collect();
    let mut backend = match route::launch(&vars) {
        Ok(launched) => launched.backend,
        Err(error) => {
            eprintln!("omo-computer-engine --release-helper: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut ledger = HoldLedger::default();
    for item in held {
        ledger.press(item, 0);
    }
    let tag = u64::from(std::process::id());
    for event in ledger.release_all(&backend.user_held_keys()) {
        if let Err(error) = backend.post_input(&TaggedInput { event, tag }, Route::ForegroundHid) {
            eprintln!("omo-computer-engine --release-helper: {error:?}");
        }
    }
    ExitCode::SUCCESS
}
