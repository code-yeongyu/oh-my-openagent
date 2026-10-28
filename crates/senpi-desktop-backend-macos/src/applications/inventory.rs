//! The application inventory: `.app` bundles under the standard roots plus
//! every running application, read live through libproc because
//! `NSWorkspace.runningApplications` needs a main run loop this engine lacks.

use std::collections::{HashMap, HashSet};
use std::mem::size_of;
use std::path::{Path, PathBuf};

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::{ns_string, NSBundle, NSNumber, NSString};
use senpi_desktop_core::apps::is_app_bundle;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::Application;

const ALL_PIDS: u32 = 1;
const PID_INVENTORY_LIMIT: usize = 262_144;

fn running_pids(check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<Vec<libc::pid_t>> {
    // SAFETY: A null buffer asks libproc for the byte count it needs.
    let bytes = unsafe { libc::proc_listpids(ALL_PIDS, 0, std::ptr::null_mut(), 0) };
    if bytes <= 0 {
        return Err(DesktopError::internal("libproc could not enumerate running applications"));
    }
    let mut capacity = usize::try_from(bytes).unwrap_or(0) / size_of::<libc::pid_t>() + 64;
    loop {
        check_stop()?;
        if capacity > PID_INVENTORY_LIMIT {
            return Err(DesktopError::internal("native process inventory exceeds its safety limit"));
        }
        let mut pids = Vec::<libc::pid_t>::with_capacity(capacity);
        let bytes = i32::try_from(capacity * size_of::<libc::pid_t>())
            .map_err(|_| DesktopError::internal("native process inventory size overflow"))?;
        // SAFETY: libproc writes at most `bytes` initialized pid_t values into
        // this exclusively owned allocation and returns their byte count.
        let written = unsafe { libc::proc_listpids(ALL_PIDS, 0, pids.as_mut_ptr().cast(), bytes) };
        if written < 0 {
            return Err(DesktopError::internal("libproc failed to read running applications"));
        }
        if written >= bytes {
            capacity *= 2;
            continue;
        }
        let count = usize::try_from(written).unwrap_or(0) / size_of::<libc::pid_t>();
        // SAFETY: `written` bytes lie within the allocation and libproc
        // initialized every complete pid_t among them.
        unsafe { pids.set_len(count) };
        pids.retain(|pid| *pid > 0);
        return Ok(pids);
    }
}

fn roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Library/CoreServices"),
        PathBuf::from("/Network/Applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots
}

pub(super) fn list(check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<Vec<Application>> {
    autoreleasepool(|_| {
        let mut apps = HashMap::<String, Application>::new();
        let mut roots = roots();
        let mut visited = HashSet::new();
        while let Some(directory) = roots.pop() {
            check_stop()?;
            let Ok(canonical) = directory.canonicalize() else { continue };
            if !visited.insert(canonical.clone()) {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(canonical) else { continue };
            for entry in entries.flatten() {
                check_stop()?;
                let path = entry.path();
                if is_app_bundle(&path) {
                    if let Ok(app) = read_bundle(&path) {
                        apps.entry(app.path.clone()).or_insert(app);
                    }
                } else if entry.file_type().is_ok_and(|kind| kind.is_dir())
                    && !entry.file_name().to_string_lossy().starts_with('.')
                {
                    roots.push(path);
                }
            }
        }
        for pid in running_pids(check_stop)? {
            check_stop()?;
            let Some(running) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else { continue };
            if running.isTerminated() {
                continue;
            }
            if let Some(app) = running_application(&running) {
                apps.insert(app.path.clone(), app);
            }
        }
        Ok(apps.into_values().collect())
    })
}

fn read_bundle(path: &Path) -> CoreResult<Application> {
    if !is_app_bundle(path) {
        return Err(DesktopError::invalid_target("macOS application paths must identify an existing .app bundle"));
    }
    let path = path.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            DesktopError::permission_denied(format!("cannot access application {}: {error}", path.display()))
        } else {
            DesktopError::invalid_target(format!("cannot find application {}: {error}", path.display()))
        }
    })?;
    let path = path.to_str().ok_or_else(|| DesktopError::invalid_target("application path is not valid UTF-8"))?;
    let bundle = NSBundle::bundleWithPath(&NSString::from_str(path))
        .ok_or_else(|| DesktopError::invalid_target(format!("{path:?} is not a valid application bundle")))?;
    if !bundle.executablePath().is_some_and(|executable| Path::new(&executable.to_string()).is_file()) {
        return Err(DesktopError::invalid_target(format!("application bundle {path:?} has no accessible executable")));
    }
    let name = bundle_string(&bundle, ns_string!("CFBundleDisplayName"))
        .or_else(|| bundle_string(&bundle, ns_string!("CFBundleName")))
        .unwrap_or_else(|| file_stem(path));
    Ok(Application {
        id: bundle.bundleIdentifier().map_or_else(|| path.to_owned(), |id| id.to_string()),
        name,
        path: path.to_owned(),
        running: false,
        pid: None,
    })
}

fn file_stem(path: &str) -> String {
    Path::new(path).file_stem().unwrap_or_default().to_string_lossy().into_owned()
}

fn bundle_string(bundle: &NSBundle, key: &NSString) -> Option<String> {
    bundle.objectForInfoDictionaryKey(key)?.downcast::<NSString>().ok().map(|value| value.to_string())
}

/// Whether the bundle at `path` is a helper nobody opens by name: not an
/// `.app` (a running app extension or XPC service), or an app declaring
/// `LSUIElement` or `LSBackgroundOnly` (as a Boolean, a number or "1").
pub(super) fn is_helper(path: &Path) -> bool {
    if !is_app_bundle(path) {
        return true;
    }
    autoreleasepool(|_| {
        let Some(bundle) = path.to_str().and_then(|path| NSBundle::bundleWithPath(&NSString::from_str(path))) else {
            return false;
        };
        [ns_string!("LSUIElement"), ns_string!("LSBackgroundOnly")].into_iter().any(|key| {
            bundle.objectForInfoDictionaryKey(key).is_some_and(|value| match value.downcast::<NSNumber>() {
                Ok(number) => number.boolValue(),
                Err(value) => value.downcast::<NSString>().is_ok_and(|text| text.boolValue()),
            })
        })
    })
}

pub(super) fn running_application(running: &NSRunningApplication) -> Option<Application> {
    let path = running.bundleURL()?.path()?.to_string();
    let path = Path::new(&path)
        .canonicalize()
        .ok()
        .and_then(|path| path.into_os_string().into_string().ok())
        .unwrap_or(path);
    let name = running.localizedName().map_or_else(|| file_stem(&path), |name| name.to_string());
    let pid = u32::try_from(running.processIdentifier()).ok().filter(|pid| *pid != 0);
    Some(Application {
        id: running.bundleIdentifier().map_or_else(|| path.clone(), |id| id.to_string()),
        name,
        path,
        running: !running.isTerminated(),
        pid,
    })
}

pub(super) fn from_path(path: &Path) -> CoreResult<Application> {
    autoreleasepool(|_| read_bundle(path))
}
