//! Core's open-menu state machine over a live application: the menu windows
//! come from the window list, the open menu is hit-tested through the
//! application's accessibility tree, and its items are pressed and cancelled
//! through accessibility. Ported from oh-my-pi 0838d2ab44 `ax/open_menu.rs`
//! (`AxMenus`); the settling logic itself lives in
//! `senpi_desktop_core::menus::open_menu`.

use std::ptr::{self, NonNull};
use std::thread;
use std::time::{Duration, Instant};

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::CFRetained;
use senpi_desktop_core::backend::MenuChoice;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::menus::open_menu::{
    guard, may_open, menu_process, opens_menu, owns_menu, settle_with, Entry, MenuWindow, Menus,
    Press, PressChecks, Watch, CONTROL_MENU_TIMEOUT,
};
use senpi_desktop_core::protocol_results::MenuReport;

use super::menus::{bounded_children, element_pid};
use super::{actions, element};
use crate::skylight::reporting_partial;
use crate::{capture, front_app, input, skylight};

/// Hops from a hit-tested element up to its menu.
const MAX_ASCENT: usize = 4;

/// [`Menus`] on a live application through accessibility: `pid` shows the
/// menu windows, and its menus belong to `pid` or `app_pid` (`owns_menu`).
pub(crate) struct AxMenus {
    pid: libc::pid_t,
    app_pid: libc::pid_t,
    app: Option<CFRetained<AXUIElement>>,
}

impl AxMenus {
    pub(crate) const fn new(pid: libc::pid_t, app_pid: libc::pid_t) -> Self {
        Self {
            pid,
            app_pid,
            app: None,
        }
    }
}

impl Menus for AxMenus {
    type Node = CFRetained<AXUIElement>;

    fn windows(&mut self) -> Option<Vec<MenuWindow>> {
        capture::menu_windows(self.pid)
    }

    fn locate(&mut self, window: MenuWindow) -> Option<Self::Node> {
        let frame = capture::menu_window_frame(window)?;
        if self.app.is_none() {
            let app = element::create_application(self.pid).ok()?;
            element::set_timeout(&app).ok()?;
            self.app = Some(app);
        }
        let app = self.app.as_deref()?;
        let mut found = hit_test(
            app,
            frame.x + frame.width / 2.0,
            frame.y + frame.height / 2.0,
        )?;
        for _ in 0..MAX_ASCENT {
            if element::copy_string(&found, "AXRole").as_deref() == Some("AXMenu") {
                return owns_menu(element_pid(&found).ok()?, self.pid, self.app_pid)
                    .then_some(found);
            }
            found = element::copy_element(&found, "AXParent")?;
        }
        None
    }

    fn items(&mut self, menu: &Self::Node) -> CoreResult<Vec<Entry<Self::Node>>> {
        let mut entries = Vec::new();
        for child in bounded_children(menu, true)? {
            if element::copy_string(&child, "AXRole").as_deref() != Some("AXMenuItem") {
                continue;
            }
            let Some(title) =
                element::copy_string(&child, "AXTitle").filter(|title| !title.is_empty())
            else {
                continue;
            };
            let submenu = element::copy_elements(&child, "AXChildren")
                .unwrap_or_default()
                .into_iter()
                .find(|item| element::copy_string(item, "AXRole").as_deref() == Some("AXMenu"));
            entries.push(Entry {
                enabled: element::copy_bool(&child, "AXEnabled").unwrap_or(false),
                node: child,
                title,
                submenu,
            });
        }
        Ok(entries)
    }

    fn press(&mut self, item: &Self::Node) -> CoreResult<()> {
        actions::perform(item, "AXPress")
    }

    fn cancel(&mut self, menu: &Self::Node) -> CoreResult<()> {
        actions::perform(menu, "AXCancel")
    }

    fn escape(&mut self) -> CoreResult<()> {
        input::post_escape(self.pid)
    }

    fn wait(&mut self, interval: Duration) {
        thread::sleep(interval);
    }

    fn now(&mut self) -> Instant {
        Instant::now()
    }
}

/// The element of `app` at global point `(x, y)`.
fn hit_test(app: &AXUIElement, x: f64, y: f64) -> Option<CFRetained<AXUIElement>> {
    let mut output: *const AXUIElement = ptr::null();
    // The AX hit-test API takes f32 points; a menu's frame is on screen, so
    // its centre is within range.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "on-screen points fit an f32; the API takes no f64"
    )]
    let (x32, y32) = (x as f32, y as f32);
    // SAFETY: `output` is writable and the retained application element
    // remains valid through the synchronous hit-test.
    let error = unsafe { app.copy_element_at_position(x32, y32, NonNull::from(&mut output)) };
    if error != AXError::Success {
        return None;
    }
    element::retained_element(output).ok()
}

/// Whether a click at global point `(x, y)` lands on a menu button or popup
/// button of `pid`, or on a label or image inside one (up to [`MAX_ASCENT`]
/// levels of static text, image or group).
pub(crate) fn opens_menu_at(pid: libc::pid_t, x: f64, y: f64) -> bool {
    let Ok(app) = element::create_application(pid) else {
        return false;
    };
    if element::set_timeout(&app).is_err() {
        return false;
    }
    let Some(mut found) = hit_test(&app, x, y) else {
        return false;
    };
    for _ in 0..MAX_ASCENT {
        match element::copy_string(&found, "AXRole").as_deref() {
            role if opens_menu(role) => return true,
            Some("AXStaticText" | "AXImage" | "AXGroup") => {}
            _ => return false,
        }
        let Some(parent) = element::copy_element(&found, "AXParent") else {
            return false;
        };
        found = parent;
    }
    false
}

/// The pid of the application whose element is at global point `(x, y)`,
/// when accessibility can say: a remote view reports the hosting application
/// rather than the service drawing it.
pub(crate) fn app_pid_at(x: f64, y: f64) -> Option<libc::pid_t> {
    let found = super::tree::element_at(x, y).ok()??;
    element_pid(&found).ok()
}

/// Refuses the menu path once the target's application came to the front
/// while its menu appeared: an open menu is the user's then.
pub(crate) fn still_behind(pid: libc::pid_t) -> CoreResult<()> {
    if front_app::current_front_pid() == Some(pid) {
        return Err(DesktopError::background_unavailable(format!(
            "the application of process {pid} came to the front"
        )));
    }
    Ok(())
}

/// `ax.perform` for an action that may open a menu: performs `action` on
/// `element`, then chooses `choice.path` in the menu it opened, or (D1, in a
/// background application) reads its items and closes it. A frontmost
/// application's menu stays open for the next call unless a path is given. A
/// background application's element is made key in its own application
/// first, without raising it, so the menu opens where the press lands.
pub(super) fn perform_menu(
    element: &AXUIElement,
    action: &str,
    choice: MenuChoice<'_>,
) -> CoreResult<Option<MenuReport>> {
    let native = actions::action_name(action);
    let pid = element_pid(element)?;
    let background = front_app::current_front_pid() != Some(pid);
    let watched = choice.path.is_some()
        || (background && may_open(action, || element::copy_string(element, "AXRole")));
    if !watched {
        return actions::perform_requested(element, action).map(|()| None);
    }
    let drawn = element::owner_window_id(element);
    let menu_pid = menu_process(pid, drawn, capture::window_owner_pid);
    let before = capture::menu_windows(menu_pid).ok_or_else(|| {
        DesktopError::ax_failed(format!(
            "cannot list the open menus of process {menu_pid}, so a menu that {native} opens could not be \
             closed; nothing was performed"
        ))
    })?;
    let holds = move || {
        if background {
            still_behind(pid)
        } else {
            Ok(())
        }
    };
    let checks = PressChecks {
        stop: choice.check_stop,
        holds: &holds,
    };
    let watch = choice.path.map_or(Watch::ListAndClose, Watch::Choose);
    reporting_partial(|| {
        if let (true, Some(wid)) = (background, drawn) {
            skylight::activate_without_raise(pid, wid)?;
        }
        guard(
            &mut AxMenus::new(menu_pid, pid),
            Press::Action(&native),
            Some(&before),
            watch,
            |_| actions::perform_requested(element, action),
            |menus, before, path| settle_with(menus, before, path, CONTROL_MENU_TIMEOUT, &checks),
        )
    })
}
