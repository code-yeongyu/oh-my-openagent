//! A menu that a press opened, settled in the call that opened it. Ported
//! from oh-my-pi 0838d2ab44 `macos/ax/open_menu.rs`; the platform reads and
//! posts come through [`Menus`], so the macOS backend and the fake backend
//! run one state machine.
//!
//! `AppKit` tracks an open menu modally, and `WindowServer` sends the keyboard
//! to it: a menu opened in a background application takes every key from the
//! user's frontmost application until it closes, with no change of front
//! application to show for it. A press that can open one (a right-click or
//! Control-click, a click or `AXPress` on a menu button or popup button,
//! `AXShowMenu`) therefore never returns with that menu open. Given an item
//! path, the call presses that item and ends the menu with `AXCancel` at once,
//! since a pressed item flashes and its menu fades out for about 340 ms with
//! the keyboard; otherwise it closes the menu with nothing chosen and reports
//! the menu's items, so the next call can name one.
//!
//! The open menu is found where it shows: a hit-test inside its window yields
//! one of its items, whose parent is the menu. A submenu's items are children
//! of their item and can be read and pressed without opening the submenu.

mod choose;
mod classify;
mod guard;
mod settle;

use std::time::{Duration, Instant};

use crate::error::{CoreResult, DesktopError, ErrorCode};

pub use self::choose::listing;
pub use self::classify::{may_open, may_open_context_menu, opens_menu, watch_timeout};
pub use self::guard::guard;
pub use self::settle::{settle_with, PressChecks};

/// How long a context menu may take to appear after the right-click or
/// Control-click that opens it; menus in Chrome and `AppKit` appeared within
/// 40 ms.
pub const CONTEXT_MENU_TIMEOUT: Duration = Duration::from_millis(250);
/// How long the menu of a menu button or popup button may take to appear
/// after its press: Finder's Action menu, validated for an application made
/// active for it, appeared 450 ms after `AXPress` returned.
pub const CONTROL_MENU_TIMEOUT: Duration = Duration::from_millis(1000);
/// How long a menu may take to close after Escape; it fades out for about
/// 270 ms.
const MENU_CLOSE_TIMEOUT: Duration = Duration::from_millis(600);
const MENU_POLL: Duration = Duration::from_millis(5);
/// Most items an error lists, submenus included; a submenu that would pass it
/// is listed by its title alone.
const MAX_LISTED_ITEMS: usize = 60;
/// Submenu levels an error lists below the menu's own items.
const MAX_LISTED_DEPTH: usize = 2;

/// A window at the pop-up menu level, as the platform's window list numbers
/// it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MenuWindow(pub u32);

/// One titled item of an open menu; separators are left out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry<N> {
    pub node: N,
    pub title: String,
    pub enabled: bool,
    pub submenu: Option<N>,
}

/// The reads and posts that settle a menu, on the platform that shows it.
pub trait Menus {
    type Node: Clone;
    /// The application's on-screen menu windows; `None` when the window list
    /// cannot be read.
    fn windows(&mut self) -> Option<Vec<MenuWindow>>;
    /// The open menu showing in `window`.
    fn locate(&mut self, window: MenuWindow) -> Option<Self::Node>;
    /// The titled items of `menu`, in order.
    ///
    /// # Errors
    /// The items could not be read.
    fn items(&mut self, menu: &Self::Node) -> CoreResult<Vec<Entry<Self::Node>>>;
    /// Presses `item`.
    ///
    /// # Errors
    /// The press was refused or failed; it may still have taken effect.
    fn press(&mut self, item: &Self::Node) -> CoreResult<()>;
    /// Ends `menu`'s tracking through accessibility (`AXCancel`).
    ///
    /// # Errors
    /// The menu refused the cancel.
    fn cancel(&mut self, menu: &Self::Node) -> CoreResult<()>;
    /// Posts Escape to the application, which closes its open menu.
    ///
    /// # Errors
    /// The key could not be posted.
    fn escape(&mut self) -> CoreResult<()>;
    /// Waits `interval` between two polls of the menu windows.
    fn wait(&mut self, interval: Duration);
    /// The clock the poll deadlines read.
    fn now(&mut self) -> Instant;
}

/// A press that may open a menu, as errors name it.
#[derive(Clone, Copy, Debug)]
pub enum Press<'a> {
    /// A pointer gesture of `kind`, such as "click", delivered to the window
    /// `id` of application `app`.
    Pointer {
        kind: &'a str,
        id: &'a str,
        app: &'a str,
    },
    /// An accessibility action, such as `AXPress`.
    Action(&'a str),
}

/// What became of a menu a press may have opened.
#[derive(Debug, PartialEq, Eq)]
pub enum Settled {
    /// No new menu appeared.
    NoMenu,
    /// The requested item was pressed and the menu closed.
    Chosen,
    /// A menu opened and was closed with nothing chosen.
    Unchosen {
        /// Why the requested path chose nothing; `None` when none was given.
        refusal: Option<String>,
        /// The items of the menu level the call stopped at, as errors list them.
        items: String,
        /// Whether the menu closed.
        closed: bool,
    },
}

/// Whether settling stopped for a reason that ends the whole call rather than
/// refusing the menu path: the agent was stopped or suspended, or the user
/// came to the app or pressed a key or clicked in it.
pub const fn stops_the_call(error: &DesktopError) -> bool {
    matches!(
        error.code,
        ErrorCode::Cancelled | ErrorCode::Suspended | ErrorCode::UserIntervened
    )
}

/// The process that shows the menus of an element of `app_pid` whose window
/// is `drawn`: the window's owner (`owner_of`), which for a system Open or
/// Save panel is `openAndSavePanelService`, or else `app_pid`.
pub fn menu_process(
    app_pid: i32,
    drawn: Option<u32>,
    owner_of: impl FnOnce(u32) -> Option<i32>,
) -> i32 {
    drawn.and_then(owner_of).unwrap_or(app_pid)
}

/// Whether a menu element reporting process `owner`, hit-tested in a menu
/// window of `menu_pid`, is the target's: a remote view's service shows the
/// menu, but its elements report `app_pid`, the application hosting the view.
pub const fn owns_menu(owner: i32, menu_pid: i32, app_pid: i32) -> bool {
    owner == menu_pid || owner == app_pid
}

/// A menu window listed in `now` that was not open `before`.
pub fn new_menu(before: &[MenuWindow], now: &[MenuWindow]) -> Option<MenuWindow> {
    now.iter().copied().find(|menu| !before.contains(menu))
}

#[cfg(test)]
mod fake;
#[cfg(test)]
mod guard_tests;
#[cfg(test)]
mod settle_tests;
