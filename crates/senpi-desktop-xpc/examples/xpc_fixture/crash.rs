use super::{discover, latch::Client};
use serde_json::json;

pub(super) fn run(service: &str, hold: bool) -> Result<(), String> {
    let mut client = Client {
        connection: discover(service)?,
        sequence: 1,
    };
    for (method, params) in [
        (
            "session.open",
            json!({"showCursor":false,"allowHostRelayOnlyStop":true}),
        ),
        ("stopPath.start", json!({"chord":"ctrl+alt+shift+escape"})),
        ("stopPath.heartbeat", json!({})),
        (
            "control.grant",
            json!({"reason":"crash-proof","confirmationId":"signed-fixture"}),
        ),
    ] {
        let reply = client.call(method, params)?;
        if reply.get("result").is_none() {
            return Err(format!("{method} refused: {reply}"));
        }
    }
    let state = client.call("control.state", json!({}))?;
    if state["result"]["active"] != true {
        return Err(format!("control not active: {state}"));
    }
    println!("CRASH_CONTROL_GRANTED active=true");
    if hold {
        let reply = client.call(
            "holdKeys",
            json!({
                "target":"desktop","keys":["shift"],"duration":100,
                "opts":{"deliveryMode":"foreground"},
            }),
        )?;
        return Err(format!("held client returned before SIGKILL: {reply}"));
    }
    Ok(())
}
