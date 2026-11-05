//! A scripted application for the open-menu tests: its menu tree, which window
//! shows it from which poll on, a virtual clock, and a log of every press,
//! `AXCancel` and Escape. Item `i` of menu `m` is node `m * 100 + i`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::{Entry, MenuWindow, Menus};
use crate::error::{CoreResult, DesktopError};

/// One fake menu item: title, whether it is enabled, and its submenu's id.
pub(super) type Item = (&'static str, bool, Option<u32>);

pub(super) struct Fake {
    pub(super) tree: HashMap<u32, Vec<Item>>,
    pub(super) open: Vec<MenuWindow>,
    /// The menu window the press opens, and the poll that first lists it.
    pub(super) opens: Option<(MenuWindow, usize)>,
    pub(super) polls: usize,
    /// Whether pressing an item, `AXCancel` or Escape closes the menu; a
    /// pressed item's menu that stays open models `AppKit`'s flash and fade,
    /// and a menu that does not take `AXCancel` refuses it.
    pub(super) press_closes: bool,
    pub(super) cancel_works: bool,
    pub(super) escape_works: bool,
    pub(super) log: RefCell<Vec<String>>,
    pub(super) epoch: Instant,
    pub(super) elapsed: Duration,
}

impl Default for Fake {
    fn default() -> Self {
        Self {
            tree: HashMap::new(),
            open: Vec::new(),
            opens: None,
            polls: 0,
            press_closes: false,
            cancel_works: false,
            escape_works: false,
            log: RefCell::new(Vec::new()),
            epoch: Instant::now(),
            elapsed: Duration::ZERO,
        }
    }
}

impl Fake {
    /// Font Book's context menu: "Add to" with two collections, a disabled
    /// command, and an enabled one; the menu shows from the third poll on.
    pub(super) fn font_book() -> Self {
        Self {
            tree: HashMap::from([
                (
                    9,
                    vec![
                        ("Add to", true, Some(20)),
                        ("Remove", false, None),
                        ("Show in Finder", true, None),
                    ],
                ),
                (
                    20,
                    vec![("Bench Holdout", true, None), ("Serif\u{2026}", true, None)],
                ),
            ]),
            opens: Some((MenuWindow(9), 3)),
            press_closes: true,
            cancel_works: true,
            escape_works: true,
            ..Self::default()
        }
    }

    pub(super) fn logged(&self) -> Vec<String> {
        self.log.borrow().clone()
    }

    pub(super) fn virtual_elapsed(&self) -> Duration {
        self.elapsed
    }
}

impl Menus for Fake {
    type Node = u32;

    fn windows(&mut self) -> Option<Vec<MenuWindow>> {
        self.polls += 1;
        if let Some((window, from)) = self.opens {
            if self.polls >= from {
                self.open.push(window);
                self.opens = None;
            }
        }
        Some(self.open.clone())
    }

    fn locate(&mut self, window: MenuWindow) -> Option<u32> {
        self.tree.contains_key(&window.0).then_some(window.0)
    }

    fn items(&mut self, menu: &u32) -> CoreResult<Vec<Entry<u32>>> {
        Ok((0u32..)
            .zip(&self.tree[menu])
            .map(|(index, &(title, enabled, submenu))| Entry {
                node: menu * 100 + index,
                title: title.to_string(),
                enabled,
                submenu,
            })
            .collect())
    }

    fn press(&mut self, item: &u32) -> CoreResult<()> {
        let (title, ..) = self.tree[&(item / 100)][usize::try_from(item % 100).expect("fits")];
        self.log.borrow_mut().push(format!("press {title}"));
        if self.press_closes {
            self.open.clear();
        }
        Ok(())
    }

    fn cancel(&mut self, _: &u32) -> CoreResult<()> {
        self.log.borrow_mut().push("cancel".to_string());
        if !self.cancel_works {
            return Err(DesktopError::ax_failed("AXCancel is not supported"));
        }
        self.open.clear();
        Ok(())
    }

    fn escape(&mut self) -> CoreResult<()> {
        self.log.borrow_mut().push("escape".to_string());
        if self.escape_works {
            self.open.clear();
        }
        Ok(())
    }

    fn wait(&mut self, interval: Duration) {
        self.elapsed += interval;
    }

    fn now(&mut self) -> Instant {
        self.epoch + self.elapsed
    }
}
