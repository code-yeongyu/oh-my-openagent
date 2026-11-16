//! A scriptable EIS server on a real unix socket, speaking the ei protocol through `reis`'s
//! server half, so the crate's tests drive the real libei client against it. It plays the
//! compositor's part: one seat, a keyboard carrying the scripted XKB keymap, an absolute
//! pointer carrying the scripted regions, a button and a scroll device. Its log is the
//! independent observer every test reads: connections, refused clients, frames, held keys and
//! when a closed client's held keys were released.

use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::eis_client::Client;

/// One region the fake's absolute pointer announces, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FakeRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// How the fake treats clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Every client is served.
    Serve,
    /// The first client is dropped once its devices have been resumed for 200 ms; later
    /// clients are served.
    DropOnce,
    /// While one client is connected, a second one is refused (the libei socket of a
    /// compositor that admits one emulating client; the X2 SIGKILL leg's mode).
    SecondClientRefused,
    /// Once the first client is settled its socket is left unread for [`SLOW_READER_STALL`]
    /// (a compositor busy elsewhere) or until a second client connects; then it is read.
    SlowReader,
}

/// How long [`Mode::SlowReader`] leaves its first client unread.
pub const SLOW_READER_STALL: Duration = Duration::from_secs(2);

/// What the fake announces.
#[derive(Debug, Clone)]
pub struct Script {
    pub keymap: String,
    pub regions: Vec<FakeRegion>,
    pub mode: Mode,
    pub keyboard: bool,
}

/// What the fake saw: the observer every assertion reads.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Log {
    pub connections: u32,
    pub refused: u32,
    pub dropped: u32,
    pub frames: u32,
    /// `(evdev key, down)` in arrival order.
    pub keys: Vec<(u32, bool)>,
    /// Absolute motions in arrival order.
    pub motions: Vec<(f32, f32)>,
    /// `(button, down)` in arrival order.
    pub buttons: Vec<(u32, bool)>,
    /// The keys the current or last client holds down.
    pub held: Vec<u32>,
    /// When the last client's socket closed, and when the fake released what it held.
    pub closed_at: Option<Instant>,
    pub released_at: Option<Instant>,
    /// The keymap layouts the fake has fed, newest last.
    pub keymaps_fed: u32,
    /// How many times [`Mode::SlowReader`] stopped reading its client.
    pub stalls: u32,
}

/// A command to the server thread.
#[derive(Debug)]
pub(super) enum Command {
    Keymap(String),
    Group(u32),
    DropClients,
    Stop,
}

/// The running fake; dropping it stops the thread and removes the socket.
pub struct FakeEis {
    path: PathBuf,
    log: Arc<Mutex<Log>>,
    commands: Sender<Command>,
    thread: Option<JoinHandle<()>>,
}

impl FakeEis {
    /// Binds `dir/eis-fake` and starts serving `script`.
    ///
    /// # Errors
    /// The socket cannot be bound.
    pub fn start(dir: &Path, script: Script) -> std::io::Result<Self> {
        let path = dir.join("eis-fake");
        let listener = UnixListener::bind(&path)?;
        listener.set_nonblocking(true)?;
        let log = Arc::new(Mutex::new(Log::default()));
        let (commands, inbox) = mpsc::channel();
        let shared = Arc::clone(&log);
        let thread = std::thread::spawn(move || serve(&listener, &script, &shared, &inbox));
        Ok(Self {
            path,
            log,
            commands,
            thread: Some(thread),
        })
    }

    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.path
    }

    /// A snapshot of the log.
    #[must_use]
    pub fn log(&self) -> Log {
        self.log.lock().map(|log| log.clone()).unwrap_or_default()
    }

    /// Replaces the keyboard with one carrying `keymap` (the compositor's layout change).
    pub fn change_keymap(&self, keymap: &str) {
        self.send(Command::Keymap(keymap.to_owned()));
    }

    /// Sets the active group the keyboard's modifiers event reports.
    pub fn set_group(&self, group: u32) {
        self.send(Command::Group(group));
    }

    /// Closes every connected client's socket.
    pub fn drop_clients(&self) {
        self.send(Command::DropClients);
    }

    /// Waits until `done` holds on the log, for at most `within`.
    #[must_use]
    pub fn wait_for(&self, within: Duration, done: impl Fn(&Log) -> bool) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if done(&self.log()) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        done(&self.log())
    }

    fn send(&self, command: Command) {
        if self.commands.send(command).is_err() {
            eprintln!("fake EIS: the server thread has stopped");
        }
    }
}

impl Drop for FakeEis {
    fn drop(&mut self) {
        self.send(Command::Stop);
        if let Some(thread) = self.thread.take() {
            if thread.join().is_err() {
                eprintln!("fake EIS: the server thread panicked");
            }
        }
        if let Err(error) = std::fs::remove_file(&self.path) {
            eprintln!("fake EIS: {}: {error}", self.path.display());
        }
    }
}

fn serve(
    listener: &UnixListener,
    script: &Script,
    log: &Arc<Mutex<Log>>,
    inbox: &Receiver<Command>,
) {
    let mut clients: Vec<Client> = Vec::new();
    let mut script = script.clone();
    let mut dropped_once = false;
    let mut stall_until: Option<Instant> = None;
    loop {
        for command in inbox.try_iter() {
            match command {
                Command::Stop => return,
                Command::DropClients => clients.clear(),
                Command::Keymap(keymap) => {
                    script.keymap = keymap;
                    for client in &mut clients {
                        client.replace_keyboard(&script, log);
                    }
                }
                Command::Group(group) => {
                    for client in &clients {
                        client.send_group(group);
                    }
                }
            }
        }
        if let Ok((stream, _)) = listener.accept() {
            accept(stream, &script, &mut clients, log);
        }
        if script.mode == Mode::SlowReader
            && stall_until.is_none()
            && clients.iter().any(Client::settled)
        {
            stall_until = Some(Instant::now() + SLOW_READER_STALL);
            note(log, |log| log.stalls += 1);
        }
        let stalled = clients.len() == 1 && stall_until.is_some_and(|until| Instant::now() < until);
        if !stalled {
            clients.retain_mut(|client| client.pump(&script, log));
        }
        if script.mode == Mode::DropOnce && !dropped_once && clients.iter().any(Client::settled) {
            dropped_once = true;
            clients.clear();
            note(log, |log| log.dropped += 1);
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn accept(
    stream: std::os::unix::net::UnixStream,
    script: &Script,
    clients: &mut Vec<Client>,
    log: &Arc<Mutex<Log>>,
) {
    if script.mode == Mode::SecondClientRefused && !clients.is_empty() {
        note(log, |log| log.refused += 1);
        return;
    }
    match Client::accept(stream) {
        Ok(client) => {
            note(log, |log| log.connections += 1);
            clients.push(client);
        }
        Err(error) => eprintln!("fake EIS: accept: {error}"),
    }
}

/// Applies `change` to the shared log.
pub(super) fn note(log: &Arc<Mutex<Log>>, change: impl FnOnce(&mut Log)) {
    match log.lock() {
        Ok(mut guard) => change(&mut guard),
        Err(poisoned) => change(&mut poisoned.into_inner()),
    }
}
