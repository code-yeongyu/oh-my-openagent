use crate::{
    dictionary::Dictionary,
    native::{Endpoint, Object, Peer, Raw},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{sync::mpsc, time::Duration};

// SAFETY: declaration matches the macOS SDK xpc/connection.h endpoint ABI.
unsafe extern "C" {
    fn xpc_connection_create_from_endpoint(endpoint: Raw) -> Raw;
}

enum Reply {
    Challenge,
    Capability([u8; 32]),
    Frame(Vec<u8>),
    Closed,
}

fn received(raw: Raw) -> Reply {
    // SAFETY: only the actual XPC event handler calls this with a live event.
    let Ok(message) = (unsafe { Dictionary::received(raw) }) else {
        return Reply::Closed;
    };
    if let Ok(payload) = message.data(c"payload", 1024 * 1024) {
        return Reply::Frame(payload.to_vec());
    }
    if let Ok(capability) = message.nonce(c"capability") {
        return Reply::Capability(capability);
    }
    assert_eq!(message.nonce(c"challenge").unwrap(), [7; 32]);
    Reply::Challenge
}

struct Wire {
    peer: Peer,
    replies: mpsc::Receiver<Reply>,
}

impl Wire {
    // SAFETY is discharged by callers: raw is an inactive owned Create result.
    unsafe fn created(raw: Raw) -> Self {
        // SAFETY: caller transfers the connection's sole Create reference.
        let peer = Peer::test_client(unsafe { Object::owned(raw) }.unwrap());
        let (tx, replies) = mpsc::channel();
        peer.install(move |raw| {
            if tx.send(received(raw)).is_err() { /* receiver has ended */ }
        });
        Self { peer, replies }
    }

    fn next(&self) -> Reply {
        self.replies.recv_timeout(Duration::from_secs(10)).unwrap()
    }

    fn challenge(&self) {
        let mut request = Dictionary::new().unwrap();
        request.put_uint(c"version", 1);
        request.put_data(c"challenge", &[7; 32]);
        self.peer.send(&request);
    }

    fn connect(endpoint: Endpoint) -> Self {
        // SAFETY: the retained endpoint remains live while creating the owned client.
        let data = unsafe { Self::created(xpc_connection_create_from_endpoint(endpoint.raw())) };
        data.challenge();
        assert!(matches!(data.next(), Reply::Challenge));
        data
    }

    fn call(&self, id: u64, method: &str, params: Value) -> Value {
        let payload =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
                .unwrap();
        let mut approval = Dictionary::new().unwrap();
        approval.put_uint(c"version", 1);
        approval.put_uint(c"kind", 1);
        approval.put_uint(c"ttl_ms", 30_000);
        approval.put_data(c"hashes", &Sha256::digest(&payload));
        self.peer.send(&approval);
        let Reply::Capability(capability) = self.next() else {
            panic!("approval rejected");
        };
        let mut frame = Dictionary::new().unwrap();
        frame.put_uint(c"version", 1);
        frame.put_uint(c"kind", 2);
        frame.put_uint(c"sequence", id);
        frame.put_data(c"capability", &capability);
        frame.put_data(c"payload", &payload);
        self.peer.send(&frame);
        let Reply::Frame(bytes) = self.next() else {
            panic!("RPC disconnected");
        };
        serde_json::from_slice(&bytes).unwrap()
    }
}

pub(super) fn run(endpoint: Endpoint, hold: bool) {
    let client = Wire::connect(endpoint);
    assert!(
        client.call(1, "session.open", json!({"allowHostRelayOnlyStop":true}))["result"]
            .is_object()
    );
    assert!(
        client.call(
            2,
            "control.grant",
            json!({"reason":"crash fixture","confirmationId":"fixture"})
        )["result"]["active"]
            == true
    );
    if hold {
        let reply = client.call(
            3,
            "holdKeys",
            json!({
                "target":"desktop","keys":["shift"],"duration":100,
                "opts":{"deliveryMode":"foreground"},
            }),
        );
        panic!("held client returned before SIGKILL: {reply}");
    }
}
