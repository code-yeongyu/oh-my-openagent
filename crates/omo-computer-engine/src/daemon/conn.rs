//! One admitted connection: every NDJSON request must carry the connection's bound capability
//! (compared constant-time; a mismatch is answered `unauthorized` and the connection closed), the
//! daemon's own methods (`hand.register`, `desktop.shutdown`, `HostOnly(authority)`) are answered
//! here, and everything else runs through the same executor as `--stdio`. Notification lines the
//! executor writes are also pushed to every other subscriber (the outbox).

use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, PoisonError};

use omo_computer_core::params::HandRegisterParams;
use omo_computer_core::requests::{read_hand_register, HostRequest};
use omo_computer_core::results::HandRegistered;
use serde_json::{json, Value};

use super::admit::constant_time_eq;
use super::state::{Grant, Shared, INJECTED_STOP};
use crate::executor::Executor;
use crate::launch::launch;

type Out = Arc<Mutex<UnixStream>>;

fn send(out: &Out, line: &Value) {
    let mut stream = out.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = writeln!(stream, "{line}").and_then(|()| stream.flush());
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The executor's output: the connection itself, and the outbox for notification lines.
struct Tee {
    out: Out,
    shared: Arc<Shared>,
    connection: usize,
    pending: Vec<u8>,
}

impl Write for Tee {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let message = serde_json::from_slice::<Value>(&line).unwrap_or_default();
            if message.get("id") == Some(&json!(INJECTED_STOP)) {
                continue;
            }
            self.out.lock().unwrap_or_else(PoisonError::into_inner).write_all(&line)?;
            if message.get("id").is_none() {
                if message["method"] == "stopPath.changed" {
                    self.shared.stop_changed(self.connection, message["params"]["suspended"] == true);
                }
                self.shared.push(self.connection, &line);
            }
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.out.lock().unwrap_or_else(PoisonError::into_inner).flush()
    }
}

/// The executor's input: the request lines this connection forwarded.
struct Forwarded {
    lines: Receiver<Vec<u8>>,
    current: io::Cursor<Vec<u8>>,
}

impl Read for Forwarded {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let read = self.current.read(buf)?;
            if read > 0 || buf.is_empty() {
                return Ok(read);
            }
            match self.lines.recv() {
                Ok(line) => self.current = io::Cursor::new(line),
                Err(_) => return Ok(0),
            }
        }
    }
}

/// Serves `stream` after admission until it closes.
pub fn serve(stream: UnixStream, grant: Grant, shared: &Arc<Shared>, connection: usize) {
    if matches!(grant, Grant::AttachHost { .. }) {
        let expected = hex(&shared.expected(grant));
        let admit_request = |request: &mut Value| {
            let presented = request.as_object_mut().and_then(|o| o.remove("capability"));
            constant_time_eq(presented.as_ref().and_then(Value::as_str).unwrap_or_default().as_bytes(), expected.as_bytes())
        };
        let out: Out = match stream.try_clone() {
            Ok(clone) => Arc::new(Mutex::new(clone)),
            Err(_) => return,
        };
        let own = |request: &Value, id: &Value| own_method(request, id, grant, shared, &out);
        super::attached::serve(&stream, &shared.bridge, &admit_request, &own, shared.is_stopped());
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return;
    }
    let Ok(reader) = stream.try_clone() else { return };
    if let Ok(subscriber) = stream.try_clone() {
        shared.subscribe(connection, subscriber);
    }
    let out: Out = Arc::new(Mutex::new(stream));
    let (forward, lines) = mpsc::channel();
    shared.inject_into(connection, forward.clone());
    let executor = {
        let (out, shared) = (Arc::clone(&out), Arc::clone(shared));
        std::thread::spawn(move || run_executor(out, shared, connection, lines))
    };
    let expected = shared.expected(grant);
    for line in BufReader::new(reader).split(b'\n') {
        let Ok(line) = line else { break };
        let Ok(mut request) = serde_json::from_slice::<Value>(&line) else { continue };
        let presented = request.as_object_mut().and_then(|o| o.remove("capability"));
        let carried = presented.as_ref().and_then(Value::as_str).unwrap_or_default();
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        if !constant_time_eq(carried.as_bytes(), hex(&expected).as_bytes()) {
            send(&out, &error(&id, -32_001, "unauthorized", json!({"code": "unauthorized"})));
            break;
        }
        match request.get("method").and_then(Value::as_str) {
            Some("session.open") => shared.idle.opened(connection),
            Some("session.close") => shared.idle.closed(connection),
            Some("$/test.advanceClock") => {
                shared.idle.advance(request.pointer("/params/ms").and_then(Value::as_u64).unwrap_or(0));
            }
            _ => {}
        }
        if !own_method(&request, &id, grant, shared, &out) {
            let mut bytes = request.to_string().into_bytes();
            bytes.push(b'\n');
            if forward.send(bytes).is_err() {
                break;
            }
            // `--start-stopped` or a stop already in force: a session opened now is suspended
            // right after its open (the open arms the guard; the stop then latches it).
            if request.get("method").and_then(Value::as_str) == Some("session.open") && shared.is_stopped() {
                let _ = forward.send(super::state::stop_line());
            }
        }
    }
    drop(forward);
    let _ = executor.join();
    shared.unsubscribe(connection);
    shared.idle.closed(connection);
    let _ = out.lock().unwrap_or_else(PoisonError::into_inner).shutdown(std::net::Shutdown::Both);
}

fn run_executor(out: Out, shared: Arc<Shared>, connection: usize, lines: Receiver<Vec<u8>>) {
    let tee = Tee { out: Arc::clone(&out), shared, connection, pending: Vec::new() };
    let input = BufReader::new(Forwarded { lines, current: io::Cursor::new(Vec::new()) });
    match launch(std::env::vars().collect()) {
        Ok(launched) => {
            let _ = Executor::new(launched.router, tee, launched.pace).run(input);
        }
        Err(problem) => {
            for line in input.split(b'\n').map_while(Result::ok) {
                let id = serde_json::from_slice::<Value>(&line).ok().and_then(|v| v.get("id").cloned());
                if let Some(id) = id {
                    send(&out, &error(&id, -32_603, "Internal error", json!({"detail": problem.to_string()})));
                }
            }
        }
    }
}

fn error(id: &Value, code: i64, message: &str, data: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message, "data": data}})
}

/// Answers the daemon's own methods; `false` for everything the router serves.
fn own_method(request: &Value, id: &Value, grant: Grant, shared: &Shared, out: &Out) -> bool {
    let method = request.get("method").and_then(Value::as_str).unwrap_or_default();
    if !matches!(method, "hand.register" | "desktop.shutdown") {
        return false;
    }
    if grant != Grant::Authority {
        let data = json!({"reason": "hostOnly", "peer_kind": "attach_host"});
        send(out, &error(id, -32_601, "Method not found", data));
        eprintln!("omo-computer-engine: audit: {method} refused hostOnly{{peer_kind:attach_host}}");
        return true;
    }
    if method == "desktop.shutdown" {
        send(out, &json!({"jsonrpc": "2.0", "id": id, "result": null}));
        std::process::exit(0);
    }
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    let reply = match serde_json::from_value::<HandRegisterParams>(params).map(read_hand_register) {
        Ok(HostRequest::HandRegister { pid, process_start }) => match shared.register(pid, process_start) {
            Ok(capability) => {
                let registered = HandRegistered { capability: hex(&capability) };
                json!({"jsonrpc": "2.0", "id": id, "result": registered})
            }
            Err(problem) => error(id, -32_603, "Internal error", json!({"detail": problem.to_string()})),
        },
        Ok(_) => error(id, -32_602, "Invalid params", Value::Null),
        Err(problem) => error(id, -32_602, "Invalid params", json!({"detail": problem.to_string()})),
    };
    send(out, &reply);
    true
}
