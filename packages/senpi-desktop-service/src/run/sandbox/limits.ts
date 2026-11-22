// Per-run limits of the QuickJS run cell (docs/reference/computer-run-sandbox-threat-model.md section 6).

const MIB = 1024 * 1024

export const SANDBOX_MEMORY_BYTES = 64 * MIB
export const SANDBOX_MAX_CALLS = 1_000
export const SANDBOX_OUTPUT_BYTES = MIB
export const SANDBOX_RETURN_BYTES = MIB
/** Checked in the worker before a bridged call is posted. */
export const SANDBOX_ARGS_BYTES = MIB
/** Checked on the host before a bridged result is copied into the VM. */
export const SANDBOX_RESULT_BYTES = 8 * MIB
