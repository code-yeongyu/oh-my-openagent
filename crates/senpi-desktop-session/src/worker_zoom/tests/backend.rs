use std::sync::Arc;

use image::{Rgba, RgbaImage};
use parking_lot::Mutex;
use senpi_desktop_core::backend::{AxBackend, Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopWindow, Target,
};

use crate::test_support::harness;
use crate::worker::Worker;

pub(super) struct State {
    pub captures: Vec<Target>,
    pub displays: Vec<DesktopDisplay>,
    pub window: DesktopWindow,
    pub active: String,
    pub fail: bool,
}

struct ZoomBackend(Arc<Mutex<State>>);

pub(super) fn setup() -> (Worker, Arc<Mutex<State>>) {
    let display = |id: &str, x: i32| DesktopDisplay {
        id: id.into(),
        name: id.into(),
        x,
        y: 0,
        width: 64,
        height: 48,
        scale: 2.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: 128,
        pixel_height: 96,
        is_primary: x == 0,
    };
    let state = Arc::new(Mutex::new(State {
        captures: vec![],
        displays: vec![display("1", 0), display("2", 64)],
        window: DesktopWindow {
            id: "101".into(),
            title: "test".into(),
            app: "test".into(),
            pid: Some(1),
            x: 0,
            y: 0,
            width: 64,
            height: 48,
            focused: true,
            is_on_screen: None,
            elevated: None,
        },
        active: "1".into(),
        fail: false,
    }));
    let mut worker = harness(&serde_json::json!({})).worker;
    worker.backend = Ok(Box::new(ZoomBackend(Arc::clone(&state))));
    (worker, state)
}

impl Backend for ZoomBackend {
    fn capabilities(&mut self) -> DesktopCapabilities {
        DesktopCapabilities::unavailable()
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        Ok(self.0.lock().displays.clone())
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        Ok(vec![self.0.lock().window.clone()])
    }

    fn capture(
        &mut self,
        target: &Target,
        caps: &CaptureCaps,
        _exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let mut state = self.0.lock();
        state.captures.push(target.clone());
        if state.fail {
            return Err(DesktopError::capture_failed("injected failure"));
        }
        let (image, mut frame) = match target {
            Target::Window(_) => {
                let window = &state.window;
                let frame = FrameGeometry::for_window(window, 128, 96);
                (RgbaImage::from_pixel(128, 96, Rgba([0, 0, 0, 255])), frame)
            }
            Target::Desktop | Target::Display(_) => {
                let selected = match target {
                    Target::Desktop => state.active.clone(),
                    Target::Display(key) => key.strip_prefix("display:").unwrap().to_owned(),
                    Target::Window(_) => unreachable!(),
                };
                let displays: Vec<_> = state
                    .displays
                    .iter()
                    .filter(|display| selected == "all" || display.id == selected)
                    .cloned()
                    .collect();
                let frame = FrameGeometry::for_displays(&displays);
                let (width, height) = frame.dimensions();
                (
                    RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255])),
                    frame,
                )
            }
        };
        let color = u8::try_from(state.captures.len()).unwrap();
        let mut image = image;
        for pixel in image.pixels_mut() {
            *pixel = Rgba([color, 0, 0, 255]);
        }
        let image = senpi_desktop_core::frame::apply_capture_caps(image, &mut frame, caps)?;
        Ok((image, frame))
    }

    fn pointer(
        &mut self,
        _: &Target,
        _: PointerEvent,
        _: &FrameGeometry,
        _: DeliveryMode,
    ) -> CoreResult<()> {
        Ok(())
    }
    fn type_text(&mut self, _: &Target, _: &str, _: DeliveryMode) -> CoreResult<()> {
        Ok(())
    }
    fn key_chord(&mut self, _: &Target, _: &[KeyName], _: DeliveryMode) -> CoreResult<()> {
        Ok(())
    }
    fn raise_window(&mut self, _: &str) -> CoreResult<()> {
        Ok(())
    }
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        None
    }
}
