import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import { createManagerResidencyRegistry } from "../../../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle, createHostSessionProbe, type TaskLifecycle } from "../../../lifecycle"
import { defaultHostSessionProbe } from "../../../lifecycle/host-session-default"
import { createTaskManager } from "../../../manager/manager"
import { createRpcManagedRunner } from "../../../manager/runner"
import type { StartResult } from "../../../manager/types"
import type { TaskRecord } from "../../../state"
import { createTaskRecordStore, type TaskRecordStore } from "../../../store"
import { isHostSessionHandle, RpcHostRunner } from "../../rpc-host"
import type { RpcChildHandle, RpcRunnerSpec } from "../../types"
import { closeHostSession } from "../close"
import { HostSessionClient } from "../session-client"
import { startFakeHost, type FakeHost, type FakeHostOptions } from "./fake-host"
import { listFakeHostSessions, probeFakeHost } from "./fake-host-probe"
import { fakeCloseChannel, fakeFallbackRunner } from "./host-world-ports"

/**
 * A daemon and the parent sessions that share it: one fake host on a private socket, one project
 * store on disk, and as many parents as a suite connects - each with its OWN store handle, manager,
 * lifecycle and host runner, exactly as two omo processes on one machine would have.
 *
 * Every seam that would reach the machine is injected: the daemon is ensured by returning THIS
 * host's socket, the protocol probe and `list_sessions` speak to it over the wire, and the two
 * bounded waits record their delay instead of sleeping.
 */

export const HOST_CHILD_MODEL = "anthropic/claude-sonnet-4-5"

export interface ParentOptions {
  /** Give the parent a per-child runner the daemon path may fall back to. */
  readonly useFallback?: boolean
  /** How many `open_session` attempts a draining generation gets before the child defers. */
  readonly maxDrainAttempts?: number
  /** Controlled clock: idle parking is a cutoff comparison, never a wait. */
  readonly now?: () => number
  /** Run this parent as ANOTHER omo process: its manager and lifecycle claim records under this pid. */
  readonly hostPid?: number
  /** Ask the daemon through the production liveness adapter instead of the fixture's own wire probe. */
  readonly productionProbe?: boolean
}

export interface ParentSession {
  readonly sessionId: string
  readonly store: TaskRecordStore
  readonly manager: ReturnType<typeof createTaskManager>
  readonly lifecycle: TaskLifecycle
  readonly warnings: readonly string[]
  readonly waits: readonly number[]
  readonly fallbackStarts: readonly RpcRunnerSpec[]
  startChildren(count: number): Promise<readonly StartResult[]>
  records(): readonly TaskRecord[]
  taskIds(): readonly string[]
  sessionPaths(): readonly string[]
}

export interface HostWorld {
  readonly host: FakeHost
  readonly projectDir: string
  /** Join the daemon as a parent session; joining the same id again IS that parent restarting. */
  connect(sessionId: string, options?: ParentOptions): ParentSession
  prompts(): readonly string[]
  commandsOfType(type: string): number
  cleanup(): Promise<void>
}

export function hostSuiteSettings(overrides: Record<string, unknown> = {}): OmoTaskSettings {
  return OmoTaskSettingsSchema.parse({
    default_concurrency: 16,
    global_concurrency: 16,
    residency_max_children: 16,
    resume_children: true,
    max_depth: 2,
    ...overrides,
  })
}

export async function startHostWorld(options: FakeHostOptions = {}): Promise<HostWorld> {
  const host = await startFakeHost(options)
  const projectDir = mkdtempSync(join(tmpdir(), "dh-world-"))
  const parents: ParentSession[] = []
  return {
    host,
    projectDir,
    connect: (sessionId, parentOptions = {}) => {
      const parent = connectParent({ sessionId, projectDir, socketPath: host.socketPath, options: parentOptions })
      parents.push(parent)
      return parent
    },
    prompts: () =>
      host.commands.flatMap((command) =>
        command.type === "prompt" && typeof command.payload.message === "string" ? [command.payload.message] : [],
      ),
    commandsOfType: (type) => host.commands.filter((command) => command.type === type).length,
    cleanup: async () => {
      // Detach every live child BEFORE the daemon goes away, so no late outcome writes into a
      // store directory this cleanup is about to delete.
      for (const parent of parents.splice(0)) {
        await parent.lifecycle.suspendOnSessionShutdown({ parentSessionId: parent.sessionId, reason: "suite_cleanup" })
        parent.lifecycle.dispose?.()
      }
      await host.stop()
      rmSync(projectDir, { recursive: true, force: true })
    },
  }
}

interface ConnectParentInput {
  readonly sessionId: string
  readonly projectDir: string
  readonly socketPath: string
  readonly options: ParentOptions
}

function connectParent(input: ConnectParentInput): ParentSession {
  const { sessionId, projectDir, socketPath } = input
  const store = createTaskRecordStore({ project_dir: projectDir })
  const config = hostSuiteSettings()
  const warnings: string[] = []
  const waits: number[] = []
  const fallback = fakeFallbackRunner()
  const runner = new RpcHostRunner({
    policy: "upgrade",
    agentDir: join(projectDir, "agent"),
    env: {},
    ensureDaemon: () =>
      Promise.resolve({
        action: "reuse",
        reason: "compatible",
        socket: socketPath,
        pid: 4_242,
        reused: true,
        upgradeable: true,
      }),
    createClient: (socket) =>
      new HostSessionClient({ socketPath: socket, ports: { probeProtocolInfo: () => probeFakeHost(socket) } }),
    modelAdmission: () => Promise.resolve(),
    heartbeatIntervalMs: 60_000,
    closeGraceMs: 50,
    onWarning: (message) => warnings.push(message),
    ...(input.options.useFallback === true ? { fallback } : {}),
  })
  // The record fields a started child leaves behind. Production stamps them when the omo-senpi
  // component owns the runner (plan todo 34); until then the suite writes exactly what that wiring
  // will, so the lifecycle branches under test see a real host-session record.
  const launch = {
    start: async (spec: RpcRunnerSpec): Promise<RpcChildHandle> => {
      const handle = await runner.start(spec)
      if (isHostSessionHandle(handle)) {
        store.mutate(spec.task_id, (fresh) => ({
          ...fresh,
          runner_kind: "host-session",
          host_session: {
            socket: handle.hostSession.socket,
            routing_id: handle.hostSession.routingId,
            session_path: handle.hostSession.sessionPath,
            instance_id: handle.hostSession.instanceId,
          },
        }))
      }
      return handle
    },
  }
  const manager = createTaskManager({
    store,
    config,
    cwd: projectDir,
    runners: {
      "in-process": { start: () => Promise.reject(new Error("the daemon suite never starts an in-process child")) },
      process: createRpcManagedRunner(launch),
    },
    rpcRespawnRunner: launch,
    ...(input.options.now === undefined ? {} : { now: input.options.now }),
    planner: () => ({ kind: "resolved", plan: { model: HOST_CHILD_MODEL } }),
    destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
    ...(input.options.hostPid === undefined ? {} : { hostPid: input.options.hostPid }),
  })
  const lifecycle = createTaskLifecycle({
    store,
    config,
    registry: createManagerResidencyRegistry(() => manager),
    ...(input.options.now === undefined ? {} : { now: input.options.now }),
    ...(input.options.hostPid === undefined ? {} : { hostPid: input.options.hostPid }),
    hostSessionProbe: input.options.productionProbe === true
      ? defaultHostSessionProbe()
      : createHostSessionProbe({
        daemonReachable: async (socket) => (await probeFakeHost(socket)) !== undefined,
        liveSessionPaths: (socket) => listFakeHostSessions(socket, { includeWorkers: true }),
      }),
    hostSessionClose: async (request) => {
      await closeHostSession(request, { createChannel: fakeCloseChannel })
    },
    hostRetry: {
      maxDrainAttempts: input.options.maxDrainAttempts ?? 3,
      defaultRetryAfterMs: 2_000,
      daemonLossBackoffMs: [1_000, 4_000, 16_000],
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    },
    // A suite drives every sweep itself; an unref'd interval would fire inside another test.
    idleReclaimerScheduler: { setInterval: () => ({ unref: () => undefined }), clearInterval: () => undefined },
  })
  const records = (): readonly TaskRecord[] =>
    store.list().records.filter((record) => record.parent_session_id === sessionId)
  return {
    sessionId,
    store,
    manager,
    lifecycle,
    warnings,
    waits,
    fallbackStarts: fallback.starts,
    startChildren: async (count) => {
      const started: StartResult[] = []
      for (let index = 0; index < count; index += 1) {
        started.push(
          await manager.start({
            prompt: `host child ${sessionId} #${index}`,
            parent_session_id: sessionId,
            depth: 1,
            execution_mode: "process",
            model: HOST_CHILD_MODEL,
          }),
        )
      }
      return started
    },
    records,
    taskIds: () => records().map((record) => record.task_id),
    sessionPaths: () => records().flatMap((record) => (record.host_session === undefined ? [] : [record.host_session.session_path])),
  }
}

