// allow: SIZE_OK - one end-to-end fixture proves the assembled manager, scheduler, task manager, wait surface, SDK, and durable store agree across all happy-path graph shapes.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskManager } from "../manager/manager"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec } from "../manager/types"
import { createTaskRecordStore } from "../store"
import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagWaitSurface, type DagRunResult } from "./handle"
import { createDagManager, type DagManager, type DagRunRecordV1, type DagStartResult } from "./manager"
import { createDagScheduler, type DagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunEvent, DagRunId } from "./types"

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
}

function e2eFixture(): E2eFixture {
  const project = tempProject()
  const store = createDagFileStore({ project_dir: project })
  const taskStore = createTaskRecordStore({ project_dir: project })
  const runner = new ScriptedRunner()
  const taskManager = createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: runner },
    planner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
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

  test("#given a diamond fan-out and join #when the real engine runs #then the middle nodes share one strict wave", async () => {
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
    expect(eventSequence(fixture.events(result.runId))).toEqual(expectedSuccessSequence(waves))
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
    expect(fixture.runner.startedSpecs.map((spec) => [spec.prompt.replace(/^do /, ""), spec.model, spec.agentType])).toEqual([
      ["intake", "scripted/quick", undefined],
      ["research", "scripted/explore", "explore"],
      ["design", "scripted/visual-engineering", undefined],
      ["evidence", "scripted/librarian", "librarian"],
      ["budget", "scripted/deep", undefined],
      ["build", "scripted/hephaestus", "hephaestus"],
      ["docs", "scripted/writing", undefined],
      ["review", "scripted/momus", "momus"],
    ])
    expect(Object.values(result.nodes).every((node) => node.state === "completed" && node.output.startsWith("output:"))).toBe(true)
    assertArtifacts(fixture, result.runId, input.key, input.nodes.map((node) => node.id))
  }, process.platform === "win32" ? 15_000 : 5_000)

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
})
