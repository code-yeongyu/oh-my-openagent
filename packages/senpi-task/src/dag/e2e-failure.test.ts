// allow: SIZE_OK - one end-to-end suite proves failure, crash recovery, child policy, durability, admission, and retention across the assembled DAG engine.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { randomInt } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  createReadToolDefinition,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskManager } from "../manager/manager"
import type { ManagedChildHandle } from "../manager/child-handle"
import { createInProcessManagedRunner, createRpcManagedRunner } from "../manager/runner"
import type {
  AdmitResident,
  ChildPlanner,
  ManagedRunner,
  ManagedStartSpec,
  ManagerStartSpec,
  TaskManager,
} from "../manager/types"
import { InProcessRunner, type ChildSession } from "../runners/in-process"
import { buildChildArgs } from "../runners/rpc/spawn"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecordStore } from "../store"
import type { TaskRecord } from "../state"
import { dagFingerprint } from "./fingerprint"
import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagWaitSurface, type DagRunResult } from "./handle"
import { createDagJournal } from "./journal"
import {
  createDagManager,
  DagManagerError,
  type DagManager,
  type DagRunRecordV1,
  type DagStartResult,
} from "./manager"
import { createDagRecovery } from "./recovery"
import { persistDagNodeResult } from "./results"
import {
  createDagScheduler,
  reenterDagRun,
  type DagNodeSendResult,
  type DagRunReentry,
  type DagScheduler,
} from "./scheduler"
import { createDagSkillMaterializer } from "./skills"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunEvent, DagRunId } from "./types"

// bunfig preloads test-setup.ts to raise the default timeout, but Bun honours a preload's
// setDefaultTimeout only for the FIRST test file of a run; every later file silently reverts to
// the built-in 5000ms. This suite assembles the real DAG manager, scheduler, and fsync-backed file
// store over temp dirs, so single cases overshoot 5s on a loaded windows runner (observed: 10796ms
// and 8638ms). Set the floor here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const cleanupRoots: string[] = []
const parentSessionId = "session-e2e-failure-parent"
const rootSessionId = "session-e2e-failure-root"
const sampleParameters = createReadToolDefinition(process.cwd()).parameters

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
    expect(fs.existsSync(root)).toBe(false)
  }
})

function tempProject(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-e2e-failure-"))
  cleanupRoots.push(root)
  return root
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function categoryNode(
  id: string,
  dependsOn: readonly string[] = [],
  overrides: {
    readonly prompt?: string
    readonly label?: string
    readonly task_summary?: string
    readonly description?: string
    readonly load_skills?: readonly string[]
  } = {},
): DagNodeInput {
  return {
    id,
    prompt: `do ${id}`,
    category: "quick",
    ...(dependsOn.length === 0 ? {} : { dependsOn }),
    ...overrides,
  }
}

function definition(key: string, nodes: readonly DagNodeInput[]): DagDefinition {
  return { key, name: key.replaceAll("-", " "), nodes }
}

function planner(spec: Parameters<ChildPlanner>[0]): ReturnType<ChildPlanner> {
  const target = spec.category ?? spec.subagent_type ?? "default"
  return {
    kind: "resolved",
    plan: {
      model: spec.model ?? `scripted/${target}`,
      ...(spec.category === undefined ? {} : { category: spec.category }),
      ...(spec.subagent_type === undefined ? {} : { agentType: spec.subagent_type }),
    },
  }
}

type ScriptedOutcome =
  | { readonly status: "completed"; readonly finalResponse: string }
  | {
      readonly status: "error"
      readonly killed: boolean
      readonly failure: { readonly kind: "child-prompt-failed"; readonly message: string }
    }

function completed(name: string): ScriptedOutcome {
  return { status: "completed", finalResponse: `output:${name}` }
}

function failed(name: string): ScriptedOutcome {
  return {
    status: "error",
    killed: false,
    failure: { kind: "child-prompt-failed", message: `failure:${name}` },
  }
}

type ControlledHandle = {
  readonly handle: ManagedChildHandle
  readonly settle: (outcome: ScriptedOutcome) => void
}

function controlledHandle(taskId: string): ControlledHandle {
  // Outcomes are queued, not overwritten: the first waitForOutcome() takes the first settle, and a
  // revived child re-tracked under a new run epoch takes the NEXT one instead of replaying it.
  const pending: ScriptedOutcome[] = []
  const waiters: Array<(outcome: ScriptedOutcome) => void> = []
  const settle = (value: ScriptedOutcome): void => {
    const waiter = waiters.shift()
    if (waiter === undefined) pending.push(value)
    else waiter(value)
  }
  const waitForOutcome = (): Promise<ScriptedOutcome> => {
    const ready = pending.shift()
    if (ready !== undefined) return Promise.resolve(ready)
    return new Promise<ScriptedOutcome>((resolve) => waiters.push(resolve))
  }
  return {
    settle,
    handle: {
      task_id: taskId,
      sessionId: `child-${taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    },
  }
}

class ControlledRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []
  readonly #handles = new Map<string, ControlledHandle>()
  readonly #startWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  readonly #onSettle?: () => void

  constructor(onSettle?: () => void) {
    this.#onSettle = onSettle
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    const controlled = controlledHandle(spec.taskId)
    this.#handles.set(spec.prompt.replace(/^do /, ""), controlled)
    for (const waiter of [...this.#startWaiters]) {
      if (this.startedSpecs.length >= waiter.count) waiter.resolve()
    }
    return Promise.resolve(controlled.handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.startedSpecs.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#startWaiters.push({ count, resolve }))
  }

  settle(name: string, outcome: ScriptedOutcome): void {
    const controlled = this.#handles.get(name)
    if (controlled === undefined) throw new Error(`missing controlled child ${name}`)
    this.#onSettle?.()
    controlled.settle(outcome)
  }
}

class ImmediateRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    const output = `output:${spec.prompt.replace(/^do /, "")}`
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: output }),
      lastAssistantText: () => output,
      dispose: () => Promise.resolve(),
    })
  }
}

function resultPersistingManager(manager: TaskManager, store: DagFileStore): TaskManager {
  return new Proxy(manager, {
    get(target, property) {
      if (property !== "waitFor") {
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      }
      return async (taskId: string, options?: { readonly signal?: AbortSignal }) => {
        const record = await target.waitFor(taskId, options)
        const owner = record.owner
        if (owner?.kind === "dag" && record.status === "completed") {
          const persisted = persistDagNodeResult({ store, runId: owner.runId, nodeId: owner.nodeId, record })
          if (persisted.kind === "failed") throw new Error(persisted.diagnostic.message)
        }
        return record
      }
    },
  })
}

type E2eFixtureOptions = {
  readonly project?: string
  readonly runner?: ManagedRunner
  readonly processRunner?: ManagedRunner
  readonly childPlanner?: ChildPlanner
  readonly admit?: AdmitResident
  readonly defaultConcurrency?: number
  readonly materializeSkills?: ReturnType<typeof createDagSkillMaterializer>
}

type E2eFixture = {
  readonly project: string
  readonly store: DagFileStore
  readonly taskStore: ReturnType<typeof createTaskRecordStore>
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
}

function e2eFixture(options: E2eFixtureOptions = {}): E2eFixture {
  const project = options.project ?? tempProject()
  const store = createDagFileStore({ project_dir: project })
  const taskStore = createTaskRecordStore({ project_dir: project })
  const runner = options.runner ?? new ImmediateRunner()
  const taskManager = resultPersistingManager(createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: options.processRunner ?? runner },
    planner: options.childPlanner ?? planner,
    config: OmoTaskSettingsSchema.parse({
      default_concurrency: options.defaultConcurrency ?? 16,
      max_depth: 1,
    }),
    cwd: project,
    ...(options.admit === undefined ? {} : { admit: options.admit }),
  }), store)
  let nextRun = 0
  const manager = createDagManager({
    store,
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
      })
      register(runId, reentry)
      return reentry
    },
    send: (runId, nodeId, message) => nodeControls(runId).sendToNode(runId, nodeId, message),
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
const identityMaterializer: ReturnType<typeof createDagSkillMaterializer> = ({ definition: input }) => ({
  nodes: input.nodes.map((node) => ({ nodeId: node.id, effectivePrompt: node.prompt })),
})

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

function immediateChildSession(): ChildSession {
  return {
    sessionId: "policy-child",
    prompt: () => Promise.resolve(),
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    getLastAssistantText: () => "policy complete",
    dispose: () => undefined,
  }
}

function rpcHandle(taskId: string): RpcChildHandle {
  return {
    task_id: taskId,
    sessionId: `rpc-${taskId}`,
    pid: 4242,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => "rpc complete",
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => Promise.resolve({
      kind: "clean",
      facts: { pid: 4242, code: 0, signal: null, stderrTail: "" },
    }),
    lastSeen: () => undefined,
  }
}

function extensionValues(args: readonly string[]): readonly string[] {
  const entries: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--extension" && args[index + 1] !== undefined) entries.push(args[index + 1] ?? "")
  }
  return entries
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return text
      text += decoder.decode(chunk.value, { stream: true })
      const newline = text.indexOf("\n")
      if (newline >= 0) return text.slice(0, newline)
    }
  } finally {
    reader.releaseLock()
  }
}

describe("DAG failure, crash, and policy end to end", () => {
  const DAG_FAILURE_E2E_TIMEOUT_MS = process.platform === "win32" ? 90_000 : 15_000

  test("#given two failures whose completion order opposes graph order #when the real engine runs #then siblings and independent branches finish, dependents skip, and graph order selects the primary failure", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const input = definition("failure-order", [
      categoryNode("graph-first-failure"),
      categoryNode("wall-clock-first-failure"),
      categoryNode("sibling-success"),
      categoryNode("independent-root"),
      categoryNode("skipped-dependent", ["graph-first-failure"]),
      categoryNode("sibling-dependent", ["sibling-success"]),
      categoryNode("independent-dependent", ["independent-root"]),
    ])

    // when
    const started = await fixture.start(input)
    await runner.whenStarted(4)
    runner.settle("wall-clock-first-failure", failed("wall-clock-first-failure"))
    runner.settle("sibling-success", completed("sibling-success"))
    runner.settle("independent-root", completed("independent-root"))
    runner.settle("graph-first-failure", failed("graph-first-failure"))
    await runner.whenStarted(6)
    runner.settle("sibling-dependent", completed("sibling-dependent"))
    runner.settle("independent-dependent", completed("independent-dependent"))
    const result = await fixture.wait(started.snapshot.runId)

    // then
    expect(result.status).toBe("failed")
    expect(Object.fromEntries(Object.entries(result.nodes).map(([id, node]) => [id, node.state]))).toEqual({
      "graph-first-failure": "failed",
      "wall-clock-first-failure": "failed",
      "sibling-success": "completed",
      "independent-root": "completed",
      "skipped-dependent": "skipped",
      "sibling-dependent": "completed",
      "independent-dependent": "completed",
    })
    const terminal = fixture.events(result.runId).find((event) => event.type === "dag.run.failed")
    expect(terminal).toMatchObject({
      type: "dag.run.failed",
      error: { nodeId: "graph-first-failure", message: "failure:graph-first-failure" },
    })
  }, { timeout: DAG_FAILURE_E2E_TIMEOUT_MS })

  test("#given a crash after an owned task spawns but before task attachment #when a fresh manager resumes #then startOwned recovers the existing task and spawn count remains exactly one", async () => {
    // given
    const project = tempProject()
    const firstRunner = new ControlledRunner()
    const first = e2eFixture({ project, runner: firstRunner })
    const input = definition("spawn-before-attach", [categoryNode("recover-me")])
    const started = await first.manager.start({ definition: input, parentSessionId, rootSessionId })
    const runId = started.snapshot.runId
    const initial = first.manager.record(runId, parentSessionId)
    first.store.writeCheckpoint(runId, {
      ...initial,
      status: "paused",
      previousLeaseHolderPid: 99_001,
      nodes: initial.nodes.map((node) => ({ ...node, state: "scheduled" as const })),
    })
    const owned = await first.taskManager.startOwned({
      prompt: "do recover-me",
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      name: "recover-me",
      run_in_background: true,
    }, {
      kind: "dag",
      runId,
      nodeId: initial.nodes[0]?.id ?? "recover-me",
      fingerprint: dagFingerprint({ definitionFingerprint: initial.definitionFingerprint, nodeId: initial.nodes[0]?.id ?? "recover-me" }),
    })
    if (owned.kind !== "started") throw new Error("owned task did not start")
    firstRunner.settle("recover-me", completed("recover-me"))
    await first.taskManager.waitFor(owned.task_id)
    const recoveredRunner = new ImmediateRunner()
    const recoveredTaskManager = resultPersistingManager(createTaskManager({
      store: createTaskRecordStore({ project_dir: project }),
      runners: { "in-process": recoveredRunner, process: recoveredRunner },
      planner,
      config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
      cwd: project,
      hostPid: 202,
    }), first.store)

    // when
    const outcomes = await createDagRecovery({
      store: first.store,
      taskManager: recoveredTaskManager,
      hostPid: 202,
      isProcessAlive: (pid) => pid === 202,
    }).resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.record?.status).toBe("completed")
    expect(outcomes[0]?.record?.nodes[0]).toMatchObject({ state: "completed", taskId: owned.task_id })
    expect(firstRunner.startedSpecs).toHaveLength(1)
    expect(recoveredRunner.startedSpecs).toHaveLength(0)
    expect(firstRunner.startedSpecs.length + recoveredRunner.startedSpecs.length).toBe(1)
  })

  test("#given an existing run key #when its prompt changes #then definition_conflict leaves the original checkpoint, events, and task count untouched", async () => {
    // given
    const fixture = e2eFixture()
    const original = definition("conflict", [categoryNode("only")])
    const first = await fixture.start(original)
    await fixture.wait(first.snapshot.runId)
    const checkpointBefore = fs.readFileSync(fixture.store.paths.run(first.snapshot.runId), "utf8")
    const eventsBefore = fs.readFileSync(fixture.store.paths.event(first.snapshot.runId), "utf8")
    const tasksBefore = fixture.taskStore.list().records.length

    // when
    const conflict = fixture.start(definition("conflict", [categoryNode("only", [], { prompt: "changed prompt" })]))

    // then
    await expect(conflict).rejects.toBeInstanceOf(DagManagerError)
    await expect(conflict).rejects.toMatchObject({ code: "definition_conflict", runId: first.snapshot.runId })
    expect(fs.readFileSync(fixture.store.paths.run(first.snapshot.runId), "utf8")).toBe(checkpointBefore)
    expect(fs.readFileSync(fixture.store.paths.event(first.snapshot.runId), "utf8")).toBe(eventsBefore)
    expect(fixture.taskStore.list().records).toHaveLength(tasksBefore)
  })

  test("#given spawn-capable parent tools #when an in-process DAG child resolves its real session options #then task, task_*, team_*, and workflow are absent", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const inProcess = new InProcessRunner({
      sharedParentTools: [
        makeTool("read"),
        makeTool("task"),
        makeTool("task_create"),
        makeTool("team_send"),
        makeTool("workflow"),
      ],
      createSession: async (options) => {
        captured = options
        return immediateChildSession()
      },
    })
    const fixture = e2eFixture({ runner: createInProcessManagedRunner(inProcess) })

    // when
    const started = await fixture.start(definition("in-process-policy", [categoryNode("policy")]))
    await fixture.wait(started.snapshot.runId)

    // then
    const names = (captured?.customTools ?? []).map((tool) => tool.name)
    expect(names).toContain("read")
    expect(names).not.toContain("task")
    expect(names).not.toContain("workflow")
    expect(names.some((name) => name.startsWith("task_") || name.startsWith("team_"))).toBe(false)
  })

  test("#given inherited rpc extensions #when DAG and non-DAG children spawn #then only the DAG child omits the leading omo-senpi entry", async () => {
    // given
    const inheritedExtensions = ["/extensions/omo-senpi.js", "/extensions/provider.js"]
    const spawnedArgs: { readonly taskId: string; readonly args: readonly string[] }[] = []
    const rpcRunner = createRpcManagedRunner({
      async start(spec: RpcRunnerSpec) {
        const args = buildChildArgs({ ...spec, extensions: inheritedExtensions })
        spawnedArgs.push({ taskId: spec.task_id, args })
        return rpcHandle(spec.task_id)
      },
    })
    const processPlanner: ChildPlanner = (spec) => ({
      kind: "resolved",
      plan: {
        model: "scripted/rpc",
        category: spec.category,
        agentExecutionMode: "process",
      },
    })
    const fixture = e2eFixture({ processRunner: rpcRunner, childPlanner: processPlanner })
    const dag = await fixture.start(definition("rpc-policy", [categoryNode("dag-rpc")]))
    await fixture.wait(dag.snapshot.runId)

    // when
    const ordinary = await fixture.taskManager.start({
      prompt: "ordinary rpc",
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      execution_mode: "process",
      name: "ordinary-rpc",
    })
    if (ordinary.kind !== "started") throw new Error("ordinary rpc child did not start")
    await fixture.taskManager.waitFor(ordinary.task_id)

    // then
    expect(spawnedArgs).toHaveLength(2)
    expect(extensionValues(spawnedArgs[0]?.args ?? [])).toEqual(["/extensions/provider.js"])
    expect(extensionValues(spawnedArgs[1]?.args ?? [])).toEqual(inheritedExtensions)
  })

  test("#given a missing requested skill #when the real run starts #then a missing_skill diagnostic is retained and the node still completes", async () => {
    // given
    const project = tempProject()
    const store = createDagFileStore({ project_dir: project })
    const materializeSkills = createDagSkillMaterializer({
      store,
      cwd: project,
      loadSkills: (names) => ({ prepend: "", resolved: [], missing: [...names] }),
    })
    const fixture = e2eFixture({ project, materializeSkills })

    // when
    const started = await fixture.start(definition("missing-skill", [
      categoryNode("build", [], { load_skills: ["not-installed"] }),
    ]))
    const result = await fixture.wait(started.snapshot.runId)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.build?.state).toBe("completed")
    expect(result.snapshot.diagnostics).toContainEqual(expect.objectContaining({
      kind: "missing_skill",
      nodeId: "build",
      skill: "not-installed",
    }))
  })

  test("#given a corrupt trailing JSONL fragment #when the store reopens #then the tail is discarded, diagnosed, and earlier events remain authoritative", async () => {
    // given
    const project = tempProject()
    const fixture = e2eFixture({ project })
    const started = await fixture.start(definition("event-tail", [categoryNode("done")]))
    await fixture.wait(started.snapshot.runId)
    const authoritative = fixture.events(started.snapshot.runId)
    fs.appendFileSync(fixture.store.paths.event(started.snapshot.runId), '{"schemaVersion":1,"seq":999')

    // when
    const reopened = createDagFileStore({ project_dir: project })
    const recovered = reopened.readEvents(started.snapshot.runId, 0, { limit: 256 })

    // then
    expect(recovered.events).toEqual(authoritative)
    expect(reopened.diagnostics()).toContainEqual(expect.objectContaining({
      kind: "event_log_recovered",
      runId: started.snapshot.runId,
    }))
    expect(fs.readFileSync(reopened.paths.event(started.snapshot.runId), "utf8")).toEndWith("\n")
  })

  test("#given a SIGKILL at a randomized fsync-backed mutation boundary #when the store reopens #then the checkpoint is whole and every journaled event replays", async () => {
    // given
    const project = tempProject()
    const stopAt = randomInt(2, 9)
    const script = join(project, "kill-mid-mutation.ts")
    const storeModule = pathToFileURL(join(import.meta.dir, "store.ts")).href
    const runId = "dag-kill-mid-mutation"
    fs.writeFileSync(script, `
import { createDagFileStore } from ${JSON.stringify(storeModule)}
const project = process.argv[2]
const stopAt = Number(process.argv[3])
const runId = ${JSON.stringify(runId)}
const store = createDagFileStore({ project_dir: project })
store.writeCheckpoint(runId, { schemaVersion: 1, checkpointSeq: 0, runId, applied: [] })
for (let seq = 1; seq <= stopAt; seq += 1) {
  store.appendEvent({ schemaVersion: 1, runId, seq, at: new Date(seq).toISOString(), lane: "boundary", type: "dag.diagnostic.added", diagnostic: { kind: "run_flag", message: String(seq), at: new Date(seq).toISOString() } })
  if (seq === stopAt) {
    process.stdout.write(JSON.stringify({ armed: seq }) + "\\n")
    await new Promise((resolve) => process.stdin.once("data", resolve))
  }
  store.writeCheckpoint(runId, { schemaVersion: 1, checkpointSeq: seq, runId, applied: Array.from({ length: seq }, (_, index) => index + 1) })
}
`)
    const child = Bun.spawn([process.execPath, script, project, String(stopAt)], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const marker = JSON.parse(await readLine(child.stdout)) as { readonly armed: number }
    expect(marker.armed).toBe(stopAt)

    // when
    child.kill("SIGKILL")
    await child.exited
    const reopened = createDagFileStore({ project_dir: project })
    const beforeReplay = reopened.readCheckpoint<{ readonly checkpointSeq: number; readonly applied: readonly number[] }>(runId as DagRunId)
    const journal = createDagJournal({
      store: reopened,
      runId: runId as DagRunId,
      initialCheckpoint: { schemaVersion: 1 as const, checkpointSeq: 0, applied: [] as readonly number[] },
      applyEvent: (checkpoint, event) => ({ ...checkpoint, applied: [...checkpoint.applied, event.seq] }),
    })

    // then
    expect(child.signalCode).toBe("SIGKILL")
    expect(beforeReplay?.checkpointSeq).toBe(stopAt - 1)
    expect(beforeReplay?.applied).toEqual(Array.from({ length: stopAt - 1 }, (_, index) => index + 1))
    expect(journal.snapshot().checkpointSeq).toBe(stopAt)
    expect(journal.snapshot().applied).toEqual(Array.from({ length: stopAt }, (_, index) => index + 1))
    expect(reopened.readEvents(runId as DagRunId, 0, { limit: 32 }).events).toHaveLength(stopAt)
    expect(fs.readdirSync(reopened.paths.runs).some((name) => name.endsWith(".tmp"))).toBe(false)
  })

  test("#given a wave wider than residency_max_children #when admission frees slots in batches #then every node completes without a residency failure", async () => {
    // given
    const cap = 2
    let residents = 0
    let peakResidents = 0
    const admit: AdmitResident = () => {
      if (residents >= cap) return Promise.resolve({ kind: "rejected", message: "resident cap reached" })
      residents += 1
      peakResidents = Math.max(peakResidents, residents)
      return Promise.resolve({ kind: "admitted" })
    }
    const runner = new ControlledRunner(() => {
      residents -= 1
    })
    const fixture = e2eFixture({ runner, admit })
    const input = definition("batched-wave", Array.from({ length: 7 }, (_, index) => categoryNode(`wide-${index}`)))

    // when
    const started = await fixture.start(input)
    for (let completedCount = 0; completedCount < input.nodes.length; completedCount += 1) {
      await runner.whenStarted(completedCount + 1)
      runner.settle(`wide-${completedCount}`, completed(`wide-${completedCount}`))
    }
    const result = await fixture.wait(started.snapshot.runId)

    // then
    expect(result.status).toBe("completed")
    expect(result.snapshot.counts).toEqual(expect.objectContaining({ total: 7, completed: 7, failed: 0 }))
    expect(peakResidents).toBe(cap)
    expect(runner.startedSpecs).toHaveLength(7)
    expect(fixture.events(result.runId).filter((event) =>
      event.type === "dag.node.transitioned" && event.to === "failed",
    )).toHaveLength(0)
  }, process.platform === "win32" ? 30_000 : 5_000)

  test("#given expired terminal artifacts and equally old live artifacts #when retention runs #then events, results, and skills are pruned only for the terminal run", () => {
    // given
    const project = tempProject()
    const now = Date.parse("2026-08-14T00:00:00.000Z")
    const old = "2026-08-01T00:00:00.000Z"
    const store = createDagFileStore({
      project_dir: project,
      task: { dag: { retention_days: 7 } },
    })
    const terminalRun = "dag-terminal-expired" as DagRunId
    const liveRun = "dag-live-old" as DagRunId
    const checkpoint = (runId: DagRunId, status: "completed" | "running") => ({
      schemaVersion: 1,
      checkpointSeq: 1,
      runId,
      runKey: String(runId),
      parentSessionId,
      status,
      completedAt: old,
      updatedAt: old,
      nodes: [],
    })
    store.writeCheckpoint(terminalRun, checkpoint(terminalRun, "completed"))
    store.writeCheckpoint(liveRun, checkpoint(liveRun, "running"))
    for (const runId of [terminalRun, liveRun]) {
      store.appendEvent({
        schemaVersion: 1,
        runId,
        seq: 1,
        at: old,
        lane: "boundary",
        type: "dag.diagnostic.added",
        diagnostic: { kind: "run_flag", message: "retention", at: old },
      })
      store.writeResult(runId, "node", `result:${runId}`)
      const skillsDir = join(store.paths.root, "skills")
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(join(skillsDir, `${runId}.json`), JSON.stringify({ schemaVersion: 1, runId }))
    }

    // when
    const pruned = store.pruneExpired(now)

    // then
    expect(pruned).toEqual([terminalRun])
    for (const path of [
      store.paths.run(terminalRun),
      store.paths.event(terminalRun),
      join(store.paths.results, terminalRun),
      join(store.paths.root, "skills", `${terminalRun}.json`),
    ]) expect(fs.existsSync(path)).toBe(false)
    for (const path of [
      store.paths.run(liveRun),
      store.paths.event(liveRun),
      join(store.paths.results, liveRun),
      join(store.paths.root, "skills", `${liveRun}.json`),
    ]) expect(fs.existsSync(path)).toBe(true)
  })
})

describe("DAG retry, amend, and revive end to end", () => {
  test("#given a failed node in a completed-upstream run #when retried #then the run completes and every upstream task id is reused untouched", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const input = definition("retry-after-failure", [
      categoryNode("upstream"),
      categoryNode("flaky", ["upstream"]),
      categoryNode("downstream", ["flaky"]),
    ])
    const started = await fixture.start(input)
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    runner.settle("upstream", completed("upstream"))
    await runner.whenStarted(2)
    runner.settle("flaky", failed("flaky"))
    const failedResult = await fixture.wait(runId)
    const upstreamTaskId = failedResult.snapshot.nodes.find((entry) => entry.id === "upstream")?.taskId

    // when
    const reentry = fixture.retry(runId)
    await runner.whenStarted(3)
    runner.settle("flaky", completed("flaky"))
    await runner.whenStarted(4)
    runner.settle("downstream", completed("downstream"))
    const record = await reentry.run
    const result = await fixture.wait(runId)

    // then
    expect(failedResult.status).toBe("failed")
    expect(failedResult.nodes.downstream?.state).toBe("skipped")
    expect(record.status).toBe("completed")
    expect(result.status).toBe("completed")
    expect(result.snapshot.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "upstream:completed",
      "flaky:completed",
      "downstream:completed",
    ])
    expect(result.snapshot.nodes.find((entry) => entry.id === "upstream")?.taskId).toBe(upstreamTaskId)
    expect(runner.startedSpecs.filter((spec) => spec.prompt === "do upstream")).toHaveLength(1)
    expect(runner.startedSpecs.filter((spec) => spec.prompt === "do flaky")).toHaveLength(2)
    expect(result.snapshot.nodes.find((entry) => entry.id === "flaky")?.execAttempt).toBe(1)
    expect(fixture.events(runId).some((event) => event.type === "dag.node.retried")).toBe(true)
    expect(fixture.events(runId).some((event) => event.type === "dag.run.resumed")).toBe(true)
    expect(fs.readFileSync(fixture.store.paths.result(runId, "flaky"), "utf8")).toBe("output:flaky")
  })

  test("#given a node that fails twice #when retried twice #then each attempt owns a distinct child and the last one settles the run", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const started = await fixture.start(definition("retry-twice", [categoryNode("stubborn")]))
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    runner.settle("stubborn", failed("stubborn"))
    await fixture.wait(runId)

    // when
    const first = fixture.retry(runId)
    await runner.whenStarted(2)
    runner.settle("stubborn", failed("stubborn"))
    expect((await first.run).status).toBe("failed")
    const second = fixture.retry(runId)
    await runner.whenStarted(3)
    runner.settle("stubborn", completed("stubborn"))
    const record = await second.run

    // then
    expect(record.status).toBe("completed")
    expect(record.nodes[0]).toMatchObject({ state: "completed", execAttempt: 2 })
    const taskIds = runner.startedSpecs.map((spec) => spec.taskId)
    expect(new Set(taskIds).size).toBe(3)
    expect(record.nodes[0]?.taskId).toBe(taskIds[2])
    expect(fs.readFileSync(fixture.store.paths.result(runId, "stubborn"), "utf8")).toBe("output:stubborn")
  })

  test("#given a node failed by the residency cap #when retried after the storm clears #then it runs and the run completes", async () => {
    // given - admission denies while the cap is full and no sibling can free a slot, minting residency_denied
    let capOpen = false
    const runner = new ControlledRunner()
    const admit: AdmitResident = () => capOpen
      ? Promise.resolve({ kind: "admitted" })
      : Promise.resolve({ kind: "rejected", message: "resident child cap reached" })
    const fixture = e2eFixture({ runner, admit })
    const started = await fixture.start(definition("residency-rescue", [categoryNode("stormy")]))
    const runId = started.snapshot.runId
    const stormed = await fixture.wait(runId)

    // when
    capOpen = true
    const reentry = fixture.retry(runId)
    await runner.whenStarted(1)
    runner.settle("stormy", completed("stormy"))
    const record = await reentry.run

    // then
    expect(stormed.status).toBe("failed")
    expect(stormed.nodes.stormy).toMatchObject({ state: "failed", error: { code: "residency_denied" } })
    expect(record.status).toBe("completed")
    expect(record.nodes[0]?.state).toBe("completed")
  })

  test("#given a failed node #when its prompt is amended #then only it and its dependents re-run on re-entry", async () => {
    // given
    // The harness always wires a skill materializer (dag-runtime does), and it is what re-derives a
    // changed node's effectivePrompt at amend, so the fixture mirrors that wiring here.
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner, materializeSkills: identityMaterializer })
    const original = definition("amend-after-failure", [
      categoryNode("stable"),
      categoryNode("wrong", ["stable"]),
      categoryNode("after", ["wrong"]),
    ])
    const started = await fixture.start(original)
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    runner.settle("stable", completed("stable"))
    await runner.whenStarted(2)
    runner.settle("wrong", failed("wrong"))
    await fixture.wait(runId)
    const stableTaskId = fixture.manager.record(runId, parentSessionId).nodes.find((entry) => entry.id === "stable")?.taskId

    // when
    const amended = definition("amend-after-failure", [
      categoryNode("stable"),
      categoryNode("wrong", ["stable"], { prompt: "do wrong-fixed" }),
      categoryNode("after", ["wrong"]),
    ])
    const reentry = await fixture.amend(amended, runId)
    await runner.whenStarted(3)
    runner.settle("wrong-fixed", completed("wrong-fixed"))
    await runner.whenStarted(4)
    runner.settle("after", completed("after"))
    const record = await reentry.run

    // then
    expect(record.status).toBe("completed")
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "stable:completed",
      "wrong:completed",
      "after:completed",
    ])
    expect(record.nodes.find((entry) => entry.id === "stable")?.taskId).toBe(stableTaskId)
    expect(runner.startedSpecs.map((spec) => spec.prompt)).toEqual([
      "do stable",
      "do wrong",
      "do wrong-fixed",
      "do after",
    ])
    expect(record.amendHistory).toHaveLength(1)
  })

  test("#given a settled run #when an amendment adds a node #then the added node executes on re-entry", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const original = definition("amend-add-node", [categoryNode("first")])
    const started = await fixture.start(original)
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    runner.settle("first", completed("first"))
    await fixture.wait(runId)

    // when
    const grown = definition("amend-add-node", [categoryNode("first"), categoryNode("second", ["first"])])
    const reentry = await fixture.amend(grown, runId)
    await runner.whenStarted(2)
    runner.settle("second", completed("second"))
    const record = await reentry.run

    // then
    expect(record.status).toBe("completed")
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["first:completed", "second:completed"])
    expect(runner.startedSpecs.map((spec) => spec.prompt)).toEqual(["do first", "do second"])
    expect(fs.readFileSync(fixture.store.paths.result(runId, "second"), "utf8")).toBe("output:second")
  })

  test("#given a live wave with one failed node revived before its sibling settles #when the sibling completes #then the run awaits the revival and schedules their dependent", async () => {
    // given - mirrors dag_2d12c2f7: A and B share wave 0; C depends on both.
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const started = await fixture.start(definition("revive-inside-live-wave", [
      categoryNode("A"),
      categoryNode("B"),
      categoryNode("C", ["A", "B"]),
    ]))
    const runId = started.snapshot.runId
    await runner.whenStarted(2)
    const bFailed = fixture.whenEvent(runId, (event) =>
      event.type === "dag.node.transitioned" && event.nodeId === "B" && event.to === "failed",
    )
    runner.settle("B", failed("B"))
    await bFailed
    const sent = await fixture.send(runId, "B" as DagNodeId, "continue after the transient abort")

    // when - A is the last settlement still known to the original wave await set.
    const aCompleted = fixture.whenEvent(runId, (event) =>
      event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
    )
    runner.settle("A", completed("A"))
    await aCompleted
    await fixture.whenIdle(runId)

    // then - B's revived turn remains part of the live barrier, so no terminal event can land yet.
    expect(sent.delivery).toBe("revive")
    expect(fixture.manager.record(runId, parentSessionId).status).toBe("running")
    expect(fixture.events(runId).some((event) =>
      event.type === "dag.run.completed" || event.type === "dag.run.failed",
    )).toBe(false)

    const bCompleted = fixture.whenEvent(runId, (event) =>
      event.type === "dag.node.transitioned" && event.nodeId === "B" && event.to === "completed",
    )
    runner.settle("B", completed("B-revived"))
    await bCompleted
    await sent.settled
    await runner.whenStarted(3)
    expect(runner.startedSpecs[2]?.prompt).toBe("do C")
    runner.settle("C", completed("C"))
    const record = await fixture.running(runId)

    expect(record.status).toBe("completed")
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "A:completed",
      "B:completed",
      "C:completed",
    ])
    const terminal = fixture.events(runId).filter((event) =>
      event.type === "dag.run.completed" || event.type === "dag.run.failed",
    )
    expect(terminal).toHaveLength(1)
    expect(terminal[0]?.type).toBe("dag.run.completed")
  })

  test("#given a failed node whose child is still resident #when send revives it #then the child continues in place and the node reaches completed once", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = e2eFixture({ runner })
    const started = await fixture.start(definition("revive-resident", [categoryNode("stuck")]))
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    runner.settle("stuck", failed("stuck"))
    const failedResult = await fixture.wait(runId)
    const taskId = failedResult.snapshot.nodes[0]?.taskId ?? ""

    // when
    const sent = await fixture.send(runId, "stuck" as DagNodeId, "try the other approach")
    runner.settle("stuck", completed("stuck-revived"))
    await sent.settled

    // then
    expect(failedResult.status).toBe("failed")
    expect(sent).toMatchObject({ delivery: "revive", nodeId: "stuck", taskId })
    const record = fixture.manager.record(runId, parentSessionId)
    expect(record.nodes[0]).toMatchObject({ state: "completed", taskId })
    expect(record.nodes[0]?.error).toBeUndefined()
    expect(runner.startedSpecs).toHaveLength(1)
    expect(fixture.events(runId).filter((event) =>
      event.type === "dag.node.transitioned" && event.nodeId === "stuck" && event.to === "completed",
    )).toHaveLength(1)
    expect(fixture.events(runId)).toContainEqual(expect.objectContaining({
      type: "dag.node.steered",
      nodeId: "stuck",
      delivery: "revive",
    }))
    expect(fs.readFileSync(fixture.store.paths.result(runId, "stuck"), "utf8")).toBe("output:stuck-revived")
  })
})
