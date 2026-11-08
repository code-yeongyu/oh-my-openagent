//! Choosing an option of an `AXPopUpButton`.
//!
//! A popup's options are the `AXMenuItem`s of its `AXMenu`, and its `AXValue`
//! is not settable. `AppKit` builds that menu's accessibility items only while
//! the menu is open, so a closed native popup publishes no options at all:
//! choosing one means opening the menu, pressing the item, and reading the
//! popup's `AXValue` back as the verdict. A menu this call opened is closed
//! again whenever no choice is made.

mod matching;
mod native;

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};

use self::matching::{choose_option, refusal_message};

pub(super) use self::native::choose;

pub(super) trait PopupControl {
    type Item;

    fn value(&self) -> Option<String>;
    fn enabled(&self) -> Option<bool>;
    fn actions(&self) -> CoreResult<Vec<String>>;
    fn perform(&self, action: &str) -> CoreResult<()>;
    /// The items of the popup's open `AXMenu` plus any `AXMenuItem` children.
    fn menu_items(&self) -> Vec<Self::Item>;
    fn menu_open(&self) -> bool;
    fn cancel_menu(&self) -> CoreResult<()>;
    fn item_title(&self, item: &Self::Item) -> String;
    fn item_enabled(&self, item: &Self::Item) -> Option<bool>;
    fn press_item(&self, item: &Self::Item) -> CoreResult<()>;
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Waits {
    pub(super) menu_open: Duration,
    pub(super) choice_settle: Duration,
    pub(super) menu_close: Duration,
    pub(super) poll_interval: Duration,
}

impl Waits {
    pub(super) const LIVE: Self = Self {
        menu_open: Duration::from_millis(1000),
        choice_settle: Duration::from_millis(1000),
        menu_close: Duration::from_millis(500),
        poll_interval: Duration::from_millis(25),
    };
}

pub(super) fn choose_in<P: PopupControl>(popup: &P, value: &str, waits: Waits) -> CoreResult<()> {
    if popup.value().as_deref() == Some(value) {
        return Ok(());
    }
    if popup.enabled() == Some(false) {
        return Err(DesktopError::ax_failed(
            "popup button is disabled; nothing was selected",
        ));
    }
    let mut items = popup.menu_items();
    let opened = items.is_empty();
    if opened {
        items = open_menu(popup, waits)?;
    }
    let titles: Vec<String> = items.iter().map(|item| popup.item_title(item)).collect();
    let result = choose_option(&titles, value)
        .map_err(|refusal| DesktopError::ax_failed(refusal_message(&refusal, value, &titles)))
        .and_then(|index| press_option(popup, &items[index], value, waits));
    match result {
        Ok(()) if opened => settle_closed(popup, value, waits),
        Err(error) if opened && !close_menu(popup, waits) => Err(menu_left_open(error)),
        result => result,
    }
}

/// AppKit tears a chosen menu's accessibility element down shortly after the
/// press; waiting for it keeps the next call or screenshot from seeing a dying
/// menu, and one that lingers is cancelled.
fn settle_closed<P: PopupControl>(popup: &P, value: &str, waits: Waits) -> CoreResult<()> {
    let closed = poll(waits.menu_close, waits.poll_interval, || {
        (!popup.menu_open()).then_some(())
    })
    .is_some();
    if closed || close_menu(popup, waits) {
        return Ok(());
    }
    Err(DesktopError::ax_failed(format!(
        "popup option \"{value}\" was chosen, but the menu this call opened is still open"
    )))
}

fn menu_left_open(mut error: DesktopError) -> DesktopError {
    error.message.push_str("; the menu this call opened is still open");
    error
}

/// Opens a closed popup's menu with the control's own action and returns its
/// items once `AppKit` has built them. `AXPress` is what a click does;
/// `AXShowMenu` is the fallback for popups the first leaves without options.
fn open_menu<P: PopupControl>(popup: &P, waits: Waits) -> CoreResult<Vec<P::Item>> {
    let actions = popup.actions()?;
    let mut attempts = Vec::new();
    let mut left_open = false;
    for action in ["AXPress", "AXShowMenu"] {
        if !actions.iter().any(|name| name == action) {
            continue;
        }
        if let Err(error) = popup.perform(action) {
            attempts.push(error.message);
            continue;
        }
        let published = poll(waits.menu_open, waits.poll_interval, || {
            let items = popup.menu_items();
            (!items.is_empty()).then_some(items)
        });
        if let Some(items) = published {
            return Ok(items);
        }
        attempts.push(format!(
            "{action} published no options within {} ms",
            waits.menu_open.as_millis()
        ));
        // An empty menu left open would make the next action toggle it shut
        // instead of opening it, so a menu that will not close ends the attempts.
        if !close_menu(popup, waits) {
            left_open = true;
            break;
        }
    }
    if attempts.is_empty() {
        return Err(DesktopError::ax_failed(format!(
            "popup button advertises neither AXPress nor AXShowMenu (actions: {}); nothing was selected",
            actions.join(", ")
        )));
    }
    let error = DesktopError::ax_failed(format!(
        "popup menu published no options ({}); nothing was selected",
        attempts.join("; ")
    ));
    Err(if left_open { menu_left_open(error) } else { error })
}

/// Presses the chosen item and waits for the popup to report it: the popup's
/// value, not the press's return code, says whether the app took the choice.
fn press_option<P: PopupControl>(popup: &P, item: &P::Item, title: &str, waits: Waits) -> CoreResult<()> {
    if popup.item_enabled(item) == Some(false) {
        return Err(DesktopError::ax_failed(format!(
            "popup option \"{title}\" is disabled; nothing was selected"
        )));
    }
    popup.press_item(item)?;
    let mut after = None;
    let taken = poll(waits.choice_settle, waits.poll_interval, || {
        after = popup.value();
        (after.as_deref() == Some(title)).then_some(())
    });
    if taken.is_some() {
        return Ok(());
    }
    Err(DesktopError::ax_failed(match after {
        Some(after) => format!(
            "pressed popup option \"{title}\" but the popup still reads \"{after}\"; the app did not take the choice"
        ),
        None => format!(
            "pressed popup option \"{title}\" but the popup publishes no readable value, so the choice could not be confirmed"
        ),
    }))
}

fn close_menu<P: PopupControl>(popup: &P, waits: Waits) -> bool {
    if !popup.menu_open() {
        return true;
    }
    if popup.cancel_menu().is_err() {
        return false;
    }
    poll(waits.menu_close, waits.poll_interval, || {
        (!popup.menu_open()).then_some(())
    })
    .is_some()
}

/// Runs `probe` until it yields a value or `wait` has elapsed; the last probe
/// runs at or after the deadline, so a zero wait probes exactly once.
fn poll<T>(wait: Duration, interval: Duration, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + wait;
    loop {
        if let Some(value) = probe() {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(interval);
    }
}

#[cfg(test)]
mod fake;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
