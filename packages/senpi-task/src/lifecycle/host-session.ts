import { realpathSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import type { HostSessionIdentity, TaskRecord } from "../state"

/**
 * What the lifecycle needs to know about a child that lives as a SESSION of the shared daemon, and
 * nothing more. A host session has no pid of its own: its liveness is the daemon answering plus the
 * daemon still listing its session path, and it is ended with `close_session`, never with a signal.
 */

export type HostSessionRecord = TaskRecord & {
  readonly runner_kind: "host-session"
  readonly host_session: HostSessionIdentity
}

export function isHostSessionRecord(record: TaskRecord | null | undefined): record is HostSessionRecord {
  return record != null && record.runner_kind === "host-session" && record.host_session !== undefined
}

/** The resume path of a daemon-hosted child is its RECORDED session path, never a disk scan. */
export function hostSessionResumePath(record: TaskRecord | null | undefined): string | undefined {
  return isHostSessionRecord(record) ? record.host_session.session_path : undefined
}

export type HostSessionProbe = {
  daemonAlive(hostSession: HostSessionIdentity): Promise<boolean>
  sessionLive(hostSession: HostSessionIdentity): Promise<boolean>
  /** Drop the cached snapshot so the NEXT pass asks the daemon again. */
  refresh(): void
}

export type HostSessionProbePorts = {
  readonly daemonReachable: (socket: string) => Promise<boolean>
  /** `list_sessions { include_workers: true }`, answered once per pass and matched by session path. */
  readonly liveSessionPaths: (socket: string) => Promise<readonly string[]>
}

type HostSnapshot = { readonly daemonAlive: boolean; readonly livePaths: ReadonlySet<string> }

/**
 * ONE `probeHost` + ONE `list_sessions` per socket per pass - never per record. Every record in a
 * reconcile/TTL pass shares the in-flight snapshot; `refresh()` is what starts the next pass. A
 * daemon that does not answer reads as "nothing is live", which is the safe answer everywhere: the
 * lifecycle then reopens from JSONL instead of attaching, and closes nothing.
 */
export function createHostSessionProbe(ports: HostSessionProbePorts): HostSessionProbe {
  const passes = new Map<string, Promise<HostSnapshot>>()
  const snapshot = (socket: string): Promise<HostSnapshot> => {
    const cached = passes.get(socket)
    if (cached !== undefined) return cached
    const taken = Promise.all([
      ports.daemonReachable(socket).catch(() => false),
      ports.liveSessionPaths(socket).catch((): readonly string[] => []),
    ]).then(([daemonAlive, livePaths]) => ({ daemonAlive, livePaths: new Set(livePaths.map(canonicalSessionPath)) }))
    passes.set(socket, taken)
    return taken
  }
  return {
    daemonAlive: async (hostSession) => (await snapshot(hostSession.socket)).daemonAlive,
    sessionLive: async (hostSession) =>
      (await snapshot(hostSession.socket)).livePaths.has(canonicalSessionPath(hostSession.session_path)),
    refresh: () => passes.clear(),
  }
}

// The daemon lists a session by its canonical path while the record keeps the path omo asked for, so
// a project reached through a symlink (/tmp on macOS, a linked workspace) would never match (#8932).
function canonicalSessionPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

export type HostSessionCloseRequest = {
  readonly hostSession: HostSessionIdentity
  readonly cwd?: string
}

/** THE single close writer's seam (`runners/rpc-host/close.ts`): abort + close_session, no signal. */
export type HostSessionCloser = (request: HostSessionCloseRequest) => Promise<void>

/**
 * The two bounded waits the daemon path owns. Draining: an old generation still holds the session
 * path after a handoff, so revival retries instead of losing the child. Daemon loss: the host died,
 * so the child parks and the reconcile is retried on a fixed backoff before giving up.
 */
export type HostSessionRetryPolicy = {
  readonly maxDrainAttempts: number
  readonly defaultRetryAfterMs: number
  readonly daemonLossBackoffMs: readonly number[]
  readonly wait: (ms: number) => Promise<void>
}

export const DEFAULT_HOST_SESSION_RETRY_POLICY: HostSessionRetryPolicy = {
  maxDrainAttempts: 10,
  defaultRetryAfterMs: 2_000,
  daemonLossBackoffMs: [1_000, 4_000, 16_000],
  wait: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms).unref?.()
    }),
}

/**
 * `session_path_in_use` from a generation that is still draining. Duck-typed on the engine's wire
 * contract (name + code) so the manager never has to import the runner's error class, and unwrapped
 * from a `RunnerError` cause because that is how the runner surfaces an open failure.
 */
export function readHostDrainingHold(error: unknown): { readonly retryAfterMs?: number } | undefined {
  for (const candidate of [error, (error as { failure?: { cause?: unknown } } | null)?.failure?.cause]) {
    if (!(candidate instanceof Error) || candidate.name !== "SessionHeldElsewhereError") continue
    const retryAfterMs = (candidate as unknown as { retryAfterMs?: unknown }).retryAfterMs
    return typeof retryAfterMs === "number" ? { retryAfterMs } : {}
  }
  return undefined
}
