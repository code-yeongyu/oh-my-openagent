//! The attach-host connections (`hand.register`-ed peers: the `--oneshot --attach` consumers of
//! corpus case 09) share ONE bridge session the daemon opens itself (null mode, no session flags,
//! the bridge's own stop path), so a oneshot per request sees one session across processes. The
//! bridge session lives on one thread; connections reach it over a channel.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, PoisonError};

use serde_json::{json, Value};

use crate::bridge::BridgeSession;
use crate::launch::launch;
use crate::mcp::tier::Tier;
use crate::router::{reply, WireError};

type Call = (String, Value, Sender<Result<Value, WireError>>);

#[derive(Default)]
pub struct SharedBridge(Mutex<Option<Sender<Call>>>);

impl SharedBridge {
    fn sender(&self) -> Sender<Call> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(|| {
                let (calls, incoming) = mpsc::channel();
                std::thread::spawn(move || run(&incoming));
                calls
            })
            .clone()
    }

    fn call(&self, method: String, params: Value) -> Result<Value, WireError> {
        let (answer, answered) = mpsc::channel();
        let unavailable = || WireError::new(-32_603, "Internal error", Some(json!({"detail": "bridge session gone"})));
        self.sender().send((method, params, answer)).map_err(|_| unavailable())?;
        answered.recv().unwrap_or_else(|_| Err(unavailable()))
    }
}

fn run(incoming: &Receiver<Call>) {
    let mut bridge = match launch(std::env::vars().collect()) {
        Ok(launched) => {
            let narrowing = crate::stdio::narrowing(&launched, Tier::Exec);
            let mut bridge = BridgeSession::new(launched.router, narrowing);
            bridge.prepare();
            Ok(bridge)
        }
        Err(problem) => Err(problem.to_string()),
    };
    for (method, params, answer) in incoming {
        let outcome = match bridge.as_mut() {
            Ok(bridge) => bridge.call(&method, params),
            Err(detail) => Err(WireError::new(-32_603, "Internal error", Some(json!({"detail": detail})))),
        };
        let _ = answer.send(outcome);
    }
}

/// Serves one attach-host connection: `admit_request` checks (and strips) the request's
/// capability, `own` answers the daemon's own methods, the shared bridge answers the rest.
pub fn serve(
    stream: &UnixStream,
    bridge: &SharedBridge,
    admit_request: &dyn Fn(&mut Value) -> bool,
    own: &dyn Fn(&Value, &Value) -> bool,
) {
    let (Ok(reader), Ok(mut out)) = (stream.try_clone(), stream.try_clone()) else { return };
    for line in BufReader::new(reader).split(b'\n') {
        let Ok(line) = line else { break };
        let Ok(mut request) = serde_json::from_slice::<Value>(&line) else { continue };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        if !admit_request(&mut request) {
            break;
        }
        if own(&request, &id) {
            continue;
        }
        let method = request.get("method").and_then(Value::as_str).unwrap_or_default().to_owned();
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        let outcome = bridge.call(method, params);
        if writeln!(out, "{}", reply(&id, &outcome)).and_then(|()| out.flush()).is_err() {
            break;
        }
    }
}
