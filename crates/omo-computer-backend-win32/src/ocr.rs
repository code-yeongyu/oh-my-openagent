//! OCR: `Windows.Media.Ocr` behind `capabilities.ocr`, used only on an empty or AX-blind tree
//! in `auto` mode or on request, never in the default observe payload (d-vision.md '## OCR').
//! The engine is the in-box one; nothing is bundled.

use omo_computer_core::params::OcrMode;

/// At most this many characters of OCR text per observation (d-vision.md '## OCR', budgets).
pub const TEXT_CAP_CHARS: usize = 4_096;
/// The per-window cooldown of `auto` mode (d-vision.md '## OCR', budgets).
pub const AUTO_COOLDOWN_MS: u64 = 2_000;
/// The engine name the observation reports.
pub const ENGINE: &str = "windows.media.ocr";

/// The OCR availability probe: engine creation succeeded and a language pack exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OcrProbe {
    pub available: bool,
    pub reason: Option<&'static str>,
    pub languages: Vec<String>,
}

impl OcrProbe {
    #[must_use]
    pub const fn unavailable(reason: &'static str) -> Self {
        Self {
            available: false,
            reason: Some(reason),
            languages: Vec::new(),
        }
    }
}

/// Whether an observation runs OCR. `mode` is `ObserveOptions.ocr` (absent reads `auto`);
/// `auto` runs only when the tree is empty (`nodes_observed == 0`) or the window is AX-blind
/// and the window's cooldown has elapsed; `always` runs on request; `never` and a host
/// without the capability never run.
#[must_use]
pub fn decide(
    mode: Option<OcrMode>,
    capability: bool,
    nodes_observed: u32,
    ax_blind: bool,
    cooldown_elapsed: bool,
) -> bool {
    if !capability {
        return false;
    }
    match mode.unwrap_or(OcrMode::Auto) {
        OcrMode::Never => false,
        OcrMode::Always => true,
        OcrMode::Auto => (nodes_observed == 0 || ax_blind) && cooldown_elapsed,
    }
}

/// Cuts recognised lines to the text cap; `true` when anything was dropped.
#[must_use]
pub fn cap_lines(lines: &mut Vec<omo_computer_core::observation::OcrLine>) -> bool {
    let mut used = 0usize;
    let mut keep = 0usize;
    for line in lines.iter() {
        let length = line.text.chars().count();
        if used + length > TEXT_CAP_CHARS {
            break;
        }
        used += length;
        keep += 1;
    }
    let truncated = keep < lines.len();
    lines.truncate(keep);
    truncated
}

#[cfg(windows)]
pub(crate) use os::{probe, recognize};

#[cfg(windows)]
mod os {
    use super::OcrProbe;
    use crate::capture::RawFrame;
    use omo_computer_core::listing::Rect;
    use omo_computer_core::observation::OcrLine;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    fn engine() -> windows::core::Result<OcrEngine> {
        OcrEngine::TryCreateFromUserProfileLanguages()
    }

    /// Engine creation is the probe; it never prompts.
    pub(crate) fn probe() -> OcrProbe {
        match engine() {
            Ok(engine) => OcrProbe {
                available: true,
                reason: None,
                languages: engine
                    .RecognizerLanguage()
                    .and_then(|language| language.LanguageTag())
                    .map(|tag| vec![tag.to_string()])
                    .unwrap_or_default(),
            },
            Err(_) => OcrProbe::unavailable("no_language_pack"),
        }
    }

    /// Recognises the lines of one frame; boxes are in the frame's pixels. A frame above
    /// `OcrEngine.MaxImageDimension` is sampled down first and the boxes scaled back.
    pub(crate) fn recognize(frame: &RawFrame) -> windows::core::Result<Vec<OcrLine>> {
        let engine = engine()?;
        let max = OcrEngine::MaxImageDimension()?;
        let step = frame.width.max(frame.height).div_ceil(max).max(1);
        let (width, height, bgra) = sample(frame, step);
        let writer = DataWriter::new()?;
        writer.WriteBytes(&bgra)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            i32::try_from(width).unwrap_or(i32::MAX),
            i32::try_from(height).unwrap_or(i32::MAX),
            BitmapAlphaMode::Premultiplied,
        )?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let scale = f64::from(step);
        let mut lines = Vec::new();
        for line in result.Lines()? {
            let mut area: Option<Rect> = None;
            for word in line.Words()? {
                let r = word.BoundingRect()?;
                let next = Rect {
                    x: f64::from(r.X) * scale,
                    y: f64::from(r.Y) * scale,
                    width: f64::from(r.Width) * scale,
                    height: f64::from(r.Height) * scale,
                };
                area = Some(area.map_or(next, |a| union(&a, &next)));
            }
            lines.push(OcrLine {
                text: line.Text()?.to_string(),
                area: area.unwrap_or(Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                }),
                confidence: None,
            });
        }
        Ok(lines)
    }

    fn union(a: &Rect, b: &Rect) -> Rect {
        let left = a.x.min(b.x);
        let top = a.y.min(b.y);
        Rect {
            x: left,
            y: top,
            width: (a.x + a.width).max(b.x + b.width) - left,
            height: (a.y + a.height).max(b.y + b.height) - top,
        }
    }

    fn sample(frame: &RawFrame, step: u32) -> (u32, u32, Vec<u8>) {
        if step == 1 {
            return (frame.width, frame.height, frame.bgra.clone());
        }
        let width = frame.width / step;
        let height = frame.height / step;
        let stride = frame.width as usize * 4;
        let mut out = Vec::with_capacity(width as usize * height as usize * 4);
        for y in 0..height as usize {
            for x in 0..width as usize {
                let at = y * step as usize * stride + x * step as usize * 4;
                out.extend_from_slice(&frame.bgra[at..at + 4]);
            }
        }
        (width, height, out)
    }
}
