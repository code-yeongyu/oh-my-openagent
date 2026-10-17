//! Security.framework is the only production implementation of this boundary.
pub use crate::audit::AuditToken;
use crate::{policy::evaluate, security, signing_info};
use crate::{roles::Role, RejectReason, VerifiedPeer};
use std::{ffi::c_void, marker::PhantomData, ptr::NonNull};

mod sealed {
    pub trait Sealed {}
}

/// External callers cannot select an arbitrary role.
/// ```compile_fail
/// use senpi_desktop_xpc::{identity::{AuditToken, PeerVerifier, SecurityVerifier}, roles::Role};
/// let verifier = SecurityVerifier::from_audit_token(AuditToken::current().unwrap());
/// let _ = verifier.verify(Role::EngineServer);
/// ```
pub trait PeerVerifier: sealed::Sealed {
    fn verify_privileged_client(&self) -> Result<VerifiedPeer, RejectReason>;
    fn verify_server(&self) -> Result<VerifiedPeer, RejectReason>;
}

/// Borrow of the actual dictionary delivered by an XPC event handler.
pub struct XpcMessage<'a> {
    pub(crate) pointer: NonNull<c_void>,
    lifetime: PhantomData<&'a c_void>,
}

impl<'a> XpcMessage<'a> {
    /// # Safety
    /// `pointer` must be a live xpc_object_t received from XPC, kept alive and
    /// unmodified throughout `'a`. A locally fabricated dictionary is not a peer.
    pub unsafe fn from_raw(pointer: NonNull<c_void>) -> Self {
        Self {
            pointer,
            lifetime: PhantomData,
        }
    }
}

enum Source<'a> {
    Message(XpcMessage<'a>),
    Audit(AuditToken),
}

/// Production verifier. It resolves and checks live code anew on every call.
pub struct SecurityVerifier<'a> {
    source: Source<'a>,
}

impl<'a> SecurityVerifier<'a> {
    pub const fn from_xpc_message(message: XpcMessage<'a>) -> Self {
        Self {
            source: Source::Message(message),
        }
    }

    /// Only for non-XPC kernel callers. Never convert a payload token into a peer.
    pub const fn from_audit_token(token: AuditToken) -> Self {
        Self {
            source: Source::Audit(token),
        }
    }

    /// The server's privileged caller allowlist contains only the controller.
    pub fn verify_privileged_client(&self) -> Result<VerifiedPeer, RejectReason> {
        self.verify(Role::NativeController)
    }

    /// Client-side reciprocal check. Engine identity is never a client role.
    pub fn verify_server(&self) -> Result<VerifiedPeer, RejectReason> {
        self.verify(Role::EngineServer)
    }
    fn verify(&self, role: Role) -> Result<VerifiedPeer, RejectReason> {
        let code = match &self.source {
            Source::Message(message) => security::message_identity(message)?,
            Source::Audit(token) => security::audit_identity(token)?,
        };
        security::check_requirement(&code, role)?;
        let info = security::signing_information(&code)?;
        evaluate(signing_info::resolve(&info)?, role)
    }
}

impl sealed::Sealed for SecurityVerifier<'_> {}

impl PeerVerifier for SecurityVerifier<'_> {
    fn verify_privileged_client(&self) -> Result<VerifiedPeer, RejectReason> {
        SecurityVerifier::verify_privileged_client(self)
    }

    fn verify_server(&self) -> Result<VerifiedPeer, RejectReason> {
        SecurityVerifier::verify_server(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{evaluate, tests::eligible};

    use std::cell::Cell;

    struct FakeVerifier(Cell<Option<Result<VerifiedPeer, RejectReason>>>);
    impl sealed::Sealed for FakeVerifier {}
    impl PeerVerifier for FakeVerifier {
        fn verify_privileged_client(&self) -> Result<VerifiedPeer, RejectReason> {
            self.0.take().expect("fake result is consumed exactly once")
        }
        fn verify_server(&self) -> Result<VerifiedPeer, RejectReason> {
            self.0.take().expect("fake result is consumed exactly once")
        }
    }

    #[test]
    fn boundary_preserves_verified_role() {
        // given
        let verifier = FakeVerifier(Cell::new(Some(evaluate(
            eligible(Role::NativeController),
            Role::NativeController,
        ))));
        let boundary: &dyn PeerVerifier = &verifier;
        // when
        let peer = boundary.verify_privileged_client().unwrap();
        // then
        assert_eq!(peer.role(), Role::NativeController);
    }

    #[test]
    fn boundary_preserves_rejection() {
        // given
        let verifier = FakeVerifier(Cell::new(Some(Err(RejectReason::RequirementRejected))));
        let boundary: &dyn PeerVerifier = &verifier;
        // when
        let result = boundary.verify_privileged_client();
        // then
        assert_eq!(result, Err(RejectReason::RequirementRejected));
    }
}
