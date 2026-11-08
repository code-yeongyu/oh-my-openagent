import * as childProcess from "node:child_process"

import { gitActivityGateAvailable } from "./activity-gate"

// The Windows floor-job helper, `omo-git-job-helper.exe` (omo #10391, design v4.2 sections 3, 6.3 and 13). A host
// "claims" the protocol only when the helper exists, bun:ffi can take the gate, and `selftest` passed in this process.
// A claimed host runs every memory-core git through the helper and never untracked; an unclaimed one runs git as today.

/** Injected through `NodeGitExecRuntime.jobHelper` and `CreateLockRecordOptions.jobHelper` (design section 3). */
export interface GitJobHelperRuntime {
  readonly path: string
  /** Passed to the helper as `--linger-ms`; production never sets it, so the helper's 600 000 ms budget applies. */
  readonly lingerMs?: number
}

export const GIT_ACTIVITY_JOB_PROTOCOL = "win32-job-v1"

/** Bounds the writer's wait for the helper's `joined` frame, and the selftest (design section 7.2). */
export const HELPER_HANDSHAKE_MS = 10_000

/**
 * Production location of the helper. The platform packages do not carry the exe yet, so nothing is resolved until
 * the packaging change lands; every caller then runs git as it does today.
 */
export function resolveGitJobHelper(): GitJobHelperRuntime | null {
  return null
}

const selftests = new Map<string, Promise<boolean>>()

function selftestPasses(path: string): Promise<boolean> {
  const cached = selftests.get(path)
  if (cached !== undefined) return cached
  const outcome = new Promise<boolean>((resolve) => {
    childProcess.execFile(path, ["selftest"], { windowsHide: true, timeout: HELPER_HANDSHAKE_MS, encoding: "utf8" }, (error, stdout) => {
      resolve(error === null && stdout.startsWith("selftest ok "))
    })
  })
  selftests.set(path, outcome)
  return outcome
}

/** The helper this win32 process runs its memory-core git through, or null when the host does not claim the protocol. */
export async function claimedGitJobHelper(injected: GitJobHelperRuntime | undefined): Promise<GitJobHelperRuntime | null> {
  const helper = injected ?? resolveGitJobHelper()
  if (helper === null) return null
  if (!(await gitActivityGateAvailable())) return null
  return (await selftestPasses(helper.path)) ? helper : null
}
