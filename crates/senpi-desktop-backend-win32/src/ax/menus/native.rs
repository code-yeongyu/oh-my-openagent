//! Win32 HMENU observations and bounded synchronous dispatch.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::MenuItem;
use std::{mem::size_of, ptr::without_provenance_mut};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetMenuInfo, GetMenuItemCount, GetMenuItemInfoW, SendMessageTimeoutW, MENUINFO, MENUITEMINFOW,
    MFS_CHECKED, MFS_DISABLED, MFT_SEPARATOR, MIIM_FTYPE, MIIM_ID, MIIM_STATE, MIIM_STRING,
    MIIM_SUBMENU, MIM_STYLE, SMTO_ABORTIFHUNG, SMTO_BLOCK, SMTO_ERRORONEXIT, WM_MENUCOMMAND,
};

use super::target::Target;
use crate::menus::native::{bounded_count, Entry, Level, NativeMenu};
use crate::menus::{failed, native_label, MAX_LABEL_UNITS};

pub(super) struct Native<'a>(pub &'a Target);

impl NativeMenu for Native<'_> {
    fn level(&self, menu: usize, path: &[String]) -> CoreResult<Level> {
        self.0.check()?;
        let count = self.count(menu)?;
        let capacity = bounded_count(count)?;
        let mut level = Level {
            items: Vec::with_capacity(capacity),
            entries: Vec::with_capacity(capacity),
            count,
        };
        let mut text = vec![0u16; MAX_LABEL_UNITS + 1];
        for position in 0..u32::try_from(capacity).unwrap_or_default() {
            // SAFETY: MENUITEMINFOW contains integers and pointers valid at zero.
            let mut info: MENUITEMINFOW = unsafe { std::mem::zeroed() };
            info.cbSize = size_of::<MENUITEMINFOW>() as u32;
            info.fMask = MIIM_STRING | MIIM_FTYPE | MIIM_STATE | MIIM_SUBMENU | MIIM_ID;
            info.dwTypeData = text.as_mut_ptr();
            info.cch = text.len() as u32;
            // SAFETY: info and text are writable for the advertised sizes;
            // Win32 validates the opaque HMENU and position.
            if unsafe { GetMenuItemInfoW(without_provenance_mut(menu), position, 1, &mut info) }
                == 0
            {
                return Err(failed("native menu changed or cannot be read"));
            }
            if info.fType & MFT_SEPARATOR != 0 {
                continue;
            }
            let length = info.cch as usize;
            if length >= MAX_LABEL_UNITS {
                return Err(failed("native menu label exceeds the bounded text limit"));
            }
            let (title, shortcut) = native_label(&String::from_utf16_lossy(&text[..length]));
            if title.trim().is_empty() {
                continue;
            }
            let mut item_path = path.to_vec();
            item_path.push(title.clone());
            level.items.push(MenuItem {
                title,
                path: item_path,
                enabled: info.fState & MFS_DISABLED == 0,
                checked: info.fState & MFS_CHECKED != 0,
                has_submenu: !info.hSubMenu.is_null(),
                shortcut,
            });
            level.entries.push(Entry {
                menu,
                position,
                id: info.wID,
                submenu: info.hSubMenu.addr(),
            });
        }
        if self.count(menu)? != count {
            return Err(failed("native menu changed while it was being read"));
        }
        Ok(level)
    }

    fn attached(&self, root: usize) -> CoreResult<()> {
        self.0.attached(root)
    }

    fn count(&self, menu: usize) -> CoreResult<i32> {
        // SAFETY: Win32 validates the opaque HMENU.
        let count = unsafe { GetMenuItemCount(without_provenance_mut(menu)) };
        bounded_count(count)?;
        Ok(count)
    }

    fn style(&self, menu: usize) -> CoreResult<u32> {
        // SAFETY: MENUINFO contains only integer and pointer fields valid at zero.
        let mut info: MENUINFO = unsafe { std::mem::zeroed() };
        info.cbSize = size_of::<MENUINFO>() as u32;
        info.fMask = MIM_STYLE;
        // SAFETY: info is writable and sized; Win32 validates the opaque HMENU.
        if unsafe { GetMenuInfo(without_provenance_mut(menu), &mut info) } == 0 {
            return Err(failed(
                "cannot establish native menu command delivery semantics",
            ));
        }
        Ok(info.dwStyle)
    }

    fn dispatch(&self, entry: Entry, message: u32, wparam: usize) -> CoreResult<()> {
        let lparam = if message == WM_MENUCOMMAND {
            entry.menu as isize
        } else {
            0
        };
        let mut result = 0;
        // SAFETY: only scalar command data is sent to the validated exact HWND.
        // The result slot lives through the bounded synchronous call.
        if unsafe {
            SendMessageTimeoutW(
                self.0.hwnd,
                message,
                wparam,
                lparam,
                SMTO_ABORTIFHUNG | SMTO_BLOCK | SMTO_ERRORONEXIT,
                1500,
                &mut result,
            )
        } == 0
        {
            return Err(failed("native menu command delivery failed or timed out and may already have taken effect; do not replay automatically"));
        }
        Ok(())
    }
}
