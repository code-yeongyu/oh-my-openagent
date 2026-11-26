// The controlled child runner and the assembled DAG engine over a real TaskManager, shared by the
// end-to-end suites: a scripted child settles, fails, or resumes on its own only when a test says so.
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskManager } from "../../manager/manager"
import type { AdmitResident, ChildPlanner, ManagedRunner, TaskManager } from "../../manager/types"
import type { TeardownStepDeadline } from "../../lifecycle/teardown-budget"
import type { DestructionPort } from "../../steering"
import { createTaskRecordStore, type TaskRecordStore } from "../../store"
import { ImmediateRunner } from "./controlled-runner"
import { parentSessionId, planner, rootSessionId } from "./controlled-dag-definitions"
import { resultPersistingManager } from "./result-persisting-manager"
import { ownedTaskState, ownedTaskStateDir } from "../../store/__fixtures__/owned-task-state"
import type { DagDefinition } from "../graph"
import { createDagWaitSurface, type DagRunResult } from "../handle"
import type { RetrySchedule } from "../infrastructure-retry"
import { createDagManager, type DagManager, type DagRunRecordV1, type DagStartResult } from "../manager"
import { createDagOwnerResumeFence } from "../owner-resume-fence"
import type { TaskRecord } from "../../state"
import {
  createDagScheduler,
  reenterDagRun,
  type DagNodeSendResult,
  type DagRunReentry,
  type DagScheduler,
} from "../scheduler"
import type { createDagSkillMaterializer } from "../skills"
import { createDagFileStore, type DagFileStore } from "../store"
import type { DagNodeId, DagRunEvent, DagRunId } from "../types"

export { categoryNode, definition, parentSessionId, planner, rootSessionId } from "./controlled-dag-definitions"
export { resultPersistingManager } from "./result-persisting-manager"

export type E2eFixtureOptions = {
  readonly project?: string
  readonly runner?: ManagedRunner
  readonly processRunner?: ManagedRunner
  readonly childPlanner?: ChildPlanner
  readonly admit?: AdmitResident
  readonly defaultConcurrency?: number
  readonly materializeSkills?: ReturnType<typeof createDagSkillMaterializer>
  readonly maxRunsPerSession?: number
  readonly scheduleRetry?: RetrySchedule
  readonly destruction?: DestructionPort
  readonly teardownStepDeadline?: TeardownStepDeadline
  /** The DAG self-resume fence is wired like the runtime wires it; false drives a manager without it. */
  readonly resumeFence?: boolean
  /** The fence's view of a cancellation in flight, for a scheduler the test built outside the fixture. */
  readonly cancelling?: (runId: DagRunId) => boolean
  // Cases that assert ordering or diagnostics, not durability, journal in memory (#11632); the crash,
  // torn-tail and retention cases keep the fsync-backed file store, which is what proves durability.
  readonly store?: DagFileStore
  // The ordering case also runs the real task manager on the in-memory record store (#11632); the
  // record store's own durability stays owned by record-store.test.ts on the file store.
  readonly taskStore?: TaskRecordStore
}

export type E2eFixture = {
  readonly project: string
  readonly store: DagFileStore
  readonly taskStore: TaskRecordStore
  readonly taskManager: TaskManager
  readonly manager: DagManager
  readonly runner: ManagedRunner
  readonly start: (input: DagDefinition) => Promise<DagStartResult>
  readonly wait: (runId: DagRunId) => Promise<DagRunResult>
  readonly running: (runId: DagRunId) => Promise<DagRunRecordV1>
  readonly events: (runId: DagRunId) => readonly DagRunEvent[]
  readonly whenEvent: (runId: DagRunId, predicate: (event: DagRunEvent) => boolean) => Promise<void>
  readonly whenIdle: (runId: DagRunId) => Promise<void>
  readonly retry: (runId: DagRunId, nodeIds?: readonly DagNodeId[]) => DagRunReentry
  readonly amend: (input: DagDefinition, runId: DagRunId) => Promise<DagRunReentry>
  readonly send: (runId: DagRunId, nodeId: DagNodeId, message: string) => Promise<DagNodeSendResult>
  readonly cancel: (runId: DagRunId, reason?: string) => Promise<void>
  /** Resolves when the task records its next event of this type. */
  readonly whenTaskEvent: (taskId: string, type: string) => Promise<void>
}

export function createE2eFixture(options: E2eFixtureOptions & { readonly project: string }): E2eFixture {
  const project = options.project
  const store =
    options.store ??
    createDagFileStore({
      project_dir: project,
      task: {
        state_dir: ownedTaskStateDir(project),
        ...(options.maxRunsPerSession === undefined
          ? {}
          : { dag: { max_runs_per_session: options.maxRunsPerSession } }),
      },
    })
  const baseTaskStore = options.taskStore ?? createTaskRecordStore(ownedTaskState(project))
  const eventWaiters = new Map<string, Array<() => void>>()
  const taskStore: TaskRecordStore = {
    ...baseTaskStore,
    appendEvent: (taskId, event) => {
      const written = baseTaskStore.appendEvent(taskId, event)
      for (const wake of eventWaiters.get(`${taskId}:${event.type}`)?.splice(0) ?? []) wake()
      return written
    },
  }
  const runner = options.runner ?? new ImmediateRunner()
  const taskManager = resultPersistingManager(
    createTaskManager({
      store: taskStore,
      runners: { "in-process": runner, process: options.processRunner ?? runner },
      planner: options.childPlanner ?? planner,
      config: OmoTaskSettingsSchema.parse({
        default_concurrency: options.defaultConcurrency ?? 16,
        max_depth: 1,
      }),
      cwd: project,
      ...(options.admit === undefined ? {} : { admit: options.admit }),
      ...(options.destruction === undefined ? {} : { destruction: options.destruction }),
      ...(options.teardownStepDeadline === undefined ? {} : { teardownStepDeadline: options.teardownStepDeadline }),
      ...(options.resumeFence === false
        ? {}
        : {
            ownerResumeFence: (record: TaskRecord) =>
              createDagOwnerResumeFence({
                store,
                cancelling: options.cancelling ?? ((runId) => schedulers.get(runId)?.cancelling() ?? false),
              })(record),
          }),
    }),
    store,
  )
  let nextRun = 0
  const manager = createDagManager({
    store,
    ownedTasks: taskManager,
    newRunId: () => {
      nextRun += 1
      return `dag-e2e-failure-${nextRun}` as DagRunId
    },
    ...(options.materializeSkills === undefined ? {} : { materializeSkills: options.materializeSkills }),
  })
  const schedulers = new Map<DagRunId, DagScheduler>()
  const runs = new Map<DagRunId, Promise<DagRunRecordV1>>()
  const waitSurface = createDagWaitSurface({
    store,
    ownedTasks: taskManager,
    subscribe: (runId, listener) => {
      const scheduler = schedulers.get(runId)
      if (scheduler === undefined) throw new Error(`missing scheduler for ${runId}`)
      return scheduler.subscribe(listener)
    },
  })

  return {
    project,
    store,
    taskStore,
    taskManager,
    manager,
    runner,
    async start(input) {
      const started = await manager.start({ definition: input, parentSessionId, rootSessionId })
      const runId = started.snapshot.runId
      if (!schedulers.has(runId) && started.snapshot.status === "pending") {
        const scheduler = createDagScheduler({
          store,
          taskManager,
          initialRecord: manager.record(runId, parentSessionId),
          ...(options.scheduleRetry === undefined ? {} : { scheduleRetry: options.scheduleRetry }),
        })
        schedulers.set(runId, scheduler)
        runs.set(runId, scheduler.run())
      }
      return started
    },
    wait: (runId) => waitSurface.wait(runId, parentSessionId),
    running(runId) {
      const running = runs.get(runId)
      if (running === undefined) throw new Error(`missing run promise for ${runId}`)
      return running
    },
    events: (runId) => manager.history({ runId, parentSessionId, limit: 256 }).events,
    whenEvent(runId, predicate) {
      const scheduler = schedulers.get(runId)
      if (scheduler === undefined) throw new Error(`missing scheduler for ${runId}`)
      return new Promise<void>((resolve) => {
        const unsubscribe = scheduler.subscribe((event) => {
          if (!predicate(event)) return
          unsubscribe()
          resolve()
        })
      })
    },
    whenIdle(runId) {
      const scheduler = schedulers.get(runId)
      if (scheduler === undefined) throw new Error(`missing scheduler for ${runId}`)
      return scheduler.whenIdle()
    },
    // The runtime's re-entry seam in miniature: control verbs run against the CURRENT durable
    // record, and the fresh scheduler they build replaces the settled one in the map.
    retry(runId, nodeIds) {
      const controls = nodeControls(runId)
      const reentry = nodeIds === undefined ? controls.retryNode(runId) : controls.retryNode(runId, nodeIds)
      register(runId, reentry)
      return reentry
    },
    async amend(input, runId) {
      await manager.amend({ runId, definition: input, parentSessionId })
      const reentry = reenterDagRun({
        store,
        taskManager,
        initialRecord: manager.record(runId, parentSessionId),
        ...(options.scheduleRetry === undefined ? {} : { scheduleRetry: options.scheduleRetry }),
      })
      register(runId, reentry)
      return reentry
    },
    send: (runId, nodeId, message) => nodeControls(runId).sendToNode(runId, nodeId, message),
    cancel: (runId, reason) => nodeControls(runId).cancel(runId, reason),
    whenTaskEvent: (taskId, type) =>
      new Promise<void>((resolve) => {
        const key = `${taskId}:${type}`
        eventWaiters.set(key, [...(eventWaiters.get(key) ?? []), resolve])
      }),
  }

  function nodeControls(runId: DagRunId): DagScheduler {
    const existing = schedulers.get(runId)
    if (existing !== undefined) return existing
    const fresh = createDagScheduler({
      store,
      taskManager,
      initialRecord: manager.record(runId, parentSessionId),
    })
    schedulers.set(runId, fresh)
    return fresh
  }

  function register(runId: DagRunId, reentry: DagRunReentry): void {
    schedulers.set(runId, reentry.scheduler)
    runs.set(runId, reentry.run)
  }
}

// Skill materialization with no skills to load: effectivePrompt tracks the submitted prompt, which
// is exactly what createDagSkillMaterializer produces for a node with no load_skills.
export const identityMaterializer: ReturnType<typeof createDagSkillMaterializer> = ({ definition: input }) => ({
  nodes: input.nodes.map((node) => ({ nodeId: node.id, effectivePrompt: node.prompt })),
})
