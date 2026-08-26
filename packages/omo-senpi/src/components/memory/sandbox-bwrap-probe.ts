import { spawnSync } from "node:child_process"

/**
 * Whether a resolved sandbox executable can actually start a sandbox, not merely whether it exists.
 *
 * On Ubuntu 24.04+ with `kernel.apparmor_restrict_unprivileged_userns=1`, /usr/bin/bwrap is present
 * and executable while every invocation dies with `bwrap: setting up uid map: Permission denied`,
 * so an existence check alone selects a sandbox that kills every child at spawn (issue #6873).
 */
export type SandboxUsability =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: string }

export interface BwrapSmokeResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly errorMessage?: string
  readonly stderr: string
}

const SMOKE_TIMEOUT_MS = 3_000
const REASON_STDERR_CHARS = 200

/**
 * The smallest invocation that still exercises user-namespace setup: bwrap must unshare and write
 * its uid/gid maps before it can exec the inner command, which is exactly the step AppArmor blocks.
 */
const SMOKE_ARGS = ["--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "true"] as const

export function classifyBwrapSmoke(result: BwrapSmokeResult): SandboxUsability {
  if (result.timedOut) return unusable(`smoke test timed out after ${SMOKE_TIMEOUT_MS}ms`, result.stderr)
  if (result.errorMessage !== undefined) return unusable(`smoke test could not run: ${result.errorMessage}`, result.stderr)
  if (result.exitCode === 0) return { usable: true }
  return unusable(`smoke test exited ${result.exitCode ?? "without an exit code"}`, result.stderr)
}

// One verdict per absolute executable path per process. The facts surface rebuilds its transform on
// every launch, so an unmemoized probe would spawn a child per reflection trigger.
const verdicts = new Map<string, SandboxUsability>()

export function probeBwrapUsability(executable: string): SandboxUsability {
  const memoized = verdicts.get(executable)
  if (memoized !== undefined) return memoized
  const verdict = classifyBwrapSmoke(runBwrapSmoke(executable))
  verdicts.set(executable, verdict)
  return verdict
}

function runBwrapSmoke(executable: string): BwrapSmokeResult {
  const smoke = spawnSync(executable, [...SMOKE_ARGS], {
    timeout: SMOKE_TIMEOUT_MS,
    encoding: "utf8",
    windowsHide: true,
  })
  const stderr = typeof smoke.stderr === "string" ? smoke.stderr : ""
  // Node reports a timeout kill as an ETIMEDOUT error alongside the terminating signal, so the
  // error path alone would misreport a hung bwrap as "could not run".
  const timedOut = smoke.error !== undefined && "code" in smoke.error && smoke.error.code === "ETIMEDOUT"
  if (timedOut) return { exitCode: smoke.status, timedOut: true, stderr }
  if (smoke.error !== undefined) return { exitCode: smoke.status, timedOut: false, errorMessage: smoke.error.message, stderr }
  return { exitCode: smoke.status, timedOut: false, stderr }
}

function unusable(cause: string, stderr: string): SandboxUsability {
  const tail = stderr.trim().slice(-REASON_STDERR_CHARS)
  return { usable: false, reason: tail === "" ? cause : `${cause}: ${tail}` }
}
