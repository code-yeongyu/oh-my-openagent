//! Parsed pointer options and the per-target capture frame cache.

use std::collections::HashMap;

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::parse_modifiers;
use senpi_desktop_core::types::{PointerOptions, Target};

#[derive(Debug, Clone, Copy)]
pub(crate) struct ParsedPointerOptions {
    pub(crate) button: MouseButton,
    pub(crate) count: u32,
    pub(crate) modifiers: Modifiers,
    pub(crate) mode: DeliveryMode,
}

impl ParsedPointerOptions {
    pub(crate) fn parse(options: Option<&PointerOptions>) -> CoreResult<Self> {
        let default = PointerOptions::default();
        let options = options.unwrap_or(&default);
        Ok(Self {
            button: MouseButton::parse(options.button.as_deref())?,
            count: options.count.unwrap_or(1).max(1),
            modifiers: parse_modifiers(options.modifiers.as_deref().unwrap_or_default())?,
            mode: DeliveryMode::parse(options.delivery_mode.as_deref()),
        })
    }

    /// The delivery mode alone, known before the options are validated so
    /// the input transaction can capture what that mode disturbs.
    pub(crate) fn requested_mode(options: Option<&PointerOptions>) -> DeliveryMode {
        DeliveryMode::parse(options.and_then(|options| options.delivery_mode.as_deref()))
    }
}

struct CapturedFrame {
    id: String,
    geometry: FrameGeometry,
}

/// The latest capture of every target; coordinate input maps through it.
#[derive(Default)]
pub(crate) struct FrameCache {
    captures: u64,
    latest: HashMap<String, CapturedFrame>,
}

impl FrameCache {
    /// Records a new capture of `target` and returns its frame id.
    pub(crate) fn record(&mut self, target: &Target, geometry: FrameGeometry) -> String {
        self.captures = self.captures.saturating_add(1);
        let id = format!("frame-{}", self.captures);
        let frame = CapturedFrame {
            id: id.clone(),
            geometry,
        };
        self.latest.insert(target.key().to_owned(), frame);
        id
    }

    /// The id of the latest capture of the target keyed `target_key`.
    pub(crate) fn latest_id(&self, target_key: &str) -> Option<&str> {
        self.latest.get(target_key).map(|frame| frame.id.as_str())
    }

    /// The geometry of `target`'s latest capture; a named `frame_id` must be
    /// that capture.
    pub(crate) fn latest(&self, target: &Target, frame_id: Option<&str>) -> CoreResult<FrameGeometry> {
        let key = target.key();
        let frame = self.latest.get(key).ok_or_else(|| {
            DesktopError::invalid_coordinate_frame(format!(
                "no capture of '{key}' yet - take a screenshot of this target first; coordinate input is \
                 in pixels of that screenshot"
            ))
        })?;
        match frame_id {
            Some(requested) if requested != frame.id => Err(DesktopError::invalid_coordinate_frame(format!(
                "{requested} is not the latest capture of '{key}' ({}); capture it again before coordinate \
                 input",
                frame.id
            ))),
            Some(_) | None => Ok(frame.geometry.clone()),
        }
    }
}
