import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskLifecycle, type ResidencyRegistry, type ResidentHandle, type TaskLifecycle } from "../lifecycle"
import { createTaskRecord, type HostSessionIdentity, type TaskRecord } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"

export const HOST_CHAOS_SESSION = "parent-host-chaos"
export const HOST_CHAOS_SOCKET = "/tmp/dh-chaos/rpc.sock"
const HOST_PID = 31_337

/** The daemon the host chaos actions drive: alive/dead, which paths it holds, and who is draining. */
export class ChaosDaemon {
  alive = true
  /** Set while an OLD generation still owns the session paths after a handoff. */
  drainingAttemptsLeft = 0
  readonly livePaths = new Set<string>()
  readonly closed: string[] = []

  hold(path: string): void {
    this.livePaths.add(path)
  }

  evict(path: string): void {
    this.livePaths.delete(path)
  }

  kill(): void {
    this.alive = false
    this.livePaths.clear()
  }
}

export type HostChaosHarness = {
  readonly store: TaskRecordStore
  readonly lifecycle: TaskLifecycle
  readonly daemon: ChaosDaemon
  readonly registry: ChaosHostRegistry
  readonly taskIds: string[]
  readonly signals: string[]
  readonly opens: Array<{ readonly task_id: string; readonly sessionPath: string | undefined }>
  readonly waits: number[]
  seed(status: TaskRecord["status"], residency: TaskRecord["residency_state"]): TaskRecord
  cleanup(): void
}

/** A registry whose residents are all daemon sessions: no pid exists anywhere in this harness. */
export class ChaosHostRegistry implements ResidencyRegistry {
  readonly #handles = new Map<string, ResidentHandle>()
  readonly terminated: string[] = []

  add(taskId: string, daemon: ChaosDaemon, sessionPath: string): void {
    this.#handles.set(taskId, {
      task_id: taskId,
      kind: "host-session",
      pid: undefined,
      abort: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
      terminate: () => {
        this.terminated.push(taskId)
        daemon.closed.push(sessionPath)
        daemon.evict(sessionPath)
        return Promise.resolve()
      },
    })
  }

  get(taskId: string): ResidentHandle | undefined {
    return this.#handles.get(taskId)
  }

  entries(): readonly ResidentHandle[] {
    return [...this.#handles.values()]
  }

  forget(taskId: string, _options: Parameters<ResidencyRegistry["forget"]>[1]): void {
    this.#handles.delete(taskId)
  }

  hasPendingSends(): boolean {
    return false
  }
}

export function hostChaosIdentity(taskId: string): HostSessionIdentity {
  return {
    socket: HOST_CHAOS_SOCKET,
    routing_id: `routing-${taskId}`,
    session_path: `/tmp/dh-chaos/sessions/${taskId}.jsonl`,
    instance_id: "instance-1",
  }
}

export function buildHostChaosHarness(): HostChaosHarness {
  const project = mkdtempSync(join(tmpdir(), "dh-chaos-"))
  const store = createTaskRecordStore({ project_dir: project })
  const daemon = new ChaosDaemon()
  const registry = new ChaosHostRegistry()
  const taskIds: string[] = []
  const signals: string[] = []
  const opens: HostChaosHarness["opens"] = []
  const waits: number[] = []

  const lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT,
    store,
    registry,
    config: OmoTaskSettingsSchema.parse({ residency_max_children: "unlimited", resume_children: true }),
    hostPid: HOST_PID,
    orphanKillDelayMs: 0,
    signaller: {
      isAlive: () => false,
      signal: (pid, signal) => {
        signals.push(`${signal}:${pid}`)
      },
    },
    // The daemon's `open_session`: a draining old generation refuses, a dead daemon is unavailable,
    // and a live one hands back the session (attached or reopened - both look the same from here).
    respawn: (record, sessionPath) => {
      opens.push({ task_id: record.task_id, sessionPath })
      if (daemon.drainingAttemptsLeft > 0) {
        daemon.drainingAttemptsLeft -= 1
        return Promise.resolve({ ok: false, disposition: "retryable", code: "host_draining", reason: "session_path_in_use", retryAfterMs: 20 })
      }
      if (!daemon.alive) {
        return Promise.resolve({ ok: false, disposition: "retryable", code: "session_unavailable", reason: "daemon gone" })
      }
      if (sessionPath !== undefined) daemon.hold(sessionPath)
      registry.add(record.task_id, daemon, sessionPath ?? hostChaosIdentity(record.task_id).session_path)
      return Promise.resolve({ ok: true, handle: registry.get(record.task_id) as never })
    },
    reattach: () => Promise.resolve({ ok: true }),
    hostSessionProbe: {
      daemonAlive: () => Promise.resolve(daemon.alive),
      sessionLive: (identity) => Promise.resolve(daemon.alive && daemon.livePaths.has(identity.session_path)),
      sessionLiveness: (identity) =>
        Promise.resolve(daemon.alive && daemon.livePaths.has(identity.session_path) ? "live" : "gone"),
      refresh: () => undefined,
    },
    hostSessionClose: (request) => {
      daemon.closed.push(request.hostSession.session_path)
      daemon.evict(request.hostSession.session_path)
      return Promise.resolve()
    },
    hostRetry: {
      maxDrainAttempts: 4,
      defaultRetryAfterMs: 20,
      daemonLossBackoffMs: [1, 4, 16],
      deferredRetryBackoffMs: [],
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    },
  })

  return {
    store,
    lifecycle,
    daemon,
    registry,
    taskIds,
    signals,
    opens,
    waits,
    seed: (status, residency) => {
      const seeded = createTaskRecord({
        parent_session_id: HOST_CHAOS_SESSION,
        root_session_id: HOST_CHAOS_SESSION,
        depth: 1,
        execution_mode: "process",
        model: "anthropic/claude",
        notify_on_terminal: false,
      })
      const identity = hostChaosIdentity(seeded.task_id)
      const record: TaskRecord = {
        ...seeded,
        status,
        residency_state: residency,
        runner_kind: "host-session",
        host_session: identity,
        spawn_spec: { version: 1, cwd: project, prompt: "chaos child" },
        ...(residency === "resident" ? { host_pid: HOST_PID } : {}),
      }
      store.save(record)
      taskIds.push(record.task_id)
      daemon.hold(identity.session_path)
      if (residency === "resident") registry.add(record.task_id, daemon, identity.session_path)
      return record
    },
    cleanup: () => rmSync(project, { recursive: true, force: true }),
  }
}
