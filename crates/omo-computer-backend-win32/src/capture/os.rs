//! The Windows side of [`CaptureOs`]: WGC ([`super::wgc`]), the GDI floors
//! ([`super::gdi`]), DWM window facts, the session id and the OCR engine.

use windows::core::factory;
use windows::Graphics::Capture::{GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11DeviceContext};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindow};

use super::gdi::gdi;
use super::{CaptureFault, CaptureOs, RawFrame, WindowFacts};
use crate::displays::{self, Monitor, PhysRect};
use crate::ocr::{self, OcrProbe};

/// Sets per-monitor-v2 DPI awareness; a process already per-monitor aware keeps its context.
pub(crate) fn set_dpi_awareness() {
    // SAFETY: a process-wide setting with no pointer arguments; failure means already set.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
}

/// The live Windows capture seam.
#[derive(Default)]
pub struct Os {
    pub(super) device: Option<(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice)>,
}

// SAFETY: the D3D11 device is created with default (thread-safe) flags and the WinRT device
// wrapper is agile; the engine drives one backend from one thread at a time.
unsafe impl Send for Os {}

fn hwnd(handle: isize) -> HWND {
    HWND(handle as *mut core::ffi::c_void)
}

fn frame_bounds(window: HWND) -> Option<PhysRect> {
    let mut rect = RECT::default();
    // SAFETY: a RECT-sized out-buffer for DWMWA_EXTENDED_FRAME_BOUNDS.
    unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            std::ptr::addr_of_mut!(rect).cast(),
            u32::try_from(std::mem::size_of::<RECT>()).ok()?,
        )
    }
    .ok()?;
    Some(phys(rect))
}

const fn phys(rect: RECT) -> PhysRect {
    PhysRect {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    }
}

impl CaptureOs for Os {
    fn session_id(&self) -> u32 {
        let mut session = 0;
        // SAFETY: plain out-parameter for the current process.
        match unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session) } {
            Ok(()) => session,
            Err(_) => 0,
        }
    }

    fn wgc_supported(&mut self) -> bool {
        GraphicsCaptureSession::IsSupported().unwrap_or(false)
    }

    fn monitors(&mut self) -> Result<Vec<Monitor>, omo_computer_core::backend::Refusal> {
        Ok(displays::enumerate())
    }

    fn window(&mut self, handle: isize) -> Option<WindowFacts> {
        let window = hwnd(handle);
        // SAFETY: IsWindow accepts any value.
        if !unsafe { IsWindow(Some(window)) }.as_bool() {
            return None;
        }
        let mut cloaked = 0u32;
        // SAFETY: a u32 out-buffer for DWMWA_CLOAKED.
        let cloak = unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                std::ptr::addr_of_mut!(cloaked).cast(),
                4,
            )
        };
        Some(WindowFacts {
            // SAFETY: a live window handle.
            iconic: unsafe { IsIconic(window) }.as_bool(),
            cloaked: cloak.is_ok() && cloaked != 0,
            frame_bounds: frame_bounds(window)?,
        })
    }

    fn wgc_window(&mut self, handle: isize, cursor: bool) -> Result<RawFrame, CaptureFault> {
        let window = hwnd(handle);
        let origin = frame_bounds(window).ok_or(CaptureFault::ItemUnavailable)?;
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        // SAFETY: a live window handle.
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window) }
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        self.wgc(&item, origin, cursor)
    }

    fn wgc_monitor(&mut self, monitor: &Monitor, cursor: bool) -> Result<RawFrame, CaptureFault> {
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        // SAFETY: an HMONITOR read by EnumDisplayMonitors in this epoch.
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForMonitor(HMONITOR(monitor.handle as *mut core::ffi::c_void)) }
                .map_err(|_| CaptureFault::ItemUnavailable)?;
        self.wgc(&item, monitor.bounds, cursor)
    }

    fn print_window(&mut self, handle: isize, cursor: bool) -> Result<RawFrame, CaptureFault> {
        let window = hwnd(handle);
        let mut rect = RECT::default();
        // SAFETY: plain out-parameter.
        unsafe { GetWindowRect(window, &mut rect) }.map_err(|_| CaptureFault::NullFrame)?;
        gdi(phys(rect), Some(window), cursor)
    }

    fn bitblt_monitor(
        &mut self,
        monitor: &Monitor,
        cursor: bool,
    ) -> Result<RawFrame, CaptureFault> {
        gdi(monitor.bounds, None, cursor)
    }

    fn ocr_probe(&mut self) -> OcrProbe {
        ocr::probe()
    }

    fn recognize(
        &mut self,
        frame: &RawFrame,
    ) -> Option<Vec<omo_computer_core::observation::OcrLine>> {
        ocr::recognize(frame).ok()
    }
}
