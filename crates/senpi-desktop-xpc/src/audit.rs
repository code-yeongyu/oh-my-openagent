use crate::{RejectReason, SecurityOperation};

/// Kernel process identity, including pidversion. Never accept this from JSON or
/// another caller's payload; XPC callers must use the actual received message.
///
/// Raw words cannot be promoted into a kernel identity by another crate.
/// ```compile_fail
/// use senpi_desktop_xpc::identity::AuditToken;
/// let _forged = AuditToken::from_kernel_token([0; 8]);
/// ```
#[derive(Clone, Copy)]
#[repr(C)]
pub struct AuditToken {
    words: [u32; 8],
}

unsafe extern "C" {
    static mach_task_self_: u32;
    fn task_info(task: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
}

impl AuditToken {
    /// Wrap a token already obtained from a kernel peer-identity API.
    pub(crate) const fn from_kernel_token(words: [u32; 8]) -> Self {
        Self { words }
    }

    /// Obtain this process's token directly from the kernel.
    pub fn current() -> Result<Self, RejectReason> {
        let mut words = [0_u32; 8];
        let mut count = 8_u32;
        // SAFETY: mach_task_self_ is a libSystem-owned initialized scalar.
        let task = unsafe { mach_task_self_ };
        // SAFETY: TASK_AUDIT_TOKEN (15) writes eight natural_t words. The
        // initialized array has that size/alignment and count is writable.
        let status = unsafe { task_info(task, 15, words.as_mut_ptr().cast(), &mut count) };
        if status != 0 {
            return Err(RejectReason::SecurityFramework {
                operation: SecurityOperation::SelfAuditToken,
                status,
            });
        }
        if count != 8 {
            return Err(RejectReason::MalformedSigningInformation);
        }
        Ok(Self::from_kernel_token(words))
    }

    pub(crate) fn bytes(&self) -> [u8; 32] {
        let mut bytes = [0_u8; 32];
        for (word, chunk) in self.words.iter().zip(bytes.as_chunks_mut::<4>().0) {
            chunk.copy_from_slice(&word.to_ne_bytes());
        }
        bytes
    }
}
