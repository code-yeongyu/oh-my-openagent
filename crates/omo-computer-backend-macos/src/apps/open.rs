//! `apps.open(target, {activate?, reveal?})` on macOS. The options are read ONCE, before the
//! guard; `activate:true` and `reveal:true` are foreground verbs and need the lease. The
//! target resolves through the same sources as `apps.list()` before anything launches; the
//! launch never activates by default and the reply carries a pid only when `proc_pidpath`
//! proves the launched process lives inside the resolved bundle.

use omo_computer_core::apps::{resolve, APP_UNKNOWN};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::list::list;
use super::seam::AppsOs;

/// The options of one call, snapshotted before the guard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OpenOptions {
    pub activate: bool,
    pub reveal: bool,
}

/// What `apps.open` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Opened {
    /// Launched; `pid` is the handle, `None` when the pid is not proven inside the bundle.
    Launched { app_key: String, pid: Option<u32> },
    /// The bundle was revealed in the file viewer.
    Revealed { app_key: String },
}

/// `apps.open`.
///
/// # Errors
/// `ControlRequired{lease_missing}` for `activate`/`reveal` without the lease, the resolve
/// refusals (`InvalidTarget{app_unknown|ambiguous}`), or the launch's refusal; nothing is
/// launched on any of them.
pub fn open(
    os: &mut dyn AppsOs,
    target: &str,
    options: OpenOptions,
    lease: bool,
) -> BackendResult<Opened> {
    if (options.activate || options.reveal) && !lease {
        return Err(Refusal::new(
            EngineCode::ControlRequired,
            Reason::LeaseMissing,
        ));
    }
    let apps = list(os);
    let app = resolve(target, &apps)?;
    let app_key = app.app_key.clone();
    let bundle = app.path.clone().ok_or(APP_UNKNOWN)?;
    if options.reveal {
        return if os.reveal(&bundle) {
            Ok(Opened::Revealed { app_key })
        } else {
            Err(APP_UNKNOWN)
        };
    }
    let pid = os.launch(&bundle, options.activate)?;
    let inside = os
        .process_path(pid)
        .is_some_and(|path| path.starts_with(&format!("{}/", bundle.trim_end_matches('/'))));
    Ok(Opened::Launched {
        app_key,
        pid: inside.then_some(pid),
    })
}
