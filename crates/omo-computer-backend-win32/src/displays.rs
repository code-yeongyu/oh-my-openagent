//! `displays()`: `EnumDisplayMonitors` + `GetMonitorInfoW` + `GetDpiForMonitor(MDT_EFFECTIVE_DPI)`,
//! every monitor in physical pixels with `scale = dpi / 96` as metadata (d-windows.md
//! '## Windows and DPI', 'Displays' and 'DPI regime'). The process is per-monitor-v2 aware
//! from construction, so every rectangle read here is in device pixels.

use omo_computer_core::listing::Rect;
use omo_computer_core::results::DisplayInfo;

/// The DPI Windows calls 100 % (`USER_DEFAULT_SCREEN_DPI`).
pub const BASE_DPI: u32 = 96;

/// A rectangle in physical (device) pixels of the virtual screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PhysRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl PhysRect {
    #[must_use]
    pub const fn right(&self) -> i32 {
        self.x + self.width
    }

    #[must_use]
    pub const fn bottom(&self) -> i32 {
        self.y + self.height
    }

    /// The area this rectangle shares with `other`, in pixels.
    #[must_use]
    pub fn overlap(&self, other: &Self) -> i64 {
        let width = i64::from(self.right().min(other.right()) - self.x.max(other.x));
        let height = i64::from(self.bottom().min(other.bottom()) - self.y.max(other.y));
        width.max(0) * height.max(0)
    }

    /// This rectangle shrunk by `by` pixels on every side (never below zero).
    #[must_use]
    pub fn inset(&self, by: i32) -> Self {
        Self {
            x: self.x + by,
            y: self.y + by,
            width: (self.width - 2 * by).max(0),
            height: (self.height - 2 * by).max(0),
        }
    }

    /// The smallest rectangle covering every one of `rects`.
    #[must_use]
    pub fn bounding(rects: &[Self]) -> Self {
        let Some(first) = rects.first() else {
            return Self::default();
        };
        let (mut left, mut top, mut right, mut bottom) =
            (first.x, first.y, first.right(), first.bottom());
        for rect in rects {
            left = left.min(rect.x);
            top = top.min(rect.y);
            right = right.max(rect.right());
            bottom = bottom.max(rect.bottom());
        }
        Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    #[must_use]
    pub fn to_rect(&self) -> Rect {
        Rect {
            x: f64::from(self.x),
            y: f64::from(self.y),
            width: f64::from(self.width),
            height: f64::from(self.height),
        }
    }
}

/// One monitor as `EnumDisplayMonitors` reports it; also the display-identity fingerprint
/// `{deviceName, hmonitor, bounds, primary, dpi}` read before and after every capture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Monitor {
    /// `MONITORINFOEXW.szDevice`, e.g. `\\.\DISPLAY1`; the display id on the wire.
    pub device_name: String,
    /// The `HMONITOR`.
    pub handle: isize,
    pub bounds: PhysRect,
    pub primary: bool,
    /// `GetDpiForMonitor(MDT_EFFECTIVE_DPI)`.
    pub dpi: u32,
}

impl Monitor {
    /// The per-monitor scale: effective DPI over 96.
    #[must_use]
    pub fn scale(&self) -> f64 {
        f64::from(self.dpi) / f64::from(BASE_DPI)
    }

    #[must_use]
    pub fn info(&self) -> DisplayInfo {
        DisplayInfo {
            id: self.device_name.clone(),
            bounds: self.bounds.to_rect(),
            scale: self.scale(),
            primary: self.primary,
            truncated: None,
        }
    }
}

/// The monitor sharing the largest area with `rect`; a tie goes to the primary.
#[must_use]
pub fn monitor_for<'a>(monitors: &'a [Monitor], rect: &PhysRect) -> Option<&'a Monitor> {
    monitors
        .iter()
        .max_by_key(|monitor| (monitor.bounds.overlap(rect), monitor.primary))
}

#[cfg(windows)]
pub(crate) use os::enumerate;

#[cfg(windows)]
mod os {
    use super::{Monitor, PhysRect};
    use windows::core::BOOL;
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _dc: HDC,
        _clip: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        // SAFETY: `data` is the address of the Vec passed by `enumerate`, alive for the call.
        let handles = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
        handles.push(monitor);
        BOOL(1)
    }

    /// Every monitor of the session, in enumeration order.
    pub(crate) fn enumerate() -> Vec<Monitor> {
        let mut handles: Vec<HMONITOR> = Vec::new();
        // SAFETY: the callback only pushes into `handles`, which outlives the call.
        let _ = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(collect),
                LPARAM(std::ptr::addr_of_mut!(handles) as isize),
            )
        };
        handles.into_iter().filter_map(read).collect()
    }

    fn read(handle: HMONITOR) -> Option<Monitor> {
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = u32::try_from(std::mem::size_of::<MONITORINFOEXW>()).ok()?;
        // SAFETY: `info` is a MONITORINFOEXW with cbSize set, as GetMonitorInfoW requires.
        let ok =
            unsafe { GetMonitorInfoW(handle, std::ptr::addr_of_mut!(info).cast::<MONITORINFO>()) };
        if !ok.as_bool() {
            return None;
        }
        let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
        // SAFETY: plain out-parameters.
        unsafe { GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) }.ok()?;
        let device = &info.szDevice;
        let len = device
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(device.len());
        let rect = info.monitorInfo.rcMonitor;
        Some(Monitor {
            device_name: String::from_utf16_lossy(&device[..len]),
            handle: handle.0 as isize,
            bounds: PhysRect {
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
            },
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            dpi: dpi_x,
        })
    }
}
