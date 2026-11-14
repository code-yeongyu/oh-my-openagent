//! The foreground lease: ONE `ControlSlot` per machine, single holder, never stolen
//! (`InputBusy{holder}`), stored under the per-uid RUNTIME root so every engine session of the
//! uid sees the same slot. A holder is live while its session token is locked: a session that
//! closes, or a process that dies, frees the slot without any timer.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The directory of the machine-wide lease and reservation records under the RUNTIME root.
pub const LEASE_DIR: &str = "leases";
const SLOT_FILE: &str = "control-slot.json";

/// Who holds a lease or a reservation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Holder {
    pub session_id: String,
    pub agent: String,
}

/// A session's liveness on the machine: an exclusive lock on `sessions/<id>.lock`, held for the
/// session's life and released by the OS when the process dies.
#[derive(Debug)]
pub struct SessionToken {
    holder: Holder,
    dir: Option<PathBuf>,
    _lock: Option<File>,
}

impl SessionToken {
    /// A token whose records live in this process only.
    #[must_use]
    pub const fn in_memory(holder: Holder) -> Self {
        Self {
            holder,
            dir: None,
            _lock: None,
        }
    }

    /// # Errors
    /// The token file cannot be created or locked.
    pub fn under(runtime: &Path, holder: Holder) -> io::Result<Self> {
        let dir = runtime.join(LEASE_DIR);
        fs::create_dir_all(dir.join("sessions"))?;
        let file = open(&token_path(&dir, &holder.session_id))?;
        file.try_lock().map_err(io::Error::from)?;
        Ok(Self {
            holder,
            dir: Some(dir),
            _lock: Some(file),
        })
    }

    #[must_use]
    pub const fn holder(&self) -> &Holder {
        &self.holder
    }

    #[must_use]
    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }
}

fn token_path(dir: &Path, session_id: &str) -> PathBuf {
    dir.join("sessions").join(format!("{session_id}.lock"))
}

fn open(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Whether the session that wrote a record still runs: its token is locked by someone.
pub(crate) fn is_live(dir: &Path, holder: &Holder) -> bool {
    let Ok(file) = open(&token_path(dir, &holder.session_id)) else {
        return false;
    };
    matches!(file.try_lock(), Err(TryLockError::WouldBlock))
}

/// Reads a holder record; an unreadable record is no holder.
pub(crate) fn read_holder(path: &Path) -> Option<Holder> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The machine's foreground slot.
#[derive(Debug, Default)]
pub struct ControlSlot {
    memory: Option<Holder>,
}

impl ControlSlot {
    /// The holder, when a live session holds the slot.
    #[must_use]
    pub fn holder(&self, token: &SessionToken) -> Option<Holder> {
        match token.dir() {
            None => self.memory.clone(),
            Some(dir) => read_holder(&dir.join(SLOT_FILE)).filter(|h| is_live(dir, h)),
        }
    }

    #[must_use]
    pub fn is_mine(&self, token: &SessionToken) -> bool {
        self.holder(token).is_some_and(|h| h == *token.holder())
    }

    /// Takes the slot. A held slot is never stolen and never taken twice.
    ///
    /// # Errors
    /// The holder, when any live session (this one included) holds it.
    pub fn acquire(&mut self, token: &SessionToken) -> Result<(), Holder> {
        if let Some(holder) = self.holder(token) {
            return Err(holder);
        }
        match token.dir() {
            None => self.memory = Some(token.holder().clone()),
            Some(dir) => {
                // Check-and-replace under one machine-wide lock: a record is removed only when the
                // holder read INSIDE the lock is gone, so no racer removes another's fresh record.
                let _locked = dir_lock(dir).map_err(|_| token.holder().clone())?;
                if let Some(holder) = self.holder(token) {
                    return Err(holder);
                }
                let path = dir.join(SLOT_FILE);
                let _ = fs::remove_file(&path);
                let record = serde_json::to_vec(token.holder()).unwrap_or_default();
                write_new(&path, &record).map_err(|_| {
                    read_holder(&path).unwrap_or_else(|| token.holder().clone())
                })?;
            }
        }
        Ok(())
    }

    /// Ends this session's lease; another session's slot is left alone.
    pub fn release(&mut self, token: &SessionToken) {
        if !self.is_mine(token) {
            return;
        }
        match token.dir() {
            None => self.memory = None,
            Some(dir) => {
                let _ = fs::remove_file(dir.join(SLOT_FILE));
            }
        }
    }
}

/// The machine-wide lock every check-then-write on the lease records takes (released on drop).
///
/// # Errors
/// The lock file cannot be opened or locked.
pub(crate) fn dir_lock(dir: &Path) -> io::Result<File> {
    let file = open(&dir.join("records.lock"))?;
    file.lock()?;
    Ok(file)
}

/// Replaces `path` with `bytes` atomically (0600): readers see the old or the new record, never none.
pub(crate) fn replace(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let _ = fs::remove_file(&tmp);
    write_new(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// Creates `path` exclusively with `bytes` (0600).
pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)
}

#[cfg(test)]
mod race_tests {
    use std::sync::{Arc, Barrier};

    use super::{ControlSlot, Holder, SessionToken};

    /// Review M2 of #13346: sessions in different processes that all see no live holder must not
    /// remove each other's fresh record. Exactly one acquire wins, every round.
    #[test]
    fn concurrent_acquires_on_one_runtime_root_yield_exactly_one_holder() {
        for round in 0..50 {
            let dir = tempfile::tempdir().expect("tempdir");
            let barrier = Arc::new(Barrier::new(16));
            let winners: Vec<bool> = (0..16)
                .map(|i| {
                    let (root, barrier) = (dir.path().to_owned(), barrier.clone());
                    std::thread::spawn(move || {
                        let holder = Holder { session_id: format!("s{round}-{i}"), agent: "a".to_owned() };
                        let token = SessionToken::under(&root, holder).expect("token");
                        barrier.wait();
                        let won = ControlSlot::default().acquire(&token).is_ok();
                        // Keep the token (its liveness) until every racer has finished.
                        (won, token)
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().expect("thread"))
                // Collected whole first: every token stays live until all racers have finished.
                .collect::<Vec<_>>()
                .into_iter()
                .map(|(won, _token)| won)
                .collect();
            assert_eq!(winners.iter().filter(|w| **w).count(), 1, "round {round}: {winners:?}");
        }
    }

    /// The same race on a window reservation (review M2): exactly one session takes the window.
    #[test]
    fn concurrent_window_admits_on_one_runtime_root_yield_exactly_one_holder() {
        for round in 0..50 {
            let dir = tempfile::tempdir().expect("tempdir");
            let barrier = Arc::new(Barrier::new(16));
            let results = (0..16)
                .map(|i| {
                    let (root, barrier) = (dir.path().to_owned(), barrier.clone());
                    std::thread::spawn(move || {
                        let holder = Holder { session_id: format!("w{round}-{i}"), agent: "a".to_owned() };
                        let token = SessionToken::under(&root, holder).expect("token");
                        barrier.wait();
                        let won = crate::reservation::Reservations::default().admit(&token, &["7".to_owned()], 0).is_ok();
                        (won, token)
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().expect("thread"))
                .collect::<Vec<_>>();
            let winners: Vec<bool> = results.iter().map(|(won, _)| *won).collect();
            assert_eq!(winners.iter().filter(|w| **w).count(), 1, "round {round}: {winners:?}");
        }
    }

    /// Review L4 at a07dff9 (R70cl): when the machine-wide record lock cannot be taken, a window
    /// reservation is refused (fail closed, as the control slot), never taken unlocked.
    #[test]
    fn a_window_admit_whose_lock_cannot_be_taken_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let holder = Holder { session_id: "l4".to_owned(), agent: "a".to_owned() };
        let token = SessionToken::under(dir.path(), holder).expect("token");
        let runtime = token.dir().expect("a machine-wide token").to_owned();
        std::fs::create_dir_all(runtime.join("records.lock")).expect("a lock path that cannot be opened");
        let refused = crate::reservation::Reservations::default().admit(&token, &["7".to_owned()], 0);
        assert!(refused.is_err(), "no reservation is taken without the lock");
    }

    /// Review L4: release and report run under the same lock as admit, so a session whose
    /// reservation expired never deletes or overwrites the fresh record another session took.
    #[test]
    fn release_and_report_never_undo_another_sessions_locked_admit() {
        use crate::reservation::Reservations;
        let window = ["7".to_owned()];
        for round in 0..300 {
            let dir = tempfile::tempdir().expect("tempdir");
            let make = |name: &str| {
                SessionToken::under(dir.path(), Holder { session_id: format!("{name}{round}"), agent: "a".to_owned() }).expect("token")
            };
            let (a, b, c) = (make("a"), make("b"), make("c"));
            let mut mine = Reservations::default();
            mine.admit(&a, &window, 0).expect("a takes the window");
            mine.report(&a, &window, 0);
            let barrier = Arc::new(Barrier::new(2));
            let (late, racer) = (barrier.clone(), barrier);
            let after = 20_000;
            let (a, b, w) = (&a, &b, &window);
            let ended = std::thread::scope(|scope| {
                let old = scope.spawn(move || {
                    late.wait();
                    if round % 2 == 0 {
                        mine.release(a, "7");
                    } else {
                        mine.report(a, w, after);
                    }
                });
                let new = scope.spawn(move || {
                    racer.wait();
                    Reservations::default().admit(b, w, after).is_ok()
                });
                old.join().expect("old");
                new.join().expect("new")
            });
            if ended {
                let holder = Reservations::default().check(&c, &window, after).err().map(|busy| busy.holder.session_id);
                assert_eq!(holder, Some(format!("b{round}")), "round {round}: b's fresh record survives");
            }
        }
    }
}
