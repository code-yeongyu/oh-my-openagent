//! The GDI floors: `PrintWindow(PW_RENDERFULLCONTENT)` of one window and `BitBlt` of one
//! display, with the OS pointer composited from `GetCursorInfo` in device pixels before any
//! scaling when the frame carries it (d-windows.md '## Capture', 'PrintWindow floor', 'Cursor').

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HDC, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, ICONINFO,
};

use super::{CaptureFault, RawFrame};
use crate::displays::PhysRect;

/// `PW_RENDERFULLCONTENT`: render DirectComposition content into the GDI bitmap.
const PW_RENDERFULLCONTENT: u32 = 0x0000_0002;

/// Reads `area` of the screen (or of `window` through `PrintWindow`) into BGRA rows, with the
/// pointer drawn at its device-pixel position when `cursor` is set.
pub(super) fn gdi(
    area: PhysRect,
    window: Option<HWND>,
    cursor: bool,
) -> Result<RawFrame, CaptureFault> {
    let (width, height) = (area.width, area.height);
    if width <= 0 || height <= 0 {
        return Err(CaptureFault::NullFrame);
    }
    // SAFETY: every GDI object created here is selected out and deleted before returning.
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let Ok(bitmap) = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0)
        else {
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
            return Err(CaptureFault::NullFrame);
        };
        let previous = SelectObject(memory, bitmap.into());
        let drawn = match window {
            Some(window) => {
                PrintWindow(window, memory, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool()
            }
            None => BitBlt(
                memory,
                0,
                0,
                width,
                height,
                Some(screen),
                area.x,
                area.y,
                SRCCOPY | CAPTUREBLT,
            )
            .is_ok(),
        };
        if drawn && cursor {
            draw_cursor(memory, area);
        }
        let count = usize::try_from(width).unwrap_or(0) * usize::try_from(height).unwrap_or(0) * 4;
        let bgra = if drawn && !bits.is_null() {
            std::slice::from_raw_parts(bits.cast::<u8>(), count).to_vec()
        } else {
            Vec::new()
        };
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if bgra.is_empty() {
            return Err(CaptureFault::NullFrame);
        }
        Ok(RawFrame {
            width: u32::try_from(width).unwrap_or(0),
            height: u32::try_from(height).unwrap_or(0),
            bgra,
            origin: area,
        })
    }
}

/// Composites the OS pointer at its device-pixel position, before any scaling.
unsafe fn draw_cursor(dc: HDC, area: PhysRect) {
    let mut info = CURSORINFO {
        cbSize: u32::try_from(std::mem::size_of::<CURSORINFO>()).unwrap_or(0),
        ..Default::default()
    };
    // SAFETY: `info` has cbSize set.
    if unsafe { GetCursorInfo(&mut info) }.is_err() || info.flags.0 & CURSOR_SHOWING.0 == 0 {
        return;
    }
    let mut icon = ICONINFO::default();
    // SAFETY: plain out-parameter; the bitmaps it returns are deleted below.
    if unsafe { GetIconInfo(info.hCursor.into(), &mut icon) }.is_err() {
        return;
    }
    let x = info.ptScreenPos.x - area.x - i32::try_from(icon.xHotspot).unwrap_or(0);
    let y = info.ptScreenPos.y - area.y - i32::try_from(icon.yHotspot).unwrap_or(0);
    // SAFETY: `dc` is a live memory DC; the cursor handle is the system's.
    unsafe {
        let _ = DrawIconEx(dc, x, y, info.hCursor.into(), 0, 0, 0, None, DI_NORMAL);
        if !icon.hbmMask.is_invalid() {
            let _ = DeleteObject(icon.hbmMask.into());
        }
        if !icon.hbmColor.is_invalid() {
            let _ = DeleteObject(icon.hbmColor.into());
        }
    }
}
