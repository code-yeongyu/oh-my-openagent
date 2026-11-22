//! The machine-wide `InteractionLock`: one user's desktop engines never
//! interleave their input, whichever process they run in.
//!
//! The process-wide transaction mutex (`mutate.rs`) serializes the sessions
//! of one engine; this lock serializes the engines of one user. It lives in
//! the per-user runtime directory, `<runtime-dir>/senpi-desktop/<uid>.lock`,
//! resolved by [`user_runtime_dir`] (the default daemon endpoint uses the
//! same resolver): Linux `$XDG_RUNTIME_DIR` (else `/run/user/<uid>`), macOS
//! `confstr(_CS_DARWIN_USER_TEMP_DIR)` (never `$TMPDIR`, which differs per
//! launch context). Windows uses a mutex named with the user's SID. There is
//! no fallback to the shared temp directory: an unusable location refuses the
//! request with a structured error and sends no input.
//!
//! Background exec holds it for the dispatch only; a foreground transaction
//! holds it from the focus/cursor capture through the action to the restore.
//! The admission waits (stop path, user intervention) run before it is taken,
//! and the action resolves its target again inside it. A lock another process
//! holds past [`WAIT_BUDGET`] answers `InputBusy`: nothing was sent, and the
//! request may be retried once that process is done.

use std::fs::{File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

/// How long a request waits on another process's transaction before it is
/// refused `InputBusy`.
pub(crate) const WAIT_BUDGET: Duration = Duration::from_secs(2);
/// How often a held lock is retried; stop and cancellation are checked as often.
const POLL: Duration = Duration::from_millis(2);
/// The directory under the per-user runtime directory.
const DIR_NAME: &str = "senpi-desktop";

/// A shared lock directory for fake-backend engines (tests). The fake posts
/// nothing to the real desktop, so without it a fake engine takes only the
/// process-wide lock; real backends ignore it and always use the fixed rule.
pub const FAKE_RUNTIME_DIR_ENV: &str = "SENPI_DESKTOP_FAKE_RUNTIME_DIR";

/// This user's private engine directory: `<runtime-dir>/senpi-desktop`,
/// created 0700 and owned by the current user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserRuntimeDir {
    /// `<runtime-dir>/senpi-desktop`.
    pub path: PathBuf,
    /// The owner's uid, which names the files in it.
    pub owner: u32,
}

impl UserRuntimeDir {
    /// `<path>/<owner>.<extension>`: `sock` for the daemon, `lock` for this lock.
    #[must_use]
    pub fn entry(&self, extension: &str) -> PathBuf {
        self.path.join(format!("{}.{extension}", self.owner))
    }

    /// `<base>/senpi-desktop`, created 0700; refused when another user owns it.
    fn under(base: &Path) -> io::Result<Self> {
        let path = base.join(DIR_NAME);
        let owner = private_dir(&path)?;
        Ok(Self { path, owner })
    }
}

/// The per-user runtime directory every engine of this user agrees on.
///
/// # Errors
/// The platform names no per-user runtime directory, or it cannot be created
/// or belongs to another user. There is no temp-directory fallback.
#[cfg(unix)]
pub fn user_runtime_dir() -> io::Result<UserRuntimeDir> {
    UserRuntimeDir::under(&platform_base()?)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_base() -> io::Result<PathBuf> {
    // SAFETY: getuid takes no arguments and cannot fail.
    let uid = unsafe { libc::getuid() };
    linux_base(std::env::var_os("XDG_RUNTIME_DIR"), uid, Path::is_dir)
}

/// `$XDG_RUNTIME_DIR` when it is an absolute path, else `/run/user/<uid>`
/// when that directory exists.
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn linux_base(xdg: Option<std::ffi::OsString>, uid: u32, is_dir: impl Fn(&Path) -> bool) -> io::Result<PathBuf> {
    if let Some(xdg) = xdg.map(PathBuf::from).filter(|dir| dir.is_absolute()) {
        return Ok(xdg);
    }
    let fallback = PathBuf::from(format!("/run/user/{uid}"));
    if is_dir(&fallback) {
        return Ok(fallback);
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "no per-user runtime directory: XDG_RUNTIME_DIR is unset (or relative) and /run/user/<uid> does not \
         exist; the engine never falls back to the shared temp directory",
    ))
}

/// `confstr(_CS_DARWIN_USER_TEMP_DIR)`: the per-user directory launchd
/// assigns, the same in every launch context of the user.
#[cfg(target_os = "macos")]
fn platform_base() -> io::Result<PathBuf> {
    use std::os::unix::ffi::OsStrExt;

    let mut buffer = vec![0_u8; 1024];
    loop {
        // SAFETY: the buffer is writable for its whole length, which is passed.
        let needed = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buffer.as_mut_ptr().cast(), buffer.len()) };
        if needed == 0 {
            return Err(io::Error::other(format!(
                "confstr(_CS_DARWIN_USER_TEMP_DIR) failed: {}",
                io::Error::last_os_error()
            )));
        }
        if needed <= buffer.len() {
            let text = std::ffi::CStr::from_bytes_until_nul(&buffer).map_err(io::Error::other)?;
            return Ok(PathBuf::from(std::ffi::OsStr::from_bytes(text.to_bytes())));
        }
        buffer.resize(needed, 0);
    }
}

#[cfg(unix)]
fn private_dir(dir: &Path) -> io::Result<u32> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};

    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let owner = std::fs::metadata(dir)?.uid();
    // SAFETY: getuid takes no arguments and cannot fail.
    let uid = unsafe { libc::getuid() };
    if owner != uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} belongs to uid {owner}, not to this user ({uid})", dir.display()),
        ));
    }
    Ok(owner)
}

#[cfg(not(unix))]
fn private_dir(dir: &Path) -> io::Result<u32> {
    std::fs::create_dir_all(dir).map(|()| 0)
}

/// Where the lock lives.
#[derive(Debug, Default)]
enum Location {
    /// Only the process-wide transaction mutex (sessions built in tests).
    #[default]
    ProcessOnly,
    /// The platform rule; a fake backend joins only through
    /// [`FAKE_RUNTIME_DIR_ENV`].
    UserRuntime,
    /// `<dir>/senpi-desktop/<uid>.lock`, whatever the backend.
    #[cfg_attr(not(test), allow(dead_code, reason = "only tests name an explicit directory"))]
    Dir(PathBuf),
}

/// Told `true` once the lock is taken and `false` as it is released.
#[cfg(test)]
type Observer = Arc<dyn Fn(bool) + Send + Sync>;

/// The machine-wide input lock of one control slot.
#[derive(Default)]
pub struct InteractionLock {
    location: Location,
    /// Told `true` once the lock is taken and `false` as it is released.
    #[cfg(test)]
    pub(crate) observer: parking_lot::Mutex<Option<Observer>>,
}

impl std::fmt::Debug for InteractionLock {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("InteractionLock").field("location", &self.location).finish_non_exhaustive()
    }
}

/// What the location resolves to for one acquisition.
enum Resolved {
    File(PathBuf),
    #[cfg(windows)]
    Mutex(Vec<u16>),
}

impl InteractionLock {
    /// The platform rule: what the engine's process-wide slot uses.
    pub(crate) fn user_runtime() -> Self {
        Self {
            location: Location::UserRuntime,
            #[cfg(test)]
            observer: parking_lot::Mutex::default(),
        }
    }

    /// An explicit directory shared by every lock naming it.
    #[cfg(test)]
    pub(crate) fn at(dir: PathBuf) -> Self {
        Self {
            location: Location::Dir(dir),
            ..Self::default()
        }
    }

    fn resolve(&self, fake_backend: bool) -> io::Result<Option<Resolved>> {
        let file = |base: &Path| UserRuntimeDir::under(base).map(|dir| Some(Resolved::File(dir.entry("lock"))));
        match &self.location {
            Location::ProcessOnly => Ok(None),
            Location::Dir(dir) => file(dir),
            Location::UserRuntime if fake_backend => match std::env::var_os(FAKE_RUNTIME_DIR_ENV) {
                Some(dir) if !dir.is_empty() => file(Path::new(&dir)),
                _ => Ok(None),
            },
            Location::UserRuntime => platform_lock(),
        }
    }

    /// Takes the lock, retrying while another process holds it. `interrupted`
    /// is asked between attempts and ends the wait with its error (a stop or
    /// a cancellation); `None` means this slot takes no machine-wide lock.
    ///
    /// # Errors
    /// `interrupted`'s error, `InputBusy` past [`WAIT_BUDGET`], or
    /// `TransactionFailed` when the lock location is unusable.
    pub(crate) fn acquire(
        &self,
        fake_backend: bool,
        interrupted: &dyn Fn() -> Option<DesktopError>,
    ) -> CoreResult<Option<Held>> {
        let unusable = |what: String, error: io::Error| {
            DesktopError::new(
                ErrorCode::TransactionFailed,
                format!("no input was sent: the machine-wide interaction lock {what} is unusable: {error}"),
            )
        };
        let Some(resolved) = self.resolve(fake_backend).map_err(|error| unusable("directory".to_owned(), error))? else {
            return Ok(None);
        };
        let started = Instant::now();
        loop {
            let attempt = match &resolved {
                Resolved::File(path) => try_file(path).map_err(|error| unusable(path.display().to_string(), error))?,
                #[cfg(windows)]
                Resolved::Mutex(name) => windows::try_mutex(name).map_err(|error| unusable("mutex".to_owned(), error))?,
            };
            if let Some(held) = attempt {
                #[cfg(test)]
                let held = self.observed(held);
                return Ok(Some(held));
            }
            if let Some(error) = interrupted() {
                return Err(error);
            }
            if started.elapsed() >= WAIT_BUDGET {
                return Err(DesktopError::input_busy(format!(
                    "another desktop engine of this user is sending input (the machine-wide interaction lock was \
                     held for over {} ms); no input was sent, retry once it is done",
                    WAIT_BUDGET.as_millis()
                )));
            }
            std::thread::sleep(POLL);
        }
    }
}

#[cfg(test)]
impl InteractionLock {
    fn observed(&self, mut held: Held) -> Held {
        held.observer = self.observer.lock().clone();
        if let Some(observer) = &held.observer {
            observer(true);
        }
        held
    }
}

/// The lock while it is held; dropping it releases the lock.
pub(crate) struct Held {
    _file: Option<File>,
    #[cfg(windows)]
    _mutex: Option<windows::OwnedMutex>,
    #[cfg(test)]
    observer: Option<Observer>,
}

#[cfg(test)]
impl Drop for Held {
    fn drop(&mut self) {
        if let Some(observer) = &self.observer {
            observer(false);
        }
    }
}

fn held_file(file: File) -> Held {
    Held {
        _file: Some(file),
        #[cfg(windows)]
        _mutex: None,
        #[cfg(test)]
        observer: None,
    }
}

/// One non-blocking attempt on the lock file; `None` while another holds it.
fn try_file(path: &Path) -> io::Result<Option<Held>> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let file = options.open(path)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(held_file(file))),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

#[cfg(unix)]
fn platform_lock() -> io::Result<Option<Resolved>> {
    user_runtime_dir().map(|dir| Some(Resolved::File(dir.entry("lock"))))
}

#[cfg(windows)]
fn platform_lock() -> io::Result<Option<Resolved>> {
    let name = format!("Global\\senpi-desktop-{}", windows::user_sid()?);
    Ok(Some(Resolved::Mutex(name.encode_utf16().chain(Some(0)).collect())))
}

#[cfg(not(any(unix, windows)))]
fn platform_lock() -> io::Result<Option<Resolved>> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "no per-user runtime directory on this platform"))
}

/// The SID-named mutex: machine-wide, one per user.
#[cfg(windows)]
mod windows {
    use std::io;

    use windows_sys::Win32::Foundation::{
        CloseHandle, LocalFree, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{
        CreateMutexW, GetCurrentProcess, OpenProcessToken, ReleaseMutex, WaitForSingleObject,
    };

    use super::Held;

    /// A mutex this thread owns; released and closed on drop, on the
    /// session thread that took it.
    pub(super) struct OwnedMutex(HANDLE);

    impl Drop for OwnedMutex {
        fn drop(&mut self) {
            // SAFETY: the handle is a mutex this thread owns and has not closed.
            unsafe {
                ReleaseMutex(self.0);
                CloseHandle(self.0);
            }
        }
    }

    /// One non-blocking attempt on the named mutex. An abandoned mutex (its
    /// holder died mid-transaction) is ours now.
    pub(super) fn try_mutex(name: &[u16]) -> io::Result<Option<Held>> {
        // SAFETY: `name` is NUL-terminated UTF-16; a null attribute pointer is allowed.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `handle` is the mutex just opened.
        match unsafe { WaitForSingleObject(handle, 0) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(Some(Held {
                _file: None,
                _mutex: Some(OwnedMutex(handle)),
                #[cfg(test)]
                observer: None,
            })),
            outcome => {
                let error = io::Error::last_os_error();
                // SAFETY: the handle is open and not owned by this thread.
                unsafe { CloseHandle(handle) };
                if outcome == WAIT_TIMEOUT {
                    Ok(None)
                } else {
                    Err(error)
                }
            }
        }
    }

    /// The current user's SID as text (`S-1-5-21-...`).
    pub(super) fn user_sid() -> io::Result<String> {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: the pseudo handle needs no closing; `token` receives the opened token.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let sid = token_user_sid(token);
        // SAFETY: the token was opened above.
        unsafe { CloseHandle(token) };
        sid
    }

    fn token_user_sid(token: HANDLE) -> io::Result<String> {
        let mut needed = 0_u32;
        // SAFETY: a null buffer of length 0 only asks for the needed size.
        unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed) };
        // u64 words keep TOKEN_USER's pointer alignment.
        let mut buffer = vec![0_u64; (needed as usize).div_ceil(8).max(1)];
        let length = u32::try_from(buffer.len() * 8).map_err(io::Error::other)?;
        // SAFETY: the buffer is writable for `length` bytes.
        if unsafe { GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), length, &mut needed) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the call filled the buffer with a TOKEN_USER.
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut text: windows_sys::core::PWSTR = std::ptr::null_mut();
        // SAFETY: the SID points into the buffer, which outlives this call.
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `text` is a NUL-terminated string the call allocated.
        let sid = unsafe {
            let length = (0..).take_while(|&index| *text.add(index) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
        };
        // SAFETY: LocalFree releases the string ConvertSidToStringSidW allocated.
        unsafe { LocalFree(text.cast()) };
        Ok(sid)
    }
}

#[cfg(test)]
mod tests;
