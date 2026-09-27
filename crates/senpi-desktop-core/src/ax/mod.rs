//! Accessibility tree walking, snapshot rendering, and the `eN` ref registry.

use std::any::Any;
use std::rc::Rc;

pub use crate::backend::AxBackend;

mod ops;
mod registry;
mod render;
mod roles;
mod walk;

pub use ops::{ax_press, element_at_node, query, register_node};
pub use registry::AxRegistry;
pub use render::snapshot;
pub use roles::{normalize_role_atspi, normalize_role_macos, normalize_role_uia};

/// One accessibility element as the backend that produced it addresses it.
///
/// Handles live on the session thread only (`Rc`): platform elements such as
/// `AXUIElement` carry no cross-thread guarantee.
#[derive(Clone)]
pub enum AxHandle {
    /// Numeric element id, for backends that address elements by id.
    Id(u64),
    /// Platform element (AXUIElement, UIElement, AT-SPI object ref) owned by
    /// the backend that created it; that backend downcasts it back.
    Native(Rc<dyn Any>),
}

impl AxHandle {
    pub fn native<T: Any>(element: T) -> Self {
        Self::Native(Rc::new(element))
    }

    /// The platform element when this handle wraps a `T`.
    pub fn downcast_native<T: Any>(&self) -> Option<&T> {
        match self {
            Self::Native(element) => element.downcast_ref(),
            Self::Id(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AxProps {
    pub role: String,
    pub native_role: String,
    pub title: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub bounds: Option<AxBounds>,
    pub actions: Vec<String>,
    pub child_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AxBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(test)]
mod tests;
