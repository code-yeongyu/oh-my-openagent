//! Process lookups of the AX server: the running process of a bundle id and whether a
//! process is an Electron app.

use crate::capture::os::process;

/// Every pid of the machine (`proc_listallpids`).
fn all_pids() -> Vec<u32> {
    // SAFETY: a null buffer asks for the count.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let mut pids = vec![0i32; usize::try_from(count).unwrap_or(0) + 64];
    let bytes = i32::try_from(pids.len() * std::mem::size_of::<i32>()).unwrap_or(i32::MAX);
    // SAFETY: `pids` holds `bytes` bytes.
    let filled = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    pids.truncate(usize::try_from(filled).unwrap_or(0));
    pids.into_iter()
        .filter_map(|p| u32::try_from(p).ok())
        .filter(|p| *p > 0)
        .collect()
}

/// The running process whose application bundle has `bundle` as its id.
pub fn pid_of_bundle(bundle: &str) -> Option<u32> {
    all_pids()
        .into_iter()
        .find(|p| process::bundle_id(*p).as_deref() == Some(bundle))
}

/// `Contents/Frameworks/Electron Framework.framework` inside the app bundle of `pid`.
pub fn is_electron(pid: u32) -> bool {
    process::path(pid).is_some_and(|exe| {
        exe.ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .is_some_and(|app| {
                app.join("Contents/Frameworks/Electron Framework.framework")
                    .exists()
            })
    })
}
