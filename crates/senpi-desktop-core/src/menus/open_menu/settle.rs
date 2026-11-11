//! Settling the menu a press opened: finding it, choosing the path in it or
//! listing its items, and closing it.

use std::time::Duration;

use super::choose::{choose, listing, quote_path};
use super::{new_menu, stops_the_call, MenuWindow, Menus, Settled, MENU_CLOSE_TIMEOUT, MENU_POLL};
use crate::error::{CoreResult, DesktopError};
use crate::intervention::check_press;

/// The checks that run right before a path's item is pressed. The menu can
/// take the whole timeout to appear, and meanwhile the agent may have been
/// stopped (`stop`: the request's cancel and stop-path check), the user may
/// have pressed a key or clicked in the app ([`check_press`]), or the target
/// may no longer hold in the background (`holds`: it came to the front). When
/// any refuses, the menu is closed and nothing is pressed: a stop reports its
/// own error ([`stops_the_call`]), and a target that no longer holds is a
/// refusal of the path, reported as delivered, since the press that opened
/// the menu went out.
pub struct PressChecks<'a> {
    pub stop: &'a dyn Fn() -> CoreResult<()>,
    pub holds: &'a dyn Fn() -> CoreResult<()>,
}

/// Settles a menu that a press opened, within `timeout`, since the menu
/// windows were `before`: chooses `path` in it, or closes it; see
/// [`super::guard`].
///
/// # Errors
/// The menu list could not be read after the press (`InputFailed`), the menu
/// could not be closed, or a [`PressChecks`] refusal that stops the call.
pub fn settle_with<M: Menus>(
    menus: &mut M,
    before: &[MenuWindow],
    path: Option<&[String]>,
    timeout: Duration,
    checks: &PressChecks<'_>,
) -> CoreResult<Settled> {
    let mut read = false;
    let opened = poll(menus, timeout, |menus| {
        let now = menus.windows()?;
        read = true;
        new_menu(before, &now)
    });
    let Some(window) = opened else {
        return if read {
            Ok(Settled::NoMenu)
        } else {
            Err(DesktopError::input_failed(
                "cannot list the target's open menus after the input, so a menu it opened may still be open",
            ))
        };
    };
    let menu = menus.locate(window);
    let (refusal, items) = match (path, &menu) {
        (Some(path), Some(menu)) => match choose(menus, menu, path) {
            Ok(leaf) => match (checks.stop)().and_then(|()| check_press()).and_then(|()| (checks.holds)()) {
                Err(mut error) if stops_the_call(&error) => {
                    // The stop is what the call reports; a menu that would not
                    // close is added to it, never swapped for it.
                    if !close(menus, window, Some(menu)).unwrap_or(false) {
                        error.message.push_str("; the menu the press opened is still open and keeps the user's keyboard");
                    }
                    return Err(error);
                }
                Err(error) => (Some(error.message), String::new()),
                Ok(()) => match menus.press(&leaf.node) {
                    Ok(()) if end_chosen(menus, window, menu) => return Ok(Settled::Chosen),
                    Ok(()) => (
                        Some(format!("the menu stayed open after {} was pressed", quote_path(path))),
                        String::new(),
                    ),
                    Err(error) => (
                        Some(format!(
                            "pressing menu item '{}' failed ({}), and it may already have taken effect",
                            leaf.path, error.message
                        )),
                        String::new(),
                    ),
                },
            },
            Err(refusal) => (Some(refusal.message), refusal.items),
        },
        (Some(_), None) => (
            Some("its items could not be read through accessibility".to_string()),
            String::new(),
        ),
        (None, Some(menu)) => (None, listing(menus, menu)),
        (None, None) => (None, String::new()),
    };
    let closed = close(menus, window, menu.as_ref())?;
    Ok(Settled::Unchosen {
        refusal,
        items,
        closed,
    })
}

/// Ends the menu showing in `window` after an item of `menu` was pressed:
/// `true` once it is closed. The pressed item flashes and the menu fades out
/// for about 340 ms, and until it is gone `WindowServer` sends the user's keys
/// to the target, which types them into its own key window once the menu
/// closes. `AXCancel` right behind the press ends it within a few
/// milliseconds, and `AppKit` still sends the item's action. A menu that
/// refuses the cancel closes after its fade.
fn end_chosen<M: Menus>(menus: &mut M, window: MenuWindow, menu: &M::Node) -> bool {
    // A refused cancel only means the menu closes after its fade, which the
    // wait below observes.
    let _cancel: CoreResult<()> = menus.cancel(menu);
    await_closed(menus, window)
}

/// Closes menu window `window`, showing `menu`, unless it already closed;
/// whether it is closed afterwards. `AXCancel` closes it at once. Escape, the
/// fallback, leaves it fading out for about 270 ms, and until the fade ends
/// the keyboard stays with the target, which types the user's keys into its
/// own key window once the menu is gone.
fn close<M: Menus>(menus: &mut M, window: MenuWindow, menu: Option<&M::Node>) -> CoreResult<bool> {
    if !is_open(menus, window) {
        return Ok(true);
    }
    if let Some(menu) = menu {
        if menus.cancel(menu).is_ok() && await_closed(menus, window) {
            return Ok(true);
        }
    }
    menus.escape()?;
    Ok(await_closed(menus, window))
}

fn await_closed<M: Menus>(menus: &mut M, window: MenuWindow) -> bool {
    poll(menus, MENU_CLOSE_TIMEOUT, |menus| {
        (!is_open(menus, window)).then_some(())
    })
    .is_some()
}

fn is_open<M: Menus>(menus: &mut M, window: MenuWindow) -> bool {
    menus.windows().is_none_or(|now| now.contains(&window))
}

/// Calls `probe` every [`MENU_POLL`] until it yields a value or `timeout`
/// passes on the menus' clock.
pub(super) fn poll<M: Menus, T>(
    menus: &mut M,
    timeout: Duration,
    mut probe: impl FnMut(&mut M) -> Option<T>,
) -> Option<T> {
    let deadline = menus.now() + timeout;
    loop {
        if let Some(value) = probe(menus) {
            return Some(value);
        }
        if menus.now() >= deadline {
            return None;
        }
        menus.wait(MENU_POLL);
    }
}
