import type { HostSessionIdentity, TaskRecord } from "../../state"
import { NO_HOST_ENDPOINT } from "../host-session"
import type { LifecycleDeps, ResidentHandle } from "../port"
import type { TaskRecordStore } from "../../store"
import { FakeRegistry, settings, type CallLog } from "./lifecycle-fakes"

export const HOST_SOCKET = "/tmp/dh-fake/rpc.sock"

export function hostSession(taskId: string, overrides: Partial<HostSessionIdentity> = {}): HostSessionIdentity {
  return {
    socket: HOST_SOCKET,
    routing_id: `routing-${taskId}`,
    session_path: `/tmp/dh-fake/sessions/${taskId}.jsonl`,
    instance_id: "instance-1",
    ...overrides,
  }
}

/**
 * The daemon a lifecycle test drives: which sessions it still holds, whether it answers at all, and
 * every close the lifecycle asked for. `listCalls` is what pins "ONE list_sessions per pass".
 */
export class FakeDaemon {
  alive = true
  readonly livePaths = new Set<string>()
  readonly closed: string[] = []
  probeCalls = 0
  listCalls = 0

  hold(...sessionPaths: readonly string[]): void {
    for (const path of sessionPaths) this.livePaths.add(path)
  }

  /** The daemon parked (or evicted) the session: it is no longer live, but the transcript remains. */
  park(sessionPath: string): void {
    this.livePaths.delete(sessionPath)
  }

  daemonReachable(socket: string): Promise<boolean> {
    this.probeCalls += 1
    return Promise.resolve(this.alive && socket === HOST_SOCKET)
  }

  liveSessionPaths(socket: string): Promise<readonly string[]> {
    this.listCalls += 1
    if (!this.alive || socket !== HOST_SOCKET) return Promise.resolve([])
    return Promise.resolve([...this.livePaths])
  }

  // The single close writer's seam: a session ends with abort + close_session, never a signal.
  close(request: { readonly hostSession: HostSessionIdentity }): Promise<void> {
    this.closed.push(request.hostSession.session_path)
    this.livePaths.delete(request.hostSession.session_path)
    return Promise.resolve()
  }
}

/** A resident handle shaped like `runners/rpc-host/handle.ts`: dispose IS detach, terminate closes. */
export function hostSessionHandle(taskId: string, order: CallLog): ResidentHandle {
  return {
    task_id: taskId,
    kind: "host-session",
    pid: undefined,
    abort: () => {
      order.push(`abort:${taskId}`)
      return Promise.resolve()
    },
    dispose: () => {
      order.push(`detach:${taskId}`)
      return Promise.resolve()
    },
    terminate: () => {
      order.push(`close_session:${taskId}`)
      return Promise.resolve()
    },
  }
}

export type HostLifecycleFixture = {
  readonly deps: LifecycleDeps
  readonly registry: FakeRegistry
  readonly daemon: FakeDaemon
  readonly waits: number[]
  readonly respawned: Array<{ readonly task_id: string; readonly sessionPath: string | undefined }>
}

export type HostLifecycleInput = {
  readonly store: TaskRecordStore
  readonly hostPid: number
  readonly now?: () => number
  readonly isAlive?: (pid: number) => boolean
  readonly signals?: string[]
  readonly respawn?: LifecycleDeps["respawn"]
  readonly config?: Record<string, unknown>
  readonly maxDrainAttempts?: number
  readonly deferredRetryBackoffMs?: readonly number[]
  /** Runs inside every recorded wait, so a test can move the daemon between retries. */
  readonly onWait?: (ms: number) => void
  /** Holds each retry wait until the returned promise settles; tests use it to act between attempts. */
  readonly gateWait?: (ms: number) => Promise<void>
}

/** Lifecycle deps wired to a fake daemon, a recorded signaller, and a recorded (never real) wait. */
export function hostLifecycleDeps(input: HostLifecycleInput): HostLifecycleFixture {
  const daemon = new FakeDaemon()
  const registry = new FakeRegistry()
  const waits: number[] = []
  const signals = input.signals ?? []
  const respawned: HostLifecycleFixture["respawned"] = []
  const respawn: NonNullable<LifecycleDeps["respawn"]> = async (record, sessionPath) => {
    respawned.push({ task_id: record.task_id, sessionPath })
    return input.respawn === undefined
      ? { ok: false, disposition: "retryable", code: "respawn_failed", reason: "no respawn port" }
      : await input.respawn(record, sessionPath)
  }
  const deps: LifecycleDeps = {
    hostEndpoint: NO_HOST_ENDPOINT,
    store: input.store,
    registry,
    config: settings({ ttl_ms: 1_000, resident_idle_timeout_ms: 60_000, ...input.config }),
    hostPid: input.hostPid,
    orphanKillDelayMs: 0,
    ...(input.now === undefined ? {} : { now: input.now }),
    signaller: {
      isAlive: (pid) => input.isAlive?.(pid) ?? false,
      signal: (pid, signal) => {
        signals.push(`${signal}:${pid}`)
      },
    },
    respawn,
    reattach: () => Promise.resolve({ ok: true }),
    hostSessionProbe: {
      daemonAlive: (identity) => daemon.daemonReachable(identity.socket),
      sessionLive: async (identity) =>
        (await daemon.liveSessionPaths(identity.socket)).includes(identity.session_path),
      sessionLiveness: async (identity) =>
        (await daemon.liveSessionPaths(identity.socket)).includes(identity.session_path) ? "live" : "gone",
      refresh: () => undefined,
    },
    hostSessionClose: (request) => daemon.close(request),
    hostRetry: {
      maxDrainAttempts: input.maxDrainAttempts ?? 10,
      defaultRetryAfterMs: 2_000,
      daemonLossBackoffMs: [1_000, 4_000, 16_000],
      deferredRetryBackoffMs: input.deferredRetryBackoffMs ?? [],
      wait: (ms) => {
        waits.push(ms)
        input.onWait?.(ms)
        return input.gateWait?.(ms) ?? Promise.resolve()
      },
    },
  }
  return { deps, registry, daemon, waits, respawned }
}

export function hostSessionRecordInput(taskId: string, identity: HostSessionIdentity) {
  return {
    task_id: taskId,
    execution_mode: "process",
    runner_kind: "host-session" as const,
    host_session: identity,
    spawn_spec: { version: 1 as const, cwd: "/tmp", prompt: "host child" } satisfies TaskRecord["spawn_spec"],
  }
}
