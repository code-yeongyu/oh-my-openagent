//! The markers of a session with no RUNTIME root: the self-test and in-process tests.

use std::collections::BTreeMap;
use std::io;

use crate::marker::{MarkerRead, MarkerStore, PreInputMarker};

/// Markers of a session with no RUNTIME root (the self-test and in-process tests).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MemoryMarkers {
    markers: BTreeMap<(String, String), PreInputMarker>,
}

impl MarkerStore for MemoryMarkers {
    fn read(&self, issuer: &str, scope: &str) -> MarkerRead {
        self.markers
            .get(&(issuer.to_owned(), scope.to_owned()))
            .map_or(MarkerRead::Absent, |marker| {
                MarkerRead::Found(Box::new(marker.clone()))
            })
    }

    fn create(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let key = (marker.binding.issuer.clone(), marker.binding.scope.clone());
        if self.markers.contains_key(&key) {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        self.markers.insert(key, marker.clone());
        Ok(())
    }

    fn record_receipt(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let key = (marker.binding.issuer.clone(), marker.binding.scope.clone());
        self.markers.insert(key, marker.clone());
        Ok(())
    }

    fn clear(&mut self, issuer: &str, scope: &str) -> io::Result<()> {
        self.markers.remove(&(issuer.to_owned(), scope.to_owned()));
        Ok(())
    }
}
