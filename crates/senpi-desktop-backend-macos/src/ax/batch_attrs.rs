//! Object-mode element reads: one `AXUIElementCopyMultipleAttributeValues`
//! call per node for the attributes a walk renders, with each attribute's own
//! error deciding its evidence (known, absent, or unknown).

use std::ptr::{self, NonNull};

use objc2_application_services::{
    AXCopyMultipleAttributeOptions, AXError, AXUIElement, AXValue, AXValueType,
};
use objc2_core_foundation::{CFArray, CFBoolean, CFRetained, CFString, CFType, CGPoint, CGSize};
use senpi_desktop_core::ax::{normalize_role_macos, AxBounds, AxObserved, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{AxEvidence, EvidenceState};

use super::element::element_gone;
use super::props::{stringify_value, AttributeSource};

/// The attributes one batched read asks for, in reply order.
const ATTRIBUTES: [&str; 9] = [
    "AXRole",
    "AXSubrole",
    "AXTitle",
    "AXValue",
    "AXDescription",
    "AXEnabled",
    "AXFocused",
    "AXPosition",
    "AXSize",
];

const SECURE_TEXT_FIELD: &str = "AXSecureTextField";

/// One attribute of a batched read.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Read<T> {
    Known(T),
    /// The element has no such attribute, or no value for it.
    Absent,
    /// Reading it failed (timeout, app busy, ...): the value is not known.
    Unknown,
}

impl<T> Read<T> {
    const fn evidence(&self) -> EvidenceState {
        match self {
            Self::Known(_) => EvidenceState::Known,
            Self::Absent => EvidenceState::Absent,
            Self::Unknown => EvidenceState::Unknown,
        }
    }

    fn known(self) -> Option<T> {
        match self {
            Self::Known(value) => Some(value),
            Self::Absent | Self::Unknown => None,
        }
    }

    /// A known value `map` cannot use reads as absent.
    fn map<U>(self, map: impl FnOnce(T) -> Option<U>) -> Read<U> {
        match self {
            Self::Known(value) => map(value).map_or(Read::Absent, Read::Known),
            Self::Absent => Read::Absent,
            Self::Unknown => Read::Unknown,
        }
    }
}

/// The decoded reply of one batched read.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Batch {
    pub(super) role: Read<String>,
    pub(super) subrole: Read<String>,
    pub(super) title: Read<String>,
    pub(super) value: Read<String>,
    pub(super) description: Read<String>,
    pub(super) enabled: Read<bool>,
    pub(super) focused: Read<bool>,
    pub(super) position: Read<CGPoint>,
    pub(super) size: Read<CGSize>,
}

/// `AxObserved` for `element` from one batched attribute read, plus its
/// action names and child count.
pub(super) fn observe(element: &AXUIElement) -> CoreResult<AxObserved> {
    let batch = read_batch(element)?;
    observed(batch, element.action_names(), element.child_count())
}

/// Maps a batch to props and evidence. The role is required; a secure text
/// field (role or subrole `AXSecureTextField`, the rule `text_input.rs`
/// applies) never reports its value.
pub(super) fn observed(
    batch: Batch,
    actions: Vec<String>,
    child_count: u32,
) -> CoreResult<AxObserved> {
    let native_role = batch
        .role
        .known()
        .ok_or_else(|| DesktopError::ax_failed("copying AXRole returned no value"))?;
    let secure = native_role == SECURE_TEXT_FIELD
        || matches!(&batch.subrole, Read::Known(subrole) if subrole == SECURE_TEXT_FIELD);
    let nonempty = |value: String| (!value.is_empty()).then_some(value);
    let title = batch.title.map(nonempty);
    let value = if secure {
        Read::Unknown
    } else {
        batch.value.map(nonempty)
    };
    let description = batch.description.map(nonempty);
    let bounds = match (batch.position, batch.size) {
        (Read::Known(point), Read::Known(size)) => Read::Known(AxBounds {
            x: point.x,
            y: point.y,
            width: size.width,
            height: size.height,
        }),
        (Read::Unknown, _) | (_, Read::Unknown) => Read::Unknown,
        _ => Read::Absent,
    };
    let evidence = AxEvidence {
        title: title.evidence(),
        value: value.evidence(),
        description: description.evidence(),
        enabled: batch.enabled.evidence(),
        focused: batch.focused.evidence(),
        bounds: bounds.evidence(),
    };
    Ok(AxObserved {
        props: AxProps {
            role: normalize_role_macos(&native_role),
            native_role,
            title: title.known(),
            value: value.known(),
            description: description.known(),
            enabled: batch.enabled.known().unwrap_or(true),
            focused: batch.focused.known().unwrap_or(false),
            bounds: bounds.known(),
            actions,
            child_count,
        },
        evidence: Some(evidence),
        secure,
    })
}

/// An attribute error's evidence: the attribute is not there, or it could
/// not be read.
pub(super) fn error_read<T>(error: AXError) -> Read<T> {
    if error == AXError::NoValue || error == AXError::AttributeUnsupported {
        Read::Absent
    } else {
        Read::Unknown
    }
}

fn read_batch(element: &AXUIElement) -> CoreResult<Batch> {
    let names: Vec<CFRetained<CFString>> = ATTRIBUTES
        .iter()
        .map(|name| CFString::from_str(name))
        .collect();
    let names = CFArray::from_retained_objects(&names);
    let mut output: *const CFArray = ptr::null();
    // SAFETY: `names` is a live CFArray of CFStrings and `output` is a
    // writable slot that receives a create-rule CFArray on success.
    let error = unsafe {
        element.copy_multiple_attribute_values(
            AsRef::<CFArray>::as_ref(&*names),
            AXCopyMultipleAttributeOptions(0),
            NonNull::from(&mut output),
        )
    };
    if error == AXError::InvalidUIElement {
        return Err(element_gone());
    }
    if error != AXError::Success {
        return Err(DesktopError::ax_failed(format!(
            "AXUIElementCopyMultipleAttributeValues failed ({error:?})"
        )));
    }
    let pointer = NonNull::new(output.cast_mut()).ok_or_else(|| {
        DesktopError::ax_failed("AXUIElementCopyMultipleAttributeValues returned no values")
    })?;
    // SAFETY: The successful copy returned this array at +1 retain count.
    let values: CFRetained<CFArray> = unsafe { CFRetained::from_raw(pointer) };
    // SAFETY: The reply holds one CFType per requested attribute.
    let values = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(values) };
    let slot = |index: usize| -> Read<CFRetained<CFType>> {
        match values.get(index) {
            None => Read::Unknown,
            Some(value) => attribute_error(&value).map_or(Read::Known(value), error_read),
        }
    };
    let string = |index: usize| {
        slot(index).map(|value| {
            value
                .downcast::<CFString>()
                .ok()
                .map(|value| value.to_string())
        })
    };
    let boolean = |index: usize| {
        slot(index).map(|value| {
            value
                .downcast::<CFBoolean>()
                .ok()
                .map(|value| value.as_bool())
        })
    };
    Ok(Batch {
        role: string(0),
        subrole: string(1),
        title: string(2),
        value: slot(3).map(|value| Some(stringify_value(&value))),
        description: string(4),
        enabled: boolean(5),
        focused: boolean(6),
        position: slot(7).map(|value| point(&value)),
        size: slot(8).map(|value| size(&value)),
    })
}

/// The `AXError` a batched reply puts in an attribute's slot when reading
/// that attribute failed.
fn attribute_error(value: &CFType) -> Option<AXError> {
    let value = value.downcast_ref::<AXValue>()?;
    // SAFETY: `value` is a live AXValue.
    if unsafe { value.r#type() } != AXValueType::AXError {
        return None;
    }
    let mut code = 0_i32;
    // SAFETY: The output targets a live i32 and the requested type matches
    // the stored AXError.
    unsafe { value.value(AXValueType::AXError, NonNull::from(&mut code).cast()) }
        .then_some(AXError(code))
}

fn point(value: &CFType) -> Option<CGPoint> {
    let value = value.downcast_ref::<AXValue>()?;
    let mut point = CGPoint { x: 0.0, y: 0.0 };
    // SAFETY: The output targets a live CGPoint and the AXValue accessor
    // checks the stored type before writing it.
    unsafe { value.value(AXValueType::CGPoint, NonNull::from(&mut point).cast()) }.then_some(point)
}

fn size(value: &CFType) -> Option<CGSize> {
    let value = value.downcast_ref::<AXValue>()?;
    let mut size = CGSize {
        width: 0.0,
        height: 0.0,
    };
    // SAFETY: The output targets a live CGSize and the AXValue accessor checks
    // the stored type before writing it.
    unsafe { value.value(AXValueType::CGSize, NonNull::from(&mut size).cast()) }.then_some(size)
}

#[cfg(test)]
mod tests {
    use super::*;

    use EvidenceState::{Absent, Known, Unknown};

    fn batch() -> Batch {
        Batch {
            role: Read::Known("AXTextField".into()),
            subrole: Read::Absent,
            title: Read::Known("Name".into()),
            value: Read::Known("Q".into()),
            description: Read::Known(String::new()),
            enabled: Read::Known(true),
            focused: Read::Unknown,
            position: Read::Known(CGPoint { x: 1.0, y: 2.0 }),
            size: Read::Known(CGSize {
                width: 3.0,
                height: 4.0,
            }),
        }
    }

    #[test]
    fn attribute_errors_map_to_absent_or_unknown() {
        assert_eq!(error_read::<()>(AXError::NoValue), Read::Absent);
        assert_eq!(
            error_read::<()>(AXError::AttributeUnsupported),
            Read::Absent
        );
        assert_eq!(error_read::<()>(AXError::CannotComplete), Read::Unknown);
        assert_eq!(error_read::<()>(AXError::Failure), Read::Unknown);
    }

    #[test]
    fn a_batch_maps_to_props_and_per_field_evidence() {
        // Given / When
        let observed = observed(batch(), vec!["AXPress".into()], 2).expect("role present");
        // Then: an empty description is absent; an unread focus is unknown and false.
        let evidence = observed.evidence.expect("object-mode evidence");
        assert_eq!(
            [
                evidence.title,
                evidence.value,
                evidence.description,
                evidence.enabled,
                evidence.focused,
                evidence.bounds
            ],
            [Known, Known, Absent, Known, Unknown, Known]
        );
        assert_eq!(observed.props.role, "textfield");
        assert_eq!(observed.props.value.as_deref(), Some("Q"));
        assert!(
            observed.props.description.is_none() && !observed.props.focused && !observed.secure
        );
        assert_eq!(observed.props.child_count, 2);
    }

    #[test]
    fn a_secure_subrole_withholds_the_value() {
        // Given
        let secure = Batch {
            subrole: Read::Known(SECURE_TEXT_FIELD.into()),
            ..batch()
        };
        // When
        let observed = observed(secure, Vec::new(), 0).expect("role present");
        // Then
        assert!(observed.secure && observed.props.value.is_none());
        assert_eq!(
            observed.evidence.map(|evidence| evidence.value),
            Some(Unknown)
        );
    }

    #[test]
    fn a_partly_unread_frame_is_unknown_and_a_missing_role_fails() {
        let observed = observed(
            Batch {
                size: Read::Unknown,
                ..batch()
            },
            Vec::new(),
            0,
        )
        .expect("role present");
        assert_eq!(
            observed.evidence.map(|evidence| evidence.bounds),
            Some(Unknown)
        );
        assert!(observed.props.bounds.is_none());
        assert!(super::observed(
            Batch {
                role: Read::Unknown,
                ..batch()
            },
            Vec::new(),
            0
        )
        .is_err());
    }
}
