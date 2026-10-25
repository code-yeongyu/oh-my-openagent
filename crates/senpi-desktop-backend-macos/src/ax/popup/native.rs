use objc2_application_services::AXUIElement;
use objc2_core_foundation::CFRetained;
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::super::{actions, element};
use super::{choose_in, PopupControl, Waits};

pub(in crate::ax) fn choose(popup: &AXUIElement, value: &str) -> CoreResult<()> {
    choose_in(popup, value, Waits::LIVE)
}

impl PopupControl for AXUIElement {
    type Item = CFRetained<AXUIElement>;

    fn value(&self) -> Option<String> {
        element::copy_string(self, "AXValue")
    }

    fn enabled(&self) -> Option<bool> {
        element::copy_bool(self, "AXEnabled")
    }

    fn actions(&self) -> CoreResult<Vec<String>> {
        // SAFETY: The slot is writable and receives a create-rule CFArray.
        element::copy_name_array(|slot| unsafe { self.copy_action_names(slot) })
            .map_err(|error| DesktopError::ax_failed(format!("reading the popup's actions failed ({error:?})")))
    }

    fn perform(&self, action: &str) -> CoreResult<()> {
        actions::perform(self, action)
    }

    fn menu_items(&self) -> Vec<Self::Item> {
        let mut items = Vec::new();
        for child in element::copy_elements(self, "AXChildren").unwrap_or_default() {
            match element::copy_string(&child, "AXRole").as_deref() {
                Some("AXMenu") => items.extend(element::copy_elements(&child, "AXChildren").unwrap_or_default()),
                Some("AXMenuItem") => items.push(child),
                _ => {}
            }
        }
        items
    }

    fn menu_open(&self) -> bool {
        open_menu(self).is_some()
    }

    fn cancel_menu(&self) -> CoreResult<()> {
        match open_menu(self) {
            Some(menu) => actions::perform(&menu, "AXCancel"),
            None => Ok(()),
        }
    }

    fn item_title(&self, item: &Self::Item) -> String {
        element::copy_string(item, "AXTitle").unwrap_or_default()
    }

    fn item_enabled(&self, item: &Self::Item) -> Option<bool> {
        element::copy_bool(item, "AXEnabled")
    }

    fn press_item(&self, item: &Self::Item) -> CoreResult<()> {
        actions::perform(item, "AXPress")
    }
}

fn open_menu(popup: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
    element::copy_elements(popup, "AXChildren")?
        .into_iter()
        .find(|child| element::copy_string(child, "AXRole").as_deref() == Some("AXMenu"))
}
