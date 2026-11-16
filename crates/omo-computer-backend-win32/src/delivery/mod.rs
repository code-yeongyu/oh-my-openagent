//! Windows background delivery (row 58, d-windows.md '## Background delivery limits'): the
//! family drop matrix as data, the integrity (UIPI) gate, and the observed-not-confirmed rule
//! for an effect only an accessibility notification saw.

pub mod family;
pub mod integrity;
pub mod observation;

#[cfg(test)]
mod tests;
