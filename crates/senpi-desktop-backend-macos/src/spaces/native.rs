//! [`SpaceServer`] over the runtime-resolved SkyLight Space functions, and the
//! two entry points the backend uses.

use std::ptr::NonNull;
use std::thread;
use std::time::{Duration, Instant};

use objc2_core_foundation::{CFArray, CFNumber, CFRetained, CFString, CFType};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::mover::{self, FrontContext, SpaceId, SpaceServer};
use crate::skylight::{self, SpaceSpi};

/// All Spaces a window belongs to (`kCGSAllSpacesMask`).
const ALL_SPACES: i32 = 7;

/// Moves window `id` into the user's current Space (see [`mover::bring`]).
///
/// # Errors
/// `SpaceUnsupported` when this macOS lacks a Space function, else the
/// algorithm's refusal.
pub(crate) fn bring_to_current_space(id: &str, check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<()> {
    mover::bring(&NativeSpaces::connect(skylight::spaces()?)?, id, check_stop)
}

/// Whether `pid` has a normal window on a Space no display shows now, which
/// on-screen window lists leave out. `None` when the window list or a
/// window's Space membership cannot be read.
pub(crate) fn window_on_another_space(pid: libc::pid_t) -> Option<bool> {
    let spaces = NativeSpaces::connect(skylight::spaces_if_available()?).ok()?;
    let pid = u32::try_from(pid).ok()?;
    let windows: Vec<u32> = crate::focus::window_info()
        .ok()?
        .into_iter()
        .filter(|window| window.pid == pid && window.layer == 0)
        .map(|window| window.window_number)
        .collect();
    // With "Displays have separate Spaces", each display shows its own.
    let shown: Vec<SpaceId> = spaces.display_spaces().ok()?.into_iter().map(|(_, space)| space).collect();
    mover::on_another_space(&shown, windows.iter().map(|&wid| spaces.window_spaces(wid)))
}

struct NativeSpaces {
    spi: &'static SpaceSpi,
    connection: i32,
}

fn denied(message: impl Into<String>) -> DesktopError {
    DesktopError::space_move_denied(message)
}

impl NativeSpaces {
    fn connect(spi: &'static SpaceSpi) -> CoreResult<Self> {
        // SAFETY: The runtime symbol has the exact no-argument connection ABI.
        let connection = unsafe { (spi.connection)() };
        if connection <= 0 {
            return Err(denied("WindowServer did not provide a valid connection for Space movement"));
        }
        Ok(Self { spi, connection })
    }

    /// The raw membership entries of `wid`; `None` entries are not numbers.
    fn copy_window_spaces(&self, wid: u32) -> CoreResult<Vec<Option<u64>>> {
        let number = CFNumber::new_i64(i64::from(wid));
        let window = CFArray::from_objects(&[&*number]);
        // SAFETY: The window array stays alive for the call; the mask selects
        // every Space.
        let raw = unsafe { (self.spi.copy_spaces)(self.connection, ALL_SPACES, window.as_opaque()) };
        let spaces = retain_array(raw, "window Space memberships")?;
        Ok(spaces
            .iter()
            .map(|space| {
                space
                    .downcast_ref::<CFNumber>()
                    .and_then(CFNumber::as_i64)
                    .and_then(|id| u64::try_from(id).ok())
            })
            .collect())
    }

    /// `wid`'s memberships, empty for none; `None` when WindowServer does not
    /// say.
    fn window_spaces(&self, wid: u32) -> Option<Vec<SpaceId>> {
        self.copy_window_spaces(wid)
            .ok()?
            .into_iter()
            .map(|space| space.map(SpaceId))
            .collect()
    }
}

impl SpaceServer for NativeSpaces {
    fn owner_pid(&self, wid: u32) -> CoreResult<libc::pid_t> {
        let mut owner = 0;
        let mut pid = 0;
        // SAFETY: Both outputs are initialized writable scalars; the second
        // lookup runs only when WindowServer returned the owner connection.
        let valid = unsafe {
            (self.spi.window_owner)(self.connection, wid, &mut owner) == 0
                && (self.spi.connection_pid)(owner, &mut pid) == 0
        };
        if !valid || pid <= 0 {
            return Err(DesktopError::window_not_found(format!(
                "window {wid} has no identifiable owning process; Space move refused"
            )));
        }
        Ok(pid)
    }

    fn active_space(&self) -> CoreResult<SpaceId> {
        // SAFETY: The connection is live and the symbol's ABI was resolved.
        match unsafe { (self.spi.active)(self.connection) } {
            0 => Err(denied(
                "WindowServer did not identify the current Space; retry after Mission Control or a Space transition \
                 finishes",
            )),
            space => Ok(SpaceId(space)),
        }
    }

    fn space_type(&self, space: SpaceId) -> i32 {
        // SAFETY: The connection and the Space id were read from WindowServer.
        unsafe { (self.spi.space_type)(self.connection, space.0) }
    }

    fn memberships(&self, wid: u32) -> CoreResult<Vec<SpaceId>> {
        let mut spaces = self
            .copy_window_spaces(wid)?
            .into_iter()
            .map(|space| {
                space
                    .filter(|id| *id != 0)
                    .map(SpaceId)
                    .ok_or_else(|| denied("WindowServer returned malformed Space membership; move cannot be verified"))
            })
            .collect::<CoreResult<Vec<_>>>()?;
        if spaces.is_empty() {
            return Err(denied(
                "the target window has no readable Space membership; it may have closed or be system-managed",
            ));
        }
        spaces.sort_unstable();
        spaces.dedup();
        Ok(spaces)
    }

    fn display_spaces(&self) -> CoreResult<Vec<(String, SpaceId)>> {
        // SAFETY: The live connection is the only argument to this Copy-rule API.
        let displays = retain_array(unsafe { (self.spi.copy_displays)(self.connection) }, "managed displays")?;
        let mut result = Vec::with_capacity(displays.len());
        for display in displays.iter() {
            let display = display
                .downcast_ref::<CFString>()
                .ok_or_else(|| denied("WindowServer returned malformed managed displays"))?;
            // SAFETY: The retained display identifier and the connection
            // outlive the call.
            let space = unsafe { (self.spi.display_space)(self.connection, display) };
            if space == 0 {
                return Err(denied("cannot establish the current Space for every display"));
            }
            result.push((display.to_string(), SpaceId(space)));
        }
        if result.is_empty() {
            return Err(denied("WindowServer returned no managed displays"));
        }
        result.sort_unstable();
        Ok(result)
    }

    fn move_window(&self, wid: u32, space: SpaceId) {
        let number = CFNumber::new_i64(i64::from(wid));
        let windows = CFArray::from_objects(&[&*number]);
        // SAFETY: The array holds exactly one retained CFNumber window id; the
        // runtime-resolved function has its void-returning native ABI.
        unsafe { (self.spi.move_windows)(self.connection, windows.as_opaque(), space.0) };
    }

    fn front_context(&self) -> Option<FrontContext> {
        let pid = skylight::front_pid()?;
        let app = crate::ax::element::create_application(pid).ok()?;
        crate::ax::element::set_timeout(&app).ok()?;
        let window = ["AXFocusedWindow", "AXMainWindow"].into_iter().find_map(|attribute| {
            crate::ax::element::window_id(&*crate::ax::element::copy_element(&app, attribute)?)
        })?;
        Some(FrontContext { pid, window })
    }

    fn with_background_guard(&self, pid: libc::pid_t, action: &mut dyn FnMut() -> CoreResult<()>) -> CoreResult<()> {
        super::guard::with_background_guard(pid, action)
    }

    fn now(&self) -> Instant {
        Instant::now()
    }

    fn wait(&self, duration: Duration) {
        thread::sleep(duration);
    }
}

fn retain_array(raw: *const CFArray, operation: &str) -> CoreResult<CFRetained<CFArray<CFType>>> {
    let pointer = NonNull::new(raw.cast_mut())
        .ok_or_else(|| denied(format!("WindowServer returned no {operation}; cannot verify Space movement")))?;
    // SAFETY: The callers pass a Copy-rule CFArray returned at +1.
    let array = unsafe { CFRetained::from_raw(pointer) };
    // SAFETY: These WindowServer copy APIs return arrays of CF objects only.
    Ok(unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(array) })
}
