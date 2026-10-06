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

/**
 * `unknown`: the daemon answers but could not list its sessions, so whether this one still runs is
 * unknown. A caller that would otherwise END a child on a "gone" answer must wait instead (omo#9450).
 */
export type HostSessionLiveness = "live" | "gone" | "unknown"

export type HostSessionProbe = {
  daemonAlive(hostSession: HostSessionIdentity): Promise<boolean>
  /** True only for a session the daemon listed; a failed listing reads false. */
  sessionLive(hostSession: HostSessionIdentity): Promise<boolean>
  sessionLiveness(hostSession: HostSessionIdentity): Promise<HostSessionLiveness>
  /** Refresh one recorded endpoint, or all snapshots when starting a reconcile/TTL pass. */
  refresh(socket?: string): void
}

/**
 * How revival reaches a RECORDED endpoint beyond probing it. `isOwn` names the endpoint this session
 * runs behind (never ensured from inside); `ensure` re-ensures any other recorded socket, and only
 * that socket; `notice` surfaces why a record stays parked. A lifecycle with no task host passes
 * `NO_HOST_ENDPOINT`: probe only, never an ensure.
 */
export type HostEndpointPort = {
  readonly isOwn: (socket: string) => boolean
  readonly ensure: (socket: string) => Promise<"ensured" | "incompatible" | "unreachable">
  readonly notice: (reason: "host_incompatible" | "own_host_unreachable", socket: string) => void
}

/** The explicit "this lifecycle has no task host" answer: a silent recorded endpoint stays `host_unreachable`. */
export const NO_HOST_ENDPOINT: HostEndpointPort = {
  isOwn: () => false,
  ensure: () => Promise.resolve("unreachable"),
  notice: () => undefined,
}

export type HostSessionProbePorts = {
  readonly daemonReachable: (socket: string) => Promise<boolean>
  /** `list_sessions { include_workers: true }`, answered once per pass and matched by session path. */
  readonly liveSessionPaths: (socket: string) => Promise<readonly string[]>
}

type HostSnapshot = { readonly daemonAlive: boolean; readonly listed: boolean; readonly livePaths: ReadonlySet<string> }

/**
 * ONE `probeHost` + ONE `list_sessions` per socket per pass - never per record. Every record in a
 * reconcile/TTL pass shares the in-flight snapshot; `refresh()` is what starts the next pass. A
 * daemon that does not answer reads as "nothing is live": the lifecycle then reopens from JSONL instead
 * of attaching, and closes nothing. A daemon that answers but cannot list is `unknown` to
 * `sessionLiveness`, so a pending cancel waits instead of finishing over a running session.
 */
export function createHostSessionProbe(ports: HostSessionProbePorts): HostSessionProbe {
  const passes = new Map<string, Promise<HostSnapshot>>()
  const snapshot = (socket: string): Promise<HostSnapshot> => {
    const cached = passes.get(socket)
    if (cached !== undefined) return cached
    const taken = Promise.all([
      ports.daemonReachable(socket).catch(() => false),
      ports.liveSessionPaths(socket).then(
        (paths) => ({ listed: true, paths }),
        () => ({ listed: false, paths: [] as readonly string[] }),
      ),
    ]).then(([daemonAlive, listing]) => ({
      daemonAlive,
      listed: listing.listed,
      livePaths: new Set(listing.paths.map(canonicalSessionPath)),
    }))
    passes.set(socket, taken)
    return taken
  }
  return {
    daemonAlive: async (hostSession) => (await snapshot(hostSession.socket)).daemonAlive,
    sessionLive: async (hostSession) =>
      (await snapshot(hostSession.socket)).livePaths.has(canonicalSessionPath(hostSession.session_path)),
    sessionLiveness: async (hostSession) => {
      const taken = await snapshot(hostSession.socket)
      if (!taken.listed) return taken.daemonAlive ? "unknown" : "gone"
      return taken.livePaths.has(canonicalSessionPath(hostSession.session_path)) ? "live" : "gone"
    },
    refresh: (socket) => {
      if (socket === undefined) passes.clear()
      else passes.delete(socket)
    },
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
  /** Background retries of a reconcile that deferred a daemon-hosted child; spans a handoff drain. */
  readonly deferredRetryBackoffMs: readonly number[]
  readonly wait: (ms: number) => Promise<void>
}

export const DEFAULT_HOST_SESSION_RETRY_POLICY: HostSessionRetryPolicy = {
  maxDrainAttempts: 10,
  defaultRetryAfterMs: 2_000,
  daemonLossBackoffMs: [1_000, 4_000, 16_000],
  deferredRetryBackoffMs: [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000, 300_000],
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
