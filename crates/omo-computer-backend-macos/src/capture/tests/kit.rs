//! A scripted macOS capture seam: windows, process starts, AX facts, displays, the SkyLight
//! route and the helper, each recording what it was asked.

use std::collections::BTreeMap;

use image::{ImageBuffer, ImageFormat, Rgba};
use omo_computer_core::backend::Refusal;
use omo_computer_core::listing::Rect;

use crate::capture::helper::{
    FilterKind, FrameSource, HelperFrame, HelperReply, HelperRequest, ShotTarget,
};
use crate::capture::seam::{CaptureHelper, CaptureOs, SkylightCapture};
use crate::capture::types::{AxWindowFacts, CaptureFault, CgWindow, DisplayRecord, RawFrame};

pub const OWN_PID: u32 = 4242;

pub fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

pub fn window(number: u32, pid: u32) -> CgWindow {
    CgWindow {
        number,
        pid,
        owner: format!("App{pid}"),
        title: format!("Window {number}"),
        bounds: rect(10.0, 10.0, 400.0, 300.0),
        layer: 0,
        on_screen: true,
    }
}

pub fn png(width: u32, height: u32, alpha: u8) -> Vec<u8> {
    let image = ImageBuffer::from_pixel(width, height, Rgba([200u8, 40, 40, alpha]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, ImageFormat::Png).expect("png");
    bytes.into_inner()
}

/// The helper fake: answers stills and stream frames, and records every request.
#[derive(Default)]
pub struct FakeHelper {
    pub requests: Vec<HelperRequest>,
    /// Display stills echo no exclusions (the helper could not remove them).
    pub drop_exclusions: bool,
    /// Stills come back marked as stream frames.
    pub stills_from_stream: bool,
    pub frame: Option<(u32, u32)>,
}

impl FakeHelper {
    fn reply(
        id: u64,
        source: Option<FrameSource>,
        filter: Option<FilterKind>,
        png: Vec<u8>,
    ) -> HelperFrame {
        HelperFrame {
            reply: HelperReply {
                id,
                ok: true,
                error: None,
                source,
                filter,
                excluded: Vec::new(),
                png_bytes: png.len(),
            },
            png,
        }
    }

    pub fn stream_requests(&self) -> usize {
        self.requests
            .iter()
            .filter(|r| !matches!(r, HelperRequest::Screenshot { .. }))
            .count()
    }
}

impl CaptureHelper for FakeHelper {
    fn call(&mut self, request: &HelperRequest) -> Result<HelperFrame, CaptureFault> {
        self.requests.push(request.clone());
        let (w, h) = self.frame.unwrap_or((8, 4));
        Ok(match request {
            HelperRequest::Screenshot {
                id,
                target,
                exclude,
                ..
            } => {
                let source = Some(if self.stills_from_stream {
                    FrameSource::Stream
                } else {
                    FrameSource::Screenshot
                });
                let filter = Some(match target {
                    ShotTarget::Window { .. } => FilterKind::Window,
                    ShotTarget::Display { .. } => FilterKind::Display,
                });
                let mut frame = Self::reply(*id, source, filter, png(w, h, 255));
                if !self.drop_exclusions {
                    frame.reply.excluded.clone_from(exclude);
                }
                frame
            }
            HelperRequest::StreamFrame { id, .. } => Self::reply(
                *id,
                Some(FrameSource::Stream),
                Some(FilterKind::Window),
                png(w, h, 255),
            ),
            other => Self::reply(other.id(), None, None, Vec::new()),
        })
    }
}

pub struct FakeSkylight {
    pub calls: u32,
    pub alpha: u8,
}

impl SkylightCapture for FakeSkylight {
    fn capture_window(&mut self, _number: u32) -> Result<RawFrame, CaptureFault> {
        self.calls += 1;
        Ok(RawFrame {
            width: 4,
            height: 2,
            rgba: [10, 20, 30, self.alpha].repeat(8),
        })
    }
}

/// The OS fake.
#[derive(Default)]
pub struct FakeOs {
    pub windows: Vec<CgWindow>,
    pub starts: BTreeMap<u32, u64>,
    pub start_reads: BTreeMap<u32, u32>,
    pub ax: BTreeMap<u32, AxWindowFacts>,
    pub frontmost: Option<u32>,
    pub spaces: BTreeMap<u32, String>,
    pub displays: Vec<DisplayRecord>,
    pub skylight: Option<FakeSkylight>,
    pub helper: FakeHelper,
}

impl FakeOs {
    pub fn with_windows(windows: Vec<CgWindow>) -> Self {
        let starts = windows
            .iter()
            .map(|w| (w.pid, 1_000 + u64::from(w.pid)))
            .collect();
        Self {
            windows,
            starts,
            displays: vec![DisplayRecord {
                id: 1,
                bounds: rect(0.0, 0.0, 1440.0, 900.0),
                pixel_width: 2880,
                pixel_height: 1800,
                main: true,
            }],
            ..Self::default()
        }
    }
}

impl CaptureOs for FakeOs {
    fn window_list(&mut self) -> Result<Vec<CgWindow>, Refusal> {
        Ok(self.windows.clone())
    }

    fn process_start(&mut self, pid: u32) -> Option<u64> {
        *self.start_reads.entry(pid).or_default() += 1;
        self.starts.get(&pid).copied()
    }

    fn bundle_id(&mut self, pid: u32) -> Option<String> {
        Some(format!("com.example.app{pid}"))
    }

    fn frontmost_pid(&mut self) -> Option<u32> {
        self.frontmost
    }

    fn ax_window(&mut self, window: &CgWindow) -> Option<AxWindowFacts> {
        self.ax.get(&window.number).cloned()
    }

    fn space_of(&mut self, number: u32) -> Option<String> {
        self.spaces.get(&number).cloned()
    }

    fn displays(&mut self) -> Result<Vec<DisplayRecord>, Refusal> {
        Ok(self.displays.clone())
    }

    fn skylight(&mut self) -> Option<&mut dyn SkylightCapture> {
        self.skylight
            .as_mut()
            .map(|s| s as &mut dyn SkylightCapture)
    }

    fn helper(&mut self) -> Result<&mut dyn CaptureHelper, CaptureFault> {
        Ok(&mut self.helper)
    }
}
