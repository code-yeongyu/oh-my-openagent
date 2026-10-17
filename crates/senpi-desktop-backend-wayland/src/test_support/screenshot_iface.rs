//! The fake `org.freedesktop.portal.Screenshot`: a granted request writes
//! a fresh PNG to a temp file and answers with its `file://` URI, like
//! xdg-desktop-portal-wlr.

use std::collections::HashMap;
use std::sync::Arc;

use image::{Rgba, RgbaImage};
use zbus::message::Header;
use zbus::zvariant::{OwnedObjectPath, Value};
use zbus::{fdo, interface, Connection};

use super::fake_portal::{Shot, State};
use super::portal_ifaces::{absent, respond, Options};

/// The fake screenshot's top-left pixel; every other pixel is black.
pub const CORNER: Rgba<u8> = Rgba([11, 22, 33, 255]);

pub struct ScreenshotPortal(Arc<State>);

impl ScreenshotPortal {
    pub const fn new(state: Arc<State>) -> Self {
        Self(state)
    }

    fn shot(&self) -> fdo::Result<Shot> {
        match self.0.mode().screenshot {
            Shot::Absent => Err(absent("org.freedesktop.portal.Screenshot")),
            shot @ (Shot::Deny | Shot::Png { .. }) => Ok(shot),
        }
    }

    /// Writes a `width` x `height` PNG and returns its `file://` URI.
    fn write_png(&self, width: u32, height: u32) -> fdo::Result<String> {
        let failed = |error: &dyn std::fmt::Display| fdo::Error::Failed(error.to_string());
        let (_file, path) = tempfile::Builder::new()
            .prefix("senpi-fake-shot-")
            .suffix(".png")
            .tempfile()
            .map_err(|error| failed(&error))?
            .keep()
            .map_err(|error| failed(&error))?;
        let mut image = RgbaImage::new(width, height);
        image.put_pixel(0, 0, CORNER);
        image.save(&path).map_err(|error| failed(&error))?;
        self.0.recorded().shots.push(path.clone());
        Ok(format!("file://{}", path.display()))
    }
}

#[interface(name = "org.freedesktop.portal.Screenshot")]
impl ScreenshotPortal {
    #[zbus(property, name = "version")]
    fn version(&self) -> fdo::Result<u32> {
        self.shot().map(|_| 2)
    }

    async fn screenshot(
        &self,
        _parent_window: String,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        if let Some(value) = options.get("interactive") {
            self.0.recorded().interactive = value.downcast_ref::<bool>().ok();
        }
        let answer = match self.shot()? {
            Shot::Png { width, height } => {
                let uri = self.write_png(width, height)?;
                (0, HashMap::from([("uri", Value::from(uri))]))
            }
            Shot::Deny | Shot::Absent => (1, HashMap::new()),
        };
        respond(connection, &header, &options, answer).await
    }
}
