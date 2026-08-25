// allow: SIZE_OK - one end-to-end fixture proves the assembled manager, scheduler, task manager, wait surface, SDK, and durable store agree across all happy-path graph shapes.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskManager } from "../manager/manager"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { AdmitResident, ChildPlanner, ManagedRunner, ManagedStartSpec } from "../manager/types"
import { createTaskRecordStore } from "../store"
import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagWaitSurface, type DagRunResult } from "./handle"
import { createDagManager, type DagManager, type DagRunRecordV1, type DagStartResult } from "./manager"
import {
  createDagScheduler,
  type DagNodeSendResult,
  type DagRunReentry,
  type DagScheduler,
} from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunEvent, DagRunId } from "./types"

// bunfig preloads test-setup.ts to raise the default timeout, but Bun honours a preload's
// setDefaultTimeout only for the FIRST test file of a run; every later file silently reverts to
// the built-in 5000ms. Windows job 96304719047 in run 32328567654 measured the diamond case at
// 5759ms against that 5000ms floor. Set the floor here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const cleanupRoots: string[] = []
const parentSessionId = "session-e2e-parent"
const rootSessionId = "session-e2e-root"
const sdkPath = join(import.meta.dir, "../../../omo-senpi/plugin/runtime/dag/sdk.js")

let originalTool: unknown

beforeSdkTestState()

afterEach(() => {
  if (originalTool === undefined) Reflect.deleteProperty(globalThis, "tool")
  else Reflect.set(globalThis, "tool", originalTool)
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
    expect(fs.existsSync(root)).toBe(false)
  }
  beforeSdkTestState()
})

function beforeSdkTestState(): void {
  originalTool = Reflect.get(globalThis, "tool")
}

function tempProject(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-e2e-"))
  cleanupRoots.push(root)
  return root
}

// A child whose outcome the test settles by hand, so a node can be observed mid-flight (steered,
// cancelled) instead of completing the instant it starts.
type HeldChild = {
  readonly handle: ManagedChildHandle
  readonly settle: (outcome: { readonly status: "completed"; readonly finalResponse: string }) => void
  readonly steered: string[]
}

class HeldRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []
  readonly children = new Map<string, HeldChild>()
  readonly #startWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    const name = spec.prompt.replace(/^do /, "")
    // Outcomes are queued, not overwritten: a settle that lands before the manager first observes
    // the outcome still reaches that observer, and a later attempt takes the NEXT settle.
    type HeldOutcome = { readonly status: "completed"; readonly finalResponse: string }
    const pending: HeldOutcome[] = []
    const waiters: Array<(outcome: HeldOutcome) => void> = []
    const steered: string[] = []
    const child: HeldChild = {
      steered,
      settle: (value) => {
        const waiter = waiters.shift()
        if (waiter === undefined) pending.push(value)
        else waiter(value)
      },
      handle: {
        task_id: spec.taskId,
        sessionId: `child-${spec.taskId}`,
        pid: undefined,
        steer: async (text) => {
          steered.push(text)
        },
        followUp: async (text) => {
          steered.push(text)
        },
        abort: () => Promise.resolve(),
        subscribe: () => () => undefined,
        waitForOutcome: () => {
          const ready = pending.shift()
          if (ready !== undefined) return Promise.resolve(ready)
          return new Promise<HeldOutcome>((resolve) => waiters.push(resolve))
        },
        lastAssistantText: () => undefined,
        dispose: () => Promise.resolve(),
      },
    }
    this.children.set(name, child)
    for (const waiter of [...this.#startWaiters]) {
      if (this.startedSpecs.length >= waiter.count) waiter.resolve()
    }
    return Promise.resolve(child.handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.startedSpecs.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#startWaiters.push({ count, resolve }))
  }

  child(name: string): HeldChild {
    const child = this.children.get(name)
    if (child === undefined) throw new Error(`missing held child ${name}`)
    return child
  }
}

class ScriptedRunner implements ManagedRunner {
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

type E2eFixture = {
  readonly project: string
  readonly store: DagFileStore
  readonly manager: DagManager
  readonly runner: ScriptedRunner
  readonly start: (definition: DagDefinition) => Promise<DagStartResult>
  readonly wait: (runId: DagRunId) => Promise<DagRunResult>
  readonly events: (runId: DagRunId) => readonly DagRunEvent[]
  readonly running: (runId: DagRunId) => Promise<DagRunRecordV1>
  readonly cancel: (runId: DagRunId, reason?: string) => Promise<void>
  readonly attached: (runId: DagRunId, nodeId: DagNodeId) => Promise<void>
  readonly retry: (runId: DagRunId) => DagRunReentry
  readonly send: (runId: DagRunId, nodeId: DagNodeId, message: string) => Promise<DagNodeSendResult>
}

function e2eFixture(options: { readonly admit?: AdmitResident; readonly runner?: ManagedRunner } = {}): E2eFixture {
  const project = tempProject()
  const store = createDagFileStore({ project_dir: project })
  const taskStore = createTaskRecordStore({ project_dir: project })
  const runner = new ScriptedRunner()
  const activeRunner = options.runner ?? runner
  const taskManager = createTaskManager({
    store: taskStore,
    runners: { "in-process": activeRunner, process: activeRunner },
    planner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
    ...(options.admit === undefined ? {} : { admit: options.admit }),
  })
  let nextRun = 0
  const manager = createDagManager({
    store,
    newRunId: () => {
      nextRun += 1
      return `dag-e2e-${nextRun}` as DagRunId
    },
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
    manager,
    runner,
    async start(definition) {
      const started = await manager.start({ definition, parentSessionId, rootSessionId })
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
    events: (runId) => manager.history({ runId, parentSessionId, limit: 256 }).events,
    running(runId) {
      const running = runs.get(runId)
      if (running === undefined) throw new Error(`missing run promise for ${runId}`)
      return running
    },
    cancel: (runId, reason) => controls(runId).cancel(runId, reason),
    // Event-driven: the child is attached once its task-attached event is journaled, which is what
    // makes the node addressable by the control verbs.
    attached: (runId, nodeId) => new Promise<void>((resolve) => {
      const scheduler = controls(runId)
      const record = manager.record(runId, parentSessionId)
      if (record.nodes.some((entry) => entry.id === nodeId && entry.taskId !== undefined)) {
        resolve()
        return
      }
      const unsubscribe = scheduler.subscribe((event) => {
        if (event.type !== "dag.node.task-attached" || event.nodeId !== nodeId) return
        unsubscribe()
        resolve()
      })
    }),
    retry(runId) {
      const reentry = controls(runId).retryNode(runId)
      schedulers.set(runId, reentry.scheduler)
      runs.set(runId, reentry.run)
      return reentry
    },
    send: (runId, nodeId, message) => controls(runId).sendToNode(runId, nodeId, message),
  }

  function controls(runId: DagRunId): DagScheduler {
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
}

function categoryNode(id: string, dependsOn: readonly string[] = [], category = "quick"): DagNodeInput {
  return { id, prompt: `do ${id}`, category, ...(dependsOn.length === 0 ? {} : { dependsOn }) }
}

function agentNode(id: string, dependsOn: readonly string[] = [], agent = "explore"): DagNodeInput {
  return { id, prompt: `do ${id}`, subagent_type: agent, ...(dependsOn.length === 0 ? {} : { dependsOn }) }
}

function definition(key: string, nodes: readonly DagNodeInput[]): DagDefinition {
  return { key, name: key.replaceAll("-", " "), nodes }
}

function eventSequence(events: readonly DagRunEvent[]): readonly string[] {
  return events.map((event) => {
    switch (event.type) {
      case "dag.node.transitioned":
        return `${event.type}:${event.nodeId}:${event.from}>${event.to}`
      case "dag.node.task-attached":
        return `${event.type}:${event.nodeId}`
      case "dag.wave.started":
      case "dag.wave.completed":
        return `${event.type}:${event.waveIndex}:[${event.nodeIds.join(",")}]`
      default:
        return event.type
    }
  })
}

function expectedSuccessSequence(waves: readonly (readonly string[])[]): readonly string[] {
  return [
    "dag.run.created",
    "dag.run.started",
    ...waves.flatMap((nodeIds, waveIndex) => [
      ...nodeIds.map((id) => `dag.node.transitioned:${id}:pending>scheduled`),
      `dag.wave.started:${waveIndex}:[${nodeIds.join(",")}]`,
      ...nodeIds.flatMap((id) => [
        `dag.node.task-attached:${id}`,
        `dag.node.transitioned:${id}:scheduled>running`,
      ]),
      ...nodeIds.map((id) => `dag.node.transitioned:${id}:running>completed`),
      `dag.wave.completed:${waveIndex}:[${nodeIds.join(",")}]`,
    ]),
    "dag.run.completed",
  ]
}

// Frontier admission interleaves events the barrier used to serialize: a dependent is admitted as
// soon as ITS dependencies settle, so a staggered run emits several wave.started groupings for one
// wave index and a later wave's completed can precede an earlier wave's. Waves here are
// informational groupings over the compiled graph, never execution barriers.
function expectedFrontierSequence(): readonly string[] {
  return [
    "dag.run.created",
    "dag.run.started",
    "dag.node.transitioned:intake:pending>scheduled",
    "dag.node.transitioned:research:pending>scheduled",
    "dag.wave.started:0:[intake,research]",
    "dag.node.task-attached:intake",
    "dag.node.transitioned:intake:scheduled>running",
    "dag.node.task-attached:research",
    "dag.node.transitioned:research:scheduled>running",
    "dag.node.transitioned:intake:running>completed",
    "dag.node.transitioned:design:pending>scheduled",
    "dag.node.transitioned:budget:pending>scheduled",
    "dag.wave.started:1:[design,budget]",
    "dag.node.task-attached:design",
    "dag.node.transitioned:design:scheduled>running",
    "dag.node.task-attached:budget",
    "dag.node.transitioned:budget:scheduled>running",
    "dag.node.transitioned:research:running>completed",
    "dag.wave.completed:0:[intake,research]",
    "dag.node.transitioned:evidence:pending>scheduled",
    "dag.wave.started:1:[evidence]",
    "dag.node.task-attached:evidence",
    "dag.node.transitioned:evidence:scheduled>running",
    "dag.node.transitioned:design:running>completed",
    "dag.node.transitioned:budget:running>completed",
    "dag.node.transitioned:evidence:running>completed",
    "dag.wave.completed:1:[design,evidence,budget]",
    "dag.node.transitioned:build:pending>scheduled",
    "dag.node.transitioned:docs:pending>scheduled",
    "dag.wave.started:2:[build,docs]",
    "dag.node.task-attached:build",
    "dag.node.transitioned:build:scheduled>running",
    "dag.node.task-attached:docs",
    "dag.node.transitioned:docs:scheduled>running",
    "dag.node.transitioned:build:running>completed",
    "dag.node.transitioned:docs:running>completed",
    "dag.wave.completed:2:[build,docs]",
    "dag.node.transitioned:review:pending>scheduled",
    "dag.wave.started:3:[review]",
    "dag.node.task-attached:review",
    "dag.node.transitioned:review:scheduled>running",
    "dag.node.transitioned:review:running>completed",
    "dag.wave.completed:3:[review]",
    "dag.run.completed",
  ]
}

function assertArtifacts(fixture: E2eFixture, runId: DagRunId, key: string, nodeIds: readonly string[]): void {
  expect(fs.existsSync(fixture.store.paths.run(runId))).toBe(true)
  expect(fs.existsSync(fixture.store.paths.key(parentSessionId, key))).toBe(true)
  expect(fs.existsSync(fixture.store.paths.event(runId))).toBe(true)
  for (const nodeId of nodeIds) {
    const path = fixture.store.paths.result(runId, nodeId)
    expect(fs.existsSync(path)).toBe(true)
    expect(fs.readFileSync(path, "utf8")).toBe(`output:${nodeId}`)
  }
}

function runFiles(store: DagFileStore): readonly string[] {
  return fs.readdirSync(store.paths.runs).filter((entry) => entry.endsWith(".json")).sort()
}

function within<T>(promise: Promise<T>, ms = 200): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

describe("DAG happy-path end to end", () => {
  test("#given a linear three-node definition #when the real engine runs #then every event, output, snapshot, and artifact is wave ordered", async () => {
    // given
    const fixture = e2eFixture()
    const input = definition("linear-three", [
      categoryNode("plan"),
      categoryNode("build", ["plan"]),
      agentNode("review", ["build"], "momus"),
    ])

    // when
    const started = await fixture.start(input)
    const result = await fixture.wait(started.snapshot.runId)
    await fixture.running(started.snapshot.runId)

    // then
    expect(eventSequence(fixture.events(result.runId))).toEqual(expectedSuccessSequence([
      ["plan"],
      ["build"],
      ["review"],
    ]))
    expect(result.status).toBe("completed")
    expect(result.snapshot.counts).toEqual(expect.objectContaining({ total: 3, completed: 3 }))
    expect(Object.fromEntries(Object.entries(result.nodes).map(([id, node]) => [id, node.state === "completed" ? node.output : ""]))).toEqual({
      plan: "output:plan",
      build: "output:build",
      review: "output:review",
    })
    assertArtifacts(fixture, result.runId, input.key, ["plan", "build", "review"])
  })

  test("#given a diamond fan-out and join #when the real engine runs #then the middle nodes share one admission pass", async () => {
    // given
    const fixture = e2eFixture()
    const input = definition("diamond", [
      categoryNode("root"),
      agentNode("left", ["root"]),
      categoryNode("right", ["root"], "deep"),
      agentNode("join", ["left", "right"], "momus"),
    ])

    // when
    const started = await fixture.start(input)
    const result = await fixture.wait(started.snapshot.runId)

    // then
    expect(result.snapshot.waves.map((wave) => wave.nodeIds.map(String))).toEqual([
      ["root"],
      ["left", "right"],
      ["join"],
    ])
    expect(eventSequence(fixture.events(result.runId))).toEqual(expectedSuccessSequence([
      ["root"],
      ["left", "right"],
      ["join"],
    ]))
    assertArtifacts(fixture, result.runId, input.key, ["root", "left", "right", "join"])
  })

  test("#given eight mixed-route nodes across four waves #when the real engine runs #then routes, membership, events, and outputs stay intact", async () => {
    // given
    const fixture = e2eFixture()
    const input = definition("mixed-eight", [
      categoryNode("intake", [], "quick"),
      agentNode("research", [], "explore"),
      categoryNode("design", ["intake"], "visual-engineering"),
      agentNode("evidence", ["research"], "librarian"),
      categoryNode("budget", ["intake"], "deep"),
      agentNode("build", ["design", "evidence"], "hephaestus"),
      categoryNode("docs", ["evidence", "budget"], "writing"),
      agentNode("review", ["build", "docs"], "momus"),
    ])
    const waves = [
      ["intake", "research"],
      ["design", "evidence", "budget"],
      ["build", "docs"],
      ["review"],
    ]

    // when
    const started = await fixture.start(input)
    const result = await fixture.wait(started.snapshot.runId)

    // then
    expect(result.snapshot.waves.map((wave) => wave.nodeIds.map(String))).toEqual(waves)
    expect(eventSequence(fixture.events(result.runId))).toEqual(expectedFrontierSequence())
    expect(result.snapshot.nodes.map((node) => ({ id: String(node.id), route: node.route }))).toEqual([
      { id: "intake", route: { kind: "category", category: "quick" } },
      { id: "research", route: { kind: "agent", agent: "explore" } },
      { id: "design", route: { kind: "category", category: "visual-engineering" } },
      { id: "evidence", route: { kind: "agent", agent: "librarian" } },
      { id: "budget", route: { kind: "category", category: "deep" } },
      { id: "build", route: { kind: "agent", agent: "hephaestus" } },
      { id: "docs", route: { kind: "category", category: "writing" } },
      { id: "review", route: { kind: "agent", agent: "momus" } },
    ])
    // Launch order follows the frontier, not declaration: budget starts as soon as intake
    // settles, ahead of evidence whose dependency research folded one settlement later.
    expect(fixture.runner.startedSpecs.map((spec) => [spec.prompt.replace(/^do /, ""), spec.model, spec.agentType])).toEqual([
      ["intake", "scripted/quick", undefined],
      ["research", "scripted/explore", "explore"],
      ["design", "scripted/visual-engineering", undefined],
      ["budget", "scripted/deep", undefined],
      ["evidence", "scripted/librarian", "librarian"],
      ["build", "scripted/hephaestus", "hephaestus"],
      ["docs", "scripted/writing", undefined],
      ["review", "scripted/momus", "momus"],
    ])
    expect(Object.values(result.nodes).every((node) => node.state === "completed" && node.output.startsWith("output:"))).toBe(true)
    assertArtifacts(fixture, result.runId, input.key, input.nodes.map((node) => node.id))
  })

  test("#given a completed run key #when the identical definition starts again #then the same run is reused without a second run file or event", async () => {
    // given
    const fixture = e2eFixture()
    const input = definition("restart-once", [categoryNode("only")])
    const first = await fixture.start(input)
    await fixture.wait(first.snapshot.runId)
    const beforeFiles = runFiles(fixture.store)
    const beforeEvents = eventSequence(fixture.events(first.snapshot.runId))

    // when
    const second = await fixture.start(input)

    // then
    expect(first.reused).toBe(false)
    expect(beforeEvents).toEqual(expectedSuccessSequence([["only"]]))
    expect(second.reused).toBe(true)
    expect(second.snapshot.runId).toBe(first.snapshot.runId)
    expect(second.snapshot.status).toBe("completed")
    expect(runFiles(fixture.store)).toEqual(beforeFiles)
    expect(runFiles(fixture.store)).toHaveLength(1)
    expect(eventSequence(fixture.events(second.snapshot.runId))).toEqual(beforeEvents)
    expect(fixture.runner.startedSpecs).toHaveLength(1)
    assertArtifacts(fixture, second.snapshot.runId, input.key, ["only"])
  })

  test("#given the shipped SDK builder #when define, node, start, and wait call the real engine #then wait returns a terminal DagRunResult with node outputs", async () => {
    // given
    const fixture = e2eFixture()
    Reflect.set(globalThis, "tool", {
      dag: async (args: { readonly action: string; readonly definition?: DagDefinition; readonly run_id?: string }) => {
        if (args.action === "start" && args.definition !== undefined) {
          const started = await fixture.start(args.definition)
          return { details: { kind: "started", run_id: started.snapshot.runId, reused: started.reused, snapshot: started.snapshot } }
        }
        if (args.action === "wait" && args.run_id !== undefined) {
          const result = await fixture.wait(args.run_id as DagRunId)
          return { details: { kind: "waited", run_id: args.run_id, result } }
        }
        throw new Error(`unexpected SDK action ${args.action}`)
      },
    })
    const sdk = await import(sdkPath) as {
      readonly define: (input: { readonly key: string; readonly name: string }) => {
        node(input: DagNodeInput): ReturnType<typeof sdk.define>
        start(): Promise<{ readonly details: { readonly run_id: DagRunId } }>
      }
      readonly wait: (runId: string) => Promise<{ readonly details: { readonly result: DagRunResult } }>
    }
    const flow = sdk
      .define({ key: "sdk-flow", name: "sdk flow" })
      .node(categoryNode("spec"))
      .node(agentNode("implement", ["spec"], "hephaestus"))
      .node(categoryNode("verify", ["implement"], "deep"))

    // when
    const started = await flow.start()
    const waited = await sdk.wait(started.details.run_id)

    // then
    expect(waited.details.result.status).toBe("completed")
    expect(waited.details.result.nodes).toEqual({
      spec: expect.objectContaining({ state: "completed", output: "output:spec" }),
      implement: expect.objectContaining({ state: "completed", output: "output:implement" }),
      verify: expect.objectContaining({ state: "completed", output: "output:verify" }),
    })
    expect(eventSequence(fixture.events(started.details.run_id))).toEqual(expectedSuccessSequence([
      ["spec"],
      ["implement"],
      ["verify"],
    ]))
    assertArtifacts(fixture, started.details.run_id, "sdk-flow", ["spec", "implement", "verify"])
  })

  test("#given all first-wave starts hit the resident child cap #when the shipped SDK waits #then it returns the terminal residency failures instead of hanging", async () => {
    // given
    const fixture = e2eFixture({
      admit: () => Promise.resolve({ kind: "rejected", message: "resident child cap reached" }),
    })
    Reflect.set(globalThis, "tool", {
      dag: async (args: { readonly action: string; readonly definition?: DagDefinition; readonly run_id?: string }) => {
        if (args.action === "start" && args.definition !== undefined) {
          const started = await fixture.start(args.definition)
          return { details: { kind: "started", run_id: started.snapshot.runId, reused: started.reused, snapshot: started.snapshot } }
        }
        if (args.action === "wait" && args.run_id !== undefined) {
          const result = await fixture.wait(args.run_id as DagRunId)
          return { details: { kind: "waited", run_id: args.run_id, result } }
        }
        throw new Error(`unexpected SDK action ${args.action}`)
      },
    })
    const sdk = await import(`${sdkPath}?residency-denied`) as {
      readonly start: (definition: DagDefinition) => Promise<{ readonly run_id: DagRunId }>
      readonly wait: (runId: string) => Promise<{ readonly details: { readonly result: DagRunResult } }>
    }
    const input = definition("sdk-residency-denied", [
      categoryNode("first"),
      agentNode("second"),
    ])

    // when
    const started = await sdk.start(input)
    const waited = await within(sdk.wait(started.run_id))

    // then
    expect(waited.details.result.status).toBe("failed")
    expect(Object.fromEntries(
      Object.entries(waited.details.result.nodes).map(([id, result]) => [
        id,
        result.state === "failed" ? result.error.code : result.state,
      ]),
    )).toEqual({
      first: "residency_denied",
      second: "residency_denied",
    })
    expect(fixture.events(started.run_id).at(-1)?.type).toBe("dag.run.failed")
  })
})

describe("DAG node control end to end", () => {
  test("#given a running node #when a message is sent #then the live child receives it and the node keeps running to completion", async () => {
    // given
    const runner = new HeldRunner()
    const fixture = e2eFixture({ runner })
    const started = await fixture.start(definition("steer-running", [categoryNode("worker")]))
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    await fixture.attached(runId, "worker" as DagNodeId)

    // when
    const sent = await fixture.send(runId, "worker" as DagNodeId, "prefer the smaller diff")

    // then
    expect(sent.delivery).toBe("steer")
    expect(runner.child("worker").steered).toEqual(["prefer the smaller diff"])
    expect(fixture.manager.record(runId, parentSessionId).nodes[0]?.state).toBe("running")
    expect(fixture.events(runId)).toContainEqual(expect.objectContaining({
      type: "dag.node.steered",
      nodeId: "worker",
      delivery: "steer",
    }))

    // and the steered child still settles the node normally
    runner.child("worker").settle({ status: "completed", finalResponse: "output:worker" })
    const result = await fixture.wait(runId)
    expect(result.status).toBe("completed")
    expect(result.nodes.worker).toMatchObject({ state: "completed", output: "output:worker" })
  })

  test("#given a settled run #when retry is followed immediately by wait #then wait blocks until the NEW settle", async () => {
    // given
    const runner = new HeldRunner()
    const fixture = e2eFixture({ runner })
    const started = await fixture.start(definition("wait-rearm", [categoryNode("first"), categoryNode("second", ["first"])]))
    const runId = started.snapshot.runId
    await runner.whenStarted(1)
    await fixture.cancel(runId, "operator stop")
    const cancelled = await fixture.wait(runId)

    // when - no await between retry and wait: the synchronous dag.run.resumed must already be durable
    const reentry = fixture.retry(runId)
    const rearmed = fixture.wait(runId)
    let settledEarly = false
    void rearmed.then(() => {
      settledEarly = true
    })
    await runner.whenStarted(2)
    const beforeNewSettle = settledEarly

    // then
    runner.child("first").settle({ status: "completed", finalResponse: "output:first" })
    await runner.whenStarted(3)
    runner.child("second").settle({ status: "completed", finalResponse: "output:second" })
    await reentry.run
    const result = await rearmed
    expect(cancelled.status).toBe("cancelled")
    expect(beforeNewSettle).toBe(false)
    expect(result.status).toBe("completed")
    expect(result.nodes.first).toMatchObject({ state: "completed", output: "output:first" })
    expect(result.nodes.second).toMatchObject({ state: "completed", output: "output:second" })
  })
})
