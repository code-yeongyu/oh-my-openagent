//! Windows background delivery (row 58, d-windows.md '## Background delivery limits'): the family
//! drop matrix as data, the integrity (UIPI) gate, the deliverer of one event to one addressed
//! window (the backend serves it on row 21a's `Route::BackgroundWindow{window}` once the session
//! carries that route), and the observed-not-confirmed rule for an effect only an
//! accessibility notification saw.

pub mod family;
pub mod hit;
pub mod integrity;
pub mod matrix;
pub mod messages;
pub mod observation;
pub mod post;
pub mod target;

#[cfg(windows)]
pub mod os;

#[cfg(test)]
mod tests;

/// The live seam on Windows; elsewhere there is none.
#[must_use]
pub fn live() -> Option<Box<dyn target::DeliveryOs>> {
    #[cfg(windows)]
    {
        Some(Box::new(os::Os))
    }
    #[cfg(not(windows))]
    {
        None
    }
}
