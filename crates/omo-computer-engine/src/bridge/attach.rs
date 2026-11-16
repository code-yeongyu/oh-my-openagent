//! `--oneshot --attach <endpoint>`: one v1 `desktop.*` request against a running `--serve`
//! daemon (corpus case 09). The capability the daemon minted for this process (`hand.register`,
//! from `hand.ensure` in row 37) arrives as the FIRST stdin line, 64 hex digits, never argv, env
//! or a file; the request is the second line. The client sends the raw 32-byte preamble, then the
//! request carrying the capability, and relays the one reply.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::ExitCode;

use serde_json::Value;

fn capability(line: &str) -> io::Result<Vec<u8>> {
    let line = line.trim();
    let invalid = || io::Error::new(io::ErrorKind::InvalidInput, "no capability on stdin");
    if line.len() != 64 {
        return Err(invalid());
    }
    (0..32)
        .map(|i| line.get(i * 2..i * 2 + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok()).ok_or_else(invalid))
        .collect()
}

fn attach(endpoint: &Path) -> io::Result<()> {
    let mut lines = io::stdin().lock().lines();
    let hex = lines.next().transpose()?.unwrap_or_default();
    let preamble = capability(&hex)?;
    let line = lines.next().transpose()?.unwrap_or_default();
    let mut request: Value = serde_json::from_str(&line).map_err(io::Error::other)?;
    let id = request.get("id").cloned();
    request["capability"] = Value::String(hex.trim().to_owned());
    let mut stream = UnixStream::connect(endpoint)?;
    stream.write_all(&preamble)?;
    writeln!(stream, "{request}")?;
    for reply in BufReader::new(stream).lines() {
        let reply = reply?;
        let message: Value = serde_json::from_str(&reply).unwrap_or_default();
        if message.get("id").is_some() && message.get("id") == id.as_ref() {
            let mut out = io::stdout().lock();
            writeln!(out, "{reply}")?;
            return out.flush();
        }
    }
    Err(io::Error::new(io::ErrorKind::ConnectionAborted, "the daemon closed the connection unanswered"))
}

pub fn run(endpoint: &Path) -> ExitCode {
    match attach(endpoint) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: --oneshot --attach: {error}");
            ExitCode::FAILURE
        }
    }
}
