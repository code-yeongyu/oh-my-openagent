use std::cell::RefCell;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::{PopupControl, Waits};

pub(super) const IMMEDIATE: Waits = Waits {
    menu_open: Duration::ZERO,
    choice_settle: Duration::ZERO,
    menu_close: Duration::ZERO,
    poll_interval: Duration::ZERO,
};

#[derive(Clone)]
pub(super) struct FakeOption {
    pub(super) title: &'static str,
    pub(super) enabled: bool,
}

pub(super) const fn option(title: &'static str) -> FakeOption {
    FakeOption { title, enabled: true }
}

/// A popup whose state changes synchronously with each action, so every
/// zero-wait poll observes the outcome of the action before it.
pub(super) struct FakePopup {
    pub(super) value: RefCell<Option<String>>,
    pub(super) enabled: bool,
    pub(super) actions: Vec<&'static str>,
    /// The action that opens a menu publishing `options`; any other advertised
    /// opener opens an empty menu.
    pub(super) publishing_opener: Option<&'static str>,
    pub(super) options: Vec<FakeOption>,
    pub(super) menu_open: RefCell<bool>,
    pub(super) cancel_closes: bool,
    pub(super) press_closes_menu: bool,
    pub(super) app_takes_choice: bool,
    pub(super) performed: RefCell<Vec<String>>,
}

impl FakePopup {
    pub(super) fn new(value: &str, options: &[FakeOption]) -> Self {
        Self {
            value: RefCell::new(Some(value.to_owned())),
            enabled: true,
            actions: vec!["AXPress", "AXShowMenu"],
            publishing_opener: Some("AXPress"),
            options: options.to_vec(),
            menu_open: RefCell::new(false),
            cancel_closes: true,
            press_closes_menu: true,
            app_takes_choice: true,
            performed: RefCell::new(Vec::new()),
        }
    }

    pub(super) fn performed(&self) -> Vec<String> {
        self.performed.borrow().clone()
    }

    fn publishes(&self) -> bool {
        *self.menu_open.borrow() && self.performed.borrow().last().map(String::as_str) == self.publishing_opener
    }
}

impl PopupControl for FakePopup {
    type Item = usize;

    fn value(&self) -> Option<String> {
        self.value.borrow().clone()
    }

    fn enabled(&self) -> Option<bool> {
        Some(self.enabled)
    }

    fn actions(&self) -> CoreResult<Vec<String>> {
        Ok(self.actions.iter().map(ToString::to_string).collect())
    }

    fn perform(&self, action: &str) -> CoreResult<()> {
        self.performed.borrow_mut().push(action.to_owned());
        *self.menu_open.borrow_mut() = true;
        Ok(())
    }

    fn menu_items(&self) -> Vec<usize> {
        if self.publishes() {
            (0..self.options.len()).collect()
        } else {
            Vec::new()
        }
    }

    fn menu_open(&self) -> bool {
        *self.menu_open.borrow()
    }

    fn cancel_menu(&self) -> CoreResult<()> {
        self.performed.borrow_mut().push("AXCancel".to_owned());
        if self.cancel_closes {
            *self.menu_open.borrow_mut() = false;
            Ok(())
        } else {
            Err(DesktopError::ax_failed("AXCancel failed"))
        }
    }

    fn item_title(&self, item: &usize) -> String {
        self.options[*item].title.to_owned()
    }

    fn item_enabled(&self, item: &usize) -> Option<bool> {
        Some(self.options[*item].enabled)
    }

    fn press_item(&self, item: &usize) -> CoreResult<()> {
        let title = self.options[*item].title;
        self.performed.borrow_mut().push(format!("press {title}"));
        if self.press_closes_menu {
            *self.menu_open.borrow_mut() = false;
        }
        if self.app_takes_choice {
            *self.value.borrow_mut() = Some(title.to_owned());
        }
        Ok(())
    }
}
