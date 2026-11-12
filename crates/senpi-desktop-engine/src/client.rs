//! The local client side of the `--serve` daemon: the default endpoint, one
//! request/reply exchange, a detached auto-start, and the user's `--resume`.

use std::io::{self, BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const START_GUARD: Duration = Duration::from_secs(10);
const BUSY_GUARD: Duration = Duration::from_secs(5);
const CONNECT_RETRY: Duration = Duration::from_millis(20);
const START_RETRY: Duration = Duration::from_millis(50);

/// `<runtime-dir>/senpi-desktop/<uid>.sock` in the per-user runtime directory
/// the machine-wide interaction lock also lives in
/// ([`senpi_desktop_session::user_runtime_dir`]); there is no temp-directory
/// fallback. Every connect then applies the endpoint directory rule, so a
/// directory someone else created is refused.
///
/// # Errors
/// The platform names no per-user runtime directory, or it cannot be created.
pub fn default_endpoint() -> io::Result<String> {
    if cfg!(windows) {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_owned());
        return Ok(format!(r"\\.\pipe\senpi-desktop-{user}"));
    }
    unix_endpoint()
}

#[cfg(unix)]
fn unix_endpoint() -> io::Result<String> {
    let dir = senpi_desktop_session::user_runtime_dir()?;
    Ok(dir.entry("sock").to_string_lossy().into_owned())
}

#[cfg(not(unix))]
fn unix_endpoint() -> io::Result<String> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "no unix socket endpoint on this platform"))
}

/// The resume token file beside `endpoint` (Windows: under the temp dir).
#[cfg(not(unix))]
pub fn token_file(endpoint: &str) -> std::path::PathBuf {
    let name = endpoint.rsplit('\\').next().unwrap_or("senpi-desktop");
    std::env::temp_dir().join(format!("{name}.resume"))
}

/// Sends one request and reads its reply line.
///
/// # Errors
/// The daemon is not reachable or its reply is not JSON.
pub fn exchange(endpoint: &str, request: &Value) -> io::Result<Value> {
    retry_reset_once(|| {
        let stream = connect_until(endpoint, Instant::now() + BUSY_GUARD, &is_busy)?;
        exchange_over(stream, request)
    })
}

/// A reset or broken pipe before the first byte from the daemon on a Unix
/// socket: a daemon that was exiting closed its listener with this connection
/// still unaccepted (T25-24), so no daemon read the request. Only a Unix socket
/// proves that. On Windows the named pipe is a `File`, and a daemon that read
/// and ran the request, then closed the pipe before replying (a crash, a failed
/// `serve_connection`), surfaces as the same `BrokenPipe`; a retry there could
/// run a click or typing twice, so it is never marked there.
#[derive(Debug)]
struct ResetBeforeReply(io::Error);

impl std::fmt::Display for ResetBeforeReply {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the daemon reset the connection before replying: {}", self.0)
    }
}

impl std::error::Error for ResetBeforeReply {}

/// Runs `attempt` again, once, when it failed with [`ResetBeforeReply`]. Any
/// other failure, a second reset, or a reset after a reply byte is returned.
fn retry_reset_once<T>(mut attempt: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    match attempt() {
        Err(error) if error.get_ref().is_some_and(|inner| inner.is::<ResetBeforeReply>()) => attempt(),
        outcome => outcome,
    }
}

/// A stream that counts the bytes read from it.
struct Counted<S> {
    inner: S,
    read: usize,
}

impl<S: io::Read> io::Read for Counted<S> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.read += read;
        Ok(read)
    }
}

impl<S: Write> Write for Counted<S> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Marks a reset or broken pipe as [`ResetBeforeReply`] while nothing was read,
/// on a Unix socket only.
fn before_reply(error: io::Error, read: usize) -> io::Error {
    if is_reset_before_reply(&error, read, cfg!(unix)) {
        io::Error::new(error.kind(), ResetBeforeReply(error))
    } else {
        error
    }
}

/// Whether `error` after `read` reply bytes proves no daemon read the request:
/// never off a `unix_socket` (see [`ResetBeforeReply`]); the platform picks it.
fn is_reset_before_reply(error: &io::Error, read: usize, unix_socket: bool) -> bool {
    unix_socket && read == 0 && matches!(error.kind(), io::ErrorKind::ConnectionReset | io::ErrorKind::BrokenPipe)
}

/// Writes `request` and returns the first reply line. Notifications of the
/// shared session (another client's audit or stop change) can arrive first
/// and are skipped.
fn exchange_over(stream: impl io::Read + Write, request: &Value) -> io::Result<Value> {
    let mut stream = Counted { inner: stream, read: 0 };
    // One write for the whole line: the daemon never sees part of a request.
    stream
        .write_all(format!("{request}\n").as_bytes())
        .map_err(|error| before_reply(error, 0))?;
    stream.flush().map_err(|error| before_reply(error, 0))?;
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| before_reply(error, reader.get_ref().read))?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "the daemon closed the connection before replying",
            ));
        }
        let message: Value = serde_json::from_str(&line).map_err(io::Error::other)?;
        if message.get("id").is_some() {
            return Ok(message);
        }
    }
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
            Err(error) if !refusal(&error) && retry(&error) && Instant::now() < deadline => {
                std::thread::sleep(CONNECT_RETRY);
            }
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
fn refusal(error: &io::Error) -> bool {
    crate::peer::is_refusal(error)
}

#[cfg(not(unix))]
const fn refusal(_error: &io::Error) -> bool {
    false
}

/// Connects through the checked endpoint directory, then refuses a socket
/// whose server does not run as this euid before writing a byte.
#[cfg(unix)]
fn connect(endpoint: &str) -> io::Result<std::os::unix::net::UnixStream> {
    connect_checked(endpoint, crate::peer::peer_euid)
}

#[cfg(unix)]
fn connect_checked(
    endpoint: &str,
    lookup: impl Fn(std::os::fd::RawFd) -> io::Result<u32>,
) -> io::Result<std::os::unix::net::UnixStream> {
    use std::os::fd::AsRawFd;

    let dir = crate::peer::EndpointDir::open(std::path::Path::new(endpoint))?;
    let stream = std::os::unix::net::UnixStream::connect(dir.socket())?;
    crate::peer::require_peer(stream.as_raw_fd(), crate::peer::euid(), lookup)?;
    Ok(stream)
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
    retry_reset_once(|| {
        // The connection that finds the daemon carries the request: a separate probe would take a
        // named pipe's only free instance, and the real connect would then find it busy.
        let stream = match connect_until(endpoint, Instant::now() + BUSY_GUARD, &is_busy) {
            Ok(stream) => stream,
            Err(error) if refusal(&error) => return Err(error),
            Err(_) => start_and_connect(endpoint, serve_args)?,
        };
        exchange_over(stream, request)
    })
}

/// Starts the daemon and connects once it accepts. A start that exits before
/// anything answers (refused the instance lock while a predecessor is still
/// idle-exiting, T25-24) is started again, until the start guard runs out.
fn start_and_connect(endpoint: &str, serve_args: &[String]) -> io::Result<Stream> {
    let deadline = Instant::now() + START_GUARD;
    let mut daemon = start_detached(endpoint, serve_args)?;
    loop {
        match connect(endpoint) {
            Ok(stream) => return Ok(stream),
            Err(error) if refusal(&error) => return Err(error),
            Err(error) if Instant::now() >= deadline => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("daemon did not start on {endpoint}: {error}"),
                ));
            }
            Err(_) => {
                if matches!(daemon.try_wait(), Ok(Some(_))) {
                    daemon = start_detached(endpoint, serve_args)?;
                }
                std::thread::sleep(START_RETRY);
            }
        }
    }
}

fn start_detached(endpoint: &str, serve_args: &[String]) -> io::Result<std::process::Child> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--serve")
        .arg(endpoint)
        .args(serve_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    command.spawn()
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
    let token = read_token(endpoint).map_err(|error| format!("cannot read the resume token of {endpoint}: {error}"))?;
    let request =
        json!({"jsonrpc": "2.0", "id": 1, "method": "stopPath.resume", "params": {"token": token.trim()}});
    let reply = exchange(endpoint, &request).map_err(|error| format!("{endpoint}: {error}"))?;
    match reply.get("error") {
        Some(error) => Err(format!("resume refused: {error}")),
        None => Ok(reply["result"].clone()),
    }
}

/// Reads the token beside the socket through the checked directory, never
/// through a symlink.
#[cfg(unix)]
fn read_token(endpoint: &str) -> io::Result<String> {
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;

    let dir = crate::peer::EndpointDir::open(std::path::Path::new(endpoint))?;
    let mut token = String::new();
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(dir.entry(&dir.sibling("resume")))?
        .read_to_string(&mut token)?;
    Ok(token)
}

#[cfg(not(unix))]
fn read_token(endpoint: &str) -> io::Result<String> {
    std::fs::read_to_string(token_file(endpoint))
}

#[cfg(test)]
#[path = "client_retry_tests.rs"]
mod retry_tests;

#[cfg(all(test, unix))]
#[path = "client_tests.rs"]
mod tests;
