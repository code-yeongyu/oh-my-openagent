#[path = "connection.rs"]
mod connection;
#[path = "object.rs"]
mod object;
#[path = "latch.rs"]
mod latch;
#[path = "crash.rs"]
mod crash;
use connection::Connection;
use object::Object;
use sha2::{Digest, Sha256};
use std::io::{self, Write};

const FRAME: &[u8] =
    br#"{"jsonrpc":"2.0","id":"o2-private-rpc-canary","method":"engine.hello","params":{}}"#;

fn challenge() -> Result<Object, String> {
    let mut nonce = [0u8; 32];
    // SAFETY: writable 32-byte array is below getentropy's 256-byte limit.
    if unsafe { libc::getentropy(nonce.as_mut_ptr().cast(), nonce.len()) } != 0 {
        return Err("entropy failed".to_owned());
    }
    let mut message = Object::dictionary()?;
    message.put_uint(c"version", 1);
    message.put_data(c"challenge", &nonce);
    Ok(message)
}

fn discover(name: &str) -> Result<Connection, String> {
    let named = Connection::named(name)?;
    let request = challenge()?;
    let reply = named.exchange(&request)?;
    if reply.data(c"challenge")? != request.data(c"challenge")? || reply.data(c"epoch")? != b"xpc-1"
    {
        return Err("discovery mismatch".to_owned());
    }
    let data = Connection::endpoint(&reply)?;
    drop(named);
    let request = challenge()?;
    let reply = data.exchange(&request)?;
    if reply.data(c"challenge")? != request.data(c"challenge")? || reply.data(c"epoch")? != b"xpc-1"
    {
        return Err("endpoint challenge mismatch".to_owned());
    }
    Ok(data)
}

fn approve(data: &Connection, payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut request = Object::dictionary()?;
    request.put_uint(c"version", 1);
    request.put_uint(c"kind", 1);
    request.put_uint(c"ttl_ms", 30_000);
    request.put_data(c"hashes", &Sha256::digest(payload));
    let reply = data.exchange(&request)?;
    Ok(reply.data(c"capability")?.to_vec())
}

fn frame(capability: &[u8], sequence: u64, payload: &[u8]) -> Result<Object, String> {
    let mut request = Object::dictionary()?;
    request.put_uint(c"version", 1);
    request.put_uint(c"kind", 2);
    request.put_uint(c"sequence", sequence);
    request.put_data(c"capability", capability);
    request.put_data(c"payload", payload);
    Ok(request)
}

fn hello(data: &Connection, capability: &[u8]) -> Result<(), String> {
    data.send(&frame(capability, 1, FRAME)?);
    let reply = data.next()?;
    let payload =
        std::str::from_utf8(reply.data(c"payload")?).map_err(|error| error.to_string())?;
    if !payload.contains("\"id\":\"o2-private-rpc-canary\"") || !payload.contains("\"result\":") {
        return Err("wrong RPC reply".to_owned());
    }
    println!("RPC_OK authenticated=true anonymous=true");
    Ok(())
}

fn refused(result: Result<Object, String>) -> Result<(), String> {
    match result {
        Err(error) if error == "disconnected" || error == "untrusted-server" => {
            println!("REFUSED {error}");
            Ok(())
        }
        Err(error) => Err(error),
        Ok(_) => Err("unexpected acceptance".to_owned()),
    }
}

fn signal(marker: &str) -> Result<(), String> {
    println!("{marker}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if line.is_empty() {
        return Err("fixture controller disappeared".to_owned());
    }
    Ok(())
}

pub(super) fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).ok_or("missing mode")?;
    let name = args.get(2).ok_or("missing service")?;
    match mode.as_str() {
        "crash-hold" => crash::run(name, true),
        "crash-grant" => crash::run(name, false),
        "latch-stop" => latch::run(name, true),
        "latch-check" => latch::run(name, false),
        "squatter" => connection::squatter(name),
        "reject" => {
            let named = Connection::named(name)?;
            refused(named.exchange(&challenge()?))
        }
        "valid" => {
            let data = discover(name)?;
            let cap = approve(&data, FRAME)?;
            hello(&data, &cap)
        }
        "restart" => {
            let old = discover(name)?;
            let old_cap = approve(&old, FRAME)?;
            hello(&old, &old_cap)?;
            signal("READY_FOR_REPLACEMENT")?;
            refused(old.next())?;
            println!("OLD_ENDPOINT_INVALID no_replay=true");
            let named = Connection::named(name)?;
            refused(named.exchange(&challenge()?))?;
            drop(named);
            signal("SQUATTER_REFUSED")?;
            let new = discover(name)?;
            let new_cap = approve(&new, FRAME)?;
            if new_cap == old_cap {
                return Err("capability survived restart".to_owned());
            }
            hello(&new, &new_cap)?;
            println!("RECONNECTED_FRESH");
            new.send(&frame(&old_cap, 2, FRAME)?);
            refused(new.next())?;
            println!("STALE_CAPABILITY_REFUSED");
            Ok(())
        }
        _ => Err("unknown fixture mode".to_owned()),
    }
}
