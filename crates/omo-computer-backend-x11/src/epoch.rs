//! The X11 epoch source (design row L10): a RandR flip (a monitor added, removed, moved,
//! resized or a new primary) emits `epoch.changed{display}`, and an `Xft.dpi` change emits
//! `epoch.changed{scale}`. Each read compares the server's layout with the one seen last, on a
//! connection of the source's own.

use omo_computer_core::backend::{BackendResult, EpochChange, EpochSource, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::frame::EpochReason;

use crate::capture::server::{Monitor, XServer};
use crate::monitors::xft_dpi;

#[derive(Debug, Clone, PartialEq)]
struct Layout {
    monitors: Vec<(String, bool, i32, i32, u32, u32)>,
    dpi: Option<f64>,
}

fn layout_of(monitors: &[Monitor], resources: Option<&str>) -> Layout {
    let mut monitors: Vec<_> = monitors
        .iter()
        .map(|m| {
            (
                m.name.clone(),
                m.primary,
                m.rect.x,
                m.rect.y,
                m.rect.width,
                m.rect.height,
            )
        })
        .collect();
    monitors.sort_by(|a, b| a.0.cmp(&b.0));
    Layout {
        monitors,
        dpi: resources.and_then(xft_dpi),
    }
}

pub struct X11EpochSource<S> {
    server: S,
    seen: Option<Layout>,
}

impl<S: XServer> X11EpochSource<S> {
    /// Starts from the layout the server shows now, so the first read reports only a change.
    #[must_use]
    pub fn new(server: S) -> Self {
        let seen = Self::read(&server).ok();
        Self { server, seen }
    }

    fn read(server: &S) -> Result<Layout, Refusal> {
        let failed = |_| Refusal::new(EngineCode::Internal, "epoch_source_unsupported");
        let monitors = server.monitors().map_err(failed)?;
        let resources = server.resource_manager().map_err(failed)?;
        Ok(layout_of(&monitors, resources.as_deref()))
    }

    #[cfg(test)]
    pub(crate) fn server_mut(&mut self) -> &mut S {
        &mut self.server
    }
}

impl<S: XServer> EpochSource for X11EpochSource<S> {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        let now = Self::read(&self.server)?;
        let reason = match &self.seen {
            None => None,
            Some(seen) if seen.monitors != now.monitors => Some(EpochReason::Display),
            Some(seen) if seen.dpi != now.dpi => Some(EpochReason::Scale),
            Some(_) => None,
        };
        self.seen = Some(now);
        Ok(reason.map(|reason| EpochChange {
            reason: reason.wire().to_owned(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::fake::FakeX;

    #[test]
    fn randr_flip_emits_epoch_changed() {
        let mut source = X11EpochSource::new(FakeX::two_screens());
        assert_eq!(source.next_change(), Ok(None), "nothing changed yet");

        let monitors = &mut source.server_mut().monitors;
        monitors.swap(0, 1);
        assert_eq!(
            source.next_change(),
            Ok(None),
            "listing order alone is no flip"
        );

        let first = &mut source.server_mut().monitors[0];
        first.rect.x += 1920;
        first.primary = !first.primary;
        assert_eq!(
            source.next_change().map(|c| c.map(|c| c.reason)),
            Ok(Some("display".to_owned()))
        );
        assert_eq!(source.next_change(), Ok(None), "one change, one event");

        source.server_mut().monitors.pop();
        assert_eq!(
            source.next_change().map(|c| c.map(|c| c.reason)),
            Ok(Some("display".to_owned())),
            "a removed monitor"
        );
    }

    #[test]
    fn an_xft_dpi_change_emits_a_scale_epoch() {
        let mut source = X11EpochSource::new(FakeX::two_screens());
        source.server_mut().resources = Some("Xft.dpi:\t192\n".to_owned());
        assert_eq!(
            source.next_change().map(|c| c.map(|c| c.reason)),
            Ok(Some("scale".to_owned()))
        );
    }
}
