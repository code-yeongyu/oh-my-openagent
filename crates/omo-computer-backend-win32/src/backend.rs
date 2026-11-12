//! The Windows backend: capture, displays and OCR in this row; input, the foreground lease,
//! background delivery, UI Automation, windows and permissions arrive in rows 56-60.

use omo_computer_core::backend::{
    refusing_capabilities, Backend, BackendResult, CaptureOptions, FrameBytes, Refusal, Target,
};
use omo_computer_core::capabilities::{
    Availability, Capabilities, CaptureCapability, CaptureRoute,
};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::ImageMime;
use omo_computer_core::results::DisplayInfo;

use omo_computer_core::observation::Ocr;

use crate::capture::{self, encode_png, CaptureOs, FrameRecord, RawFrame, SESSION0};
use crate::ocr::{cap_lines, OcrProbe, ENGINE};

/// The backend name `capabilities()` reports.
pub const BACKEND: &str = "win32";

/// The Windows backend over a [`CaptureOs`].
pub struct Win32Backend<O: CaptureOs> {
    os: O,
    /// `GraphicsCaptureSession::IsSupported()`, read once when the backend is built.
    wgc: bool,
    ocr: OcrProbe,
}

#[cfg(windows)]
impl Win32Backend<capture::os::Os> {
    /// The live backend: per-monitor-v2 DPI awareness first, then the capture probes.
    #[must_use]
    pub fn new() -> Self {
        capture::os::set_dpi_awareness();
        Self::with_os(capture::os::Os::default())
    }
}

#[cfg(windows)]
impl Default for Win32Backend<capture::os::Os> {
    fn default() -> Self {
        Self::new()
    }
}

impl<O: CaptureOs> Win32Backend<O> {
    /// A backend over `os`; `IsSupported` and the OCR probe are read now, once.
    pub fn with_os(mut os: O) -> Self {
        let wgc = os.session_id() != 0 && os.wgc_supported();
        let ocr = os.ocr_probe();
        Self { os, wgc, ocr }
    }

    /// The OS seam (tests read what was called).
    pub const fn os(&self) -> &O {
        &self.os
    }

    /// One capture with its frame record.
    ///
    /// # Errors
    /// As [`capture::capture`].
    pub fn capture_record(
        &mut self,
        target: &Target,
        options: &CaptureOptions,
    ) -> BackendResult<FrameRecord> {
        capture::capture(&mut self.os, self.wgc, target, options)
    }

    /// OCR of one captured frame, run only when [`crate::ocr::decide`] says so. A host without
    /// the engine reports nothing; a failed recognition reports `truncated` with no lines and
    /// never fails the observation (d-vision.md '## OCR').
    pub fn ocr(&mut self, frame_id: &str, record: &FrameRecord) -> Option<Ocr> {
        if !self.ocr.available {
            return None;
        }
        let frame = RawFrame {
            width: record.width,
            height: record.height,
            bgra: record.bgra.clone(),
            origin: record.physical,
        };
        let (mut lines, failed) = self
            .os
            .recognize(&frame)
            .map_or((Vec::new(), true), |lines| (lines, false));
        let truncated = cap_lines(&mut lines) || failed;
        Some(Ocr {
            engine: ENGINE.to_owned(),
            languages: self.ocr.languages.clone(),
            lines,
            truncated,
            frame_id: frame_id.to_owned(),
        })
    }

    /// The OCR probe this backend advertises.
    pub const fn ocr_probe(&self) -> &OcrProbe {
        &self.ocr
    }

    fn route(&self) -> CaptureRoute {
        if self.wgc {
            CaptureRoute::Wgc
        } else {
            CaptureRoute::PrintWindow
        }
    }
}

impl<O: CaptureOs> Backend for Win32Backend<O> {
    fn capabilities(&self) -> Capabilities {
        let interactive = self.os.session_id() != 0;
        let reason = (!interactive).then(|| "not_interactive".to_owned());
        let mut capabilities = refusing_capabilities();
        capabilities.backend = BACKEND.to_owned();
        capabilities.capture = CaptureCapability {
            available: interactive,
            reason: reason.clone(),
            route: interactive.then(|| self.route()),
        };
        capabilities.window_capture = Availability {
            available: interactive,
            reason,
        };
        capabilities.ocr = self.ocr.available;
        capabilities
    }

    // Row 57: the low-level hook listener; off Windows the refusing default stands.
    #[cfg(windows)]
    fn stop_listener(&mut self) -> BackendResult<Box<dyn omo_computer_core::backend::StopListener>> {
        Ok(Box::new(crate::stop_path::hook::HookListener::start()))
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        if self.os.session_id() == 0 {
            return Err(SESSION0);
        }
        Ok(self
            .os
            .monitors()?
            .iter()
            .map(crate::displays::Monitor::info)
            .collect())
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        let record = self.capture_record(target, options)?;
        let bytes = encode_png(record.width, record.height, &record.bgra)
            .map_err(|_| Refusal::bare(EngineCode::CaptureFailed))?;
        Ok(FrameBytes {
            width: record.width,
            height: record.height,
            mime: ImageMime::Png,
            bytes,
        })
    }
}
