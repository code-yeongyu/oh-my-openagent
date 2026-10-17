//! The local client side of the `--serve` daemon: the default endpoint, one
//! request/reply exchange, a detached auto-start, and the user's `--resume`.

use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const START_GUARD: Duration = Duration::from_secs(10);
const BUSY_GUARD: Duration = Duration::from_secs(5);
const CONNECT_RETRY: Duration = Duration::from_millis(20);

/// `$XDG_RUNTIME_DIR/senpi-desktop/<uid>.sock`, else a private per-user
/// directory under the temp dir; the directory is created 0700.
///
/// # Errors
/// The runtime directory cannot be created.
pub fn default_endpoint() -> io::Result<String> {
    if cfg!(windows) {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_owned());
        return Ok(format!(r"\\.\pipe\senpi-desktop-{user}"));
    }
    let base = std::env::var_os("XDG_RUNTIME_DIR").map_or_else(std::env::temp_dir, PathBuf::from);
    let dir = base.join("senpi-desktop");
    let owner = private_dir(&dir)?;
    Ok(dir.join(format!("{owner}.sock")).to_string_lossy().into_owned())
}

/// The resume token file beside `endpoint`.
pub fn token_file(endpoint: &str) -> PathBuf {
    if cfg!(windows) {
        let name = endpoint.rsplit('\\').next().unwrap_or("senpi-desktop");
        return std::env::temp_dir().join(format!("{name}.resume"));
    }
    Path::new(endpoint).with_extension("resume")
}

#[cfg(unix)]
fn private_dir(dir: &Path) -> io::Result<u32> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    Ok(std::fs::metadata(dir)?.uid())
}

#[cfg(not(unix))]
fn private_dir(dir: &Path) -> io::Result<u32> {
    std::fs::create_dir_all(dir).map(|()| 0)
}

/// Sends one request and reads its reply line.
///
/// # Errors
/// The daemon is not reachable or its reply is not JSON.
pub fn exchange(endpoint: &str, request: &Value) -> io::Result<Value> {
    let stream = connect_until(endpoint, Instant::now() + BUSY_GUARD, &is_busy)?;
    exchange_over(stream, request)
}

fn exchange_over(mut stream: impl io::Read + Write, request: &Value) -> io::Result<Value> {
    writeln!(stream, "{request}")?;
    stream.flush()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    serde_json::from_str(&line).map_err(io::Error::other)
}

/// Retries while `retry(error)` holds, until `deadline`.
fn connect_until(
    endpoint: &str,
    deadline: Instant,
    retry: &dyn Fn(&io::Error) -> bool,
) -> io::Result<Stream> {
    loop {
        match connect(endpoint) {
            Ok(stream) => return Ok(stream),
            Err(error) if retry(&error) && Instant::now() < deadline => std::thread::sleep(CONNECT_RETRY),
            Err(error) => return Err(error),
        }
    }
}

/// A named pipe whose every instance is serving a client (`ERROR_PIPE_BUSY`): the
/// daemon creates the next instance right after accepting, so a retry gets in.
fn is_busy(error: &io::Error) -> bool {
    cfg!(windows) && error.raw_os_error() == Some(231)
}

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(not(unix))]
type Stream = std::fs::File;

#[cfg(unix)]
fn connect(endpoint: &str) -> io::Result<std::os::unix::net::UnixStream> {
    std::os::unix::net::UnixStream::connect(endpoint)
}

#[cfg(not(unix))]
fn connect(endpoint: &str) -> io::Result<std::fs::File> {
    std::fs::OpenOptions::new().read(true).write(true).open(endpoint)
}

/// Connects to the daemon at `endpoint`, starting it detached with
/// `serve_args` when nothing answers, and waiting until it accepts.
///
/// # Errors
/// The daemon could not be started or never accepted within the guard.
pub fn exchange_or_start(endpoint: &str, serve_args: &[String], request: &Value) -> io::Result<Value> {
    // The connection that finds the daemon carries the request: a separate probe would take a
    // named pipe's only free instance, and the real connect would then find it busy.
    let stream = match connect_until(endpoint, Instant::now() + BUSY_GUARD, &is_busy) {
        Ok(stream) => stream,
        Err(_) => {
            start_detached(endpoint, serve_args)?;
            connect_until(endpoint, Instant::now() + START_GUARD, &|_| true).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("daemon did not start on {endpoint}: {error}"),
                )
            })?
        }
    };
    exchange_over(stream, request)
}

fn start_detached(endpoint: &str, serve_args: &[String]) -> io::Result<()> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--serve")
        .arg(endpoint)
        .args(serve_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    command.spawn().map(drop)
}

#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
fn detach(_command: &mut Command) {}

/// `--resume`: the user's reset, reading the daemon's 0600 token file.
///
/// # Errors
/// The token file is unreadable, the daemon is unreachable, or it refused.
pub fn resume(endpoint: &str) -> Result<Value, String> {
    let file = token_file(endpoint);
    let token =
        std::fs::read_to_string(&file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
    let request =
        json!({"jsonrpc": "2.0", "id": 1, "method": "stopPath.resume", "params": {"token": token.trim()}});
    let reply = exchange(endpoint, &request).map_err(|error| format!("{endpoint}: {error}"))?;
    match reply.get("error") {
        Some(error) => Err(format!("resume refused: {error}")),
        None => Ok(reply["result"].clone()),
    }
}
