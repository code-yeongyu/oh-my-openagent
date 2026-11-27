use super::{approve, connection::Connection, discover, frame};
use serde_json::{json, Value};

pub(super) struct Client {
    pub(super) connection: Connection,
    pub(super) sequence: u64,
}

impl Client {
    pub(super) fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.sequence;
        let payload = serde_json::to_vec(&json!({
            "jsonrpc":"2.0", "id":id, "method":method, "params":params,
        }))
        .map_err(|error| error.to_string())?;
        let capability = approve(&self.connection, &payload)?;
        self.connection
            .send(&frame(&capability, self.sequence, &payload)?);
        self.sequence = self.sequence.checked_add(1).ok_or("sequence overflow")?;
        loop {
            let message = self.connection.next()?;
            let reply: Value = serde_json::from_slice(message.data(c"payload")?)
                .map_err(|error| error.to_string())?;
            if reply["id"] == id {
                return Ok(reply);
            }
        }
    }
}

pub(super) fn run(service: &str, stop: bool) -> Result<(), String> {
    // given: real bidirectional O1 authentication and a fresh anonymous channel.
    let mut client = Client {
        connection: discover(service)?,
        sequence: 1,
    };
    let opened = client.call(
        "session.open",
        json!({"showCursor":false,"macosCanary":"off"}),
    )?;
    if opened.get("result").is_none() {
        return Err(format!("session.open failed: {opened}"));
    }
    if stop {
        // when: request a user stop and wait for its actual RPC acknowledgement.
        let reply = client.call("stopPath.stop", json!({"source":"api"}))?;
        // then
        if reply["result"]["suspended"] != true {
            return Err(format!("stop not acknowledged: {reply}"));
        }
        println!("LATCH_STOP_ACK stopped=true");
        return Ok(());
    }
    // when: a new session connects to the restarted agent.
    let status = client.call("stopPath.status", json!({}))?;
    // then: connection and session.open cannot clear the restored stop.
    if status["result"]["suspended"] != true {
        return Err(format!("restart lifted stop: {status}"));
    }
    println!("LATCH_AFTER_NEW_CLIENT stopped=true");
    let input = client.call(
        "holdKeys",
        json!({"target":"desktop","keys":["shift"],"duration":0}),
    )?;
    if input["error"]["data"]["code"] != "Suspended" {
        return Err(format!("input not refused as Suspended: {input}"));
    }
    println!("LATCH_INPUT_REFUSED code=Suspended");
    let resume = client.call(
        "stopPath.resume",
        json!({"token":opened["result"]["resumeToken"]}),
    )?;
    if resume["error"]["data"]["code"] != "PermissionDenied" {
        return Err(format!("RPC unexpectedly has reset authority: {resume}"));
    }
    let status = client.call("stopPath.status", json!({}))?;
    if status["result"]["suspended"] != true {
        return Err("RPC cleared persisted stop".to_owned());
    }
    println!("LATCH_RPC_RESET_REFUSED");
    Ok(())
}
