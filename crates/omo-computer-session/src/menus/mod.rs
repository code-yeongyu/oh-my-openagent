//! `win.menu.items()` and `menu.select(path)` (acceptance 86; design row C23). Items are read
//! under the read tier with nothing sent, raised or focused; a denied or out-of-scope app's menu
//! is refused like its exec. A select proves the item again from a fresh listing, matched by
//! exact label, and only then leaves through the funnel's one sink.

#[cfg(test)]
mod tests;
pub(crate) mod wire;

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::menus::{find_exact, list, prove, MenuBounds};
use omo_computer_core::methods::Method;
use omo_computer_core::params::{Delivery, MenuItemsParams, MenuSelectParams};
use omo_computer_core::requests::{read_menu_items, read_menu_select, ReadRequest, Verb};
use omo_computer_core::results::{ExecReply, MenuItems};
use omo_computer_core::untrusted::UntrustedText;
use omo_computer_safety::protected::Os;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::apps::{denied, shell, window_app};
use crate::mutate::{Mutation, Refused};
use crate::{Session, NOT_OPEN};

/// The listing bound of the OS this engine runs on.
#[must_use]
pub const fn bounds() -> MenuBounds {
    match Os::host() {
        Os::Windows => MenuBounds::WINDOWS,
        Os::Macos => MenuBounds::MACOS,
        Os::Linux => MenuBounds::X11,
    }
}

impl Session {
    /// `menu.items{target, path?}`: the menu tree of a window, or of the submenu at `path`.
    ///
    /// # Errors
    /// [`NOT_OPEN`], a consent refusal for the window's app, `StaleRef` / `AmbiguousTarget` for
    /// a `path` that names no single submenu, or the backend's refusal.
    pub fn menu_items(&mut self, params: MenuItemsParams) -> Result<MenuItems, Refused> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let ReadRequest::MenuItems { target, path } = read_menu_items(params) else {
            unreachable!("read_menu_items always reads a menu.items");
        };
        let app = window_app(self, &target);
        self.funnel.control.consent.admit_read(app.as_ref()).map_err(denied)?;
        let nodes = shell(self)?.menu_tree(&target)?;
        let under = if path.is_empty() {
            nodes.as_slice()
        } else {
            find_exact(&nodes, &path)?.children.as_slice()
        };
        let (items, truncated) = list(under, &path, bounds());
        Ok(MenuItems {
            items,
            truncated: truncated.then_some(true),
            observation: UntrustedText,
        })
    }

    /// `menu.select{target, path}`: proven against a fresh listing, then sent.
    ///
    /// # Errors
    /// [`NOT_OPEN`], `StaleRef` / `AmbiguousTarget` when the fresh listing no longer holds
    /// exactly that enabled item, or the funnel's refusal.
    pub fn menu_select(&mut self, params: MenuSelectParams) -> Result<ExecReply, Refused> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let request = read_menu_select(params);
        let Verb::MenuSelect { path } = request.verb else {
            unreachable!("read_menu_select always reads a menu.select");
        };
        let target = request.target.unwrap_or_default();
        let nodes = shell(self)?.menu_tree(&target)?;
        prove(&nodes, &path)?;
        let route = match request.policy.delivery {
            Some(Delivery::Foreground) => Route::ForegroundHid,
            Some(Delivery::Background) | None => Route::Ax,
        };
        let call = Call {
            verb: VerbKind::Keyboard,
            target: TargetRef::Window(&target),
            points: Vec::new(),
            chord: None,
            force: false,
        };
        let events = vec![InputEvent::MenuSelect { path }];
        self.mutate(Mutation::exec(Method::MenuSelect, call, events, route, &request.authority))
    }
}
