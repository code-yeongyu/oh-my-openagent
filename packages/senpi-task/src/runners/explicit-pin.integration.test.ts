import { afterEach, describe, expect, test } from "bun:test"

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { AgentSession } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskChildPlanner } from "../../../omo-senpi/src/components/task/planner"
import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { createTaskManager, type TaskManager } from "../manager"
import { createParentRegistrySessionContext } from "../manager/parent-registry-context"
import { createInProcessManagedRunner } from "../manager/runner"
import { readSettingsDefaultRoute } from "../senpi/explicit-pin"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { InProcessRunner } from "./in-process"
import { createBuiltinChildMachine, type BuiltinChildMachine } from "./in-process/__fixtures__/builtin-child"

// #9722. An explicit task model pin - suffixed with a thinking level or not - is honoured or the
// spawn fails loudly, never a silent ride on the child's settings default. The child runs through
// the REAL manager and in-process runner against a fake provider whose isolated settings default
// is a different model, so a substituted route is visible in the child's session log, the task
// record's effective_model, and the started result.
//
// omo-senpi is imported by SOURCE path (senpi-task holds no dependency on the adapter): the
// planner owns the explicit-pin parse, and this test drives the same composition the engine wires.

const PROVIDER = "runtime-fallback-test"

const machines: BuiltinChildMachine[] = []
const sessions: AgentSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  for (const machine of machines.splice(0)) machine.cleanup()
})

async function world(defaultModelId: string): Promise<BuiltinChildMachine> {
  const machine = await createBuiltinChildMachine()
  machines.push(machine)
  writeFileSync(
    join(machine.agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: PROVIDER, defaultModel: defaultModelId }, null, 2)}\n`,
  )
  return machine
}

type Engine = {
  readonly manager: TaskManager
  readonly store: TaskRecordStore
}

// The engine's own wiring, narrowed to the pin path: the real planner over the fixture registry,
// the real parent-registry context (with the fixture's agent dir threaded so the child reads the
// isolated settings), and the real in-process runner and record store.
function makeEngine(machine: BuiltinChildMachine): Engine {
  const stateDir = join(machine.agentDir, "task-state")
  const store = createTaskRecordStore({ project_dir: machine.cwd, task: { state_dir: stateDir } })
  const provide = createParentRegistrySessionContext(() => machine.modelRegistry)
  const inProcess = createInProcessManagedRunner(
    new InProcessRunner({
      createSession: async (options) => {
        const { session } = await (await loadSenpiBarrel()).createAgentSession(options)
        sessions.push(session)
        await session.bindExtensions({ mode: "print" })
        return session
      },
    }),
    (spec) => ({ ...provide(spec), agentDir: machine.agentDir }),
  )
  const planner = createTaskChildPlanner(
    {},
    {},
    () => machine.modelRegistry,
    () => undefined,
    () => readSettingsDefaultRoute({ cwd: machine.cwd, agentDir: machine.agentDir }),
  )
  const manager = createTaskManager({
    store,
    runners: {
      "in-process": inProcess,
      process: { start: () => Promise.reject(new Error("no process runner in this test")) },
    },
    planner,
    config: OmoTaskSettingsSchema.parse({
      global_concurrency: 0,
      default_concurrency: 5,
      max_depth: 1,
      state_dir: stateDir,
    }),
    cwd: machine.cwd,
  })
  return { manager, store }
}

function startPin(engine: Engine, pin: string) {
  return engine.manager.start({
    prompt: "reply with done",
    parent_session_id: "parent-9722",
    depth: 1,
    model: pin,
  })
}

function isEntryOfType(entry: unknown, entryType: string): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && "type" in entry && entry.type === entryType
}

function firstSessionEntry(engine: Engine, taskId: string, entryType: string): Record<string, unknown> {
  const root = join(engine.store.stateDir, "children", taskId)
  if (!existsSync(root)) throw new Error(`no child session dir at ${root}`)
  const jsonl: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.name.endsWith(".jsonl")) jsonl.push(path)
    }
  }
  walk(root, 0)
  for (const path of jsonl.sort()) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.trim() === "") continue
      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (isEntryOfType(entry, entryType)) return entry
    }
  }
  throw new Error(`no ${entryType} entry under ${root}`)
}

const TEXT_INPUT: Array<"text"> = ["text"]

function registerLateModel(machine: BuiltinChildMachine, id: string): void {
  const provider = machine.modelRegistry.getRegisteredProviderConfig(PROVIDER)
  if (provider === undefined) throw new Error("fixture provider is not registered")
  machine.modelRegistry.registerProvider(PROVIDER, {
    ...provider,
    models: [
      ...(provider.models ?? []),
      {
        id,
        name: id,
        reasoning: true,
        input: TEXT_INPUT,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 4096,
      },
    ],
    streamSimple: provider.streamSimple,
  })
}

describe("explicit task model pins are honoured or fail loudly (#9722)", () => {
  test("1(a)+(d) #given a settings default of child-fails #when spawned with child-succeeds:medium #then the child runs the pin at medium and the RECORD names the child's model", async () => {
    // given: the isolated agent dir defaults to model B; the pin asks for model A at medium
    const machine = await world("child-fails")
    const engine = makeEngine(machine)

    // when
    const started = await startPin(engine, `${PROVIDER}/child-succeeds:medium`)

    // then: the spawn started on the pin at the pinned level
    if (started.kind !== "started") throw new Error(`pin did not start: ${started.kind}`)
    await engine.manager.waitFor(started.task_id)
    const change = firstSessionEntry(engine, started.task_id, "model_change")
    expect(change.provider).toBe(PROVIDER)
    expect(change.modelId).toBe("child-succeeds")
    expect(change.originalModelId).toBeUndefined()
    expect(firstSessionEntry(engine, started.task_id, "thinking_level_change").thinkingLevel).toBe("medium")

    // and (d): the record and the started result name the model the CHILD actually ran - which is
    // the pin, because the pin was honoured - not a copy of the requested string
    const record = engine.store.load(started.task_id)
    expect(record?.model).toBe(`${PROVIDER}/child-succeeds`)
    expect(record?.effective_model).toMatchObject({ provider: PROVIDER, model_id: "child-succeeds" })
    expect(`${record?.effective_model?.provider}/${record?.effective_model?.model_id}`).toBe(
      `${String(change.provider)}/${String(change.modelId)}`,
    )
    expect(started.effective_model).toMatchObject({ provider: PROVIDER, model_id: "child-succeeds" })
  }, 30_000)

  test("1(b) #given an unhonourable pin #when spawned #then the spawn fails typed naming the pin and the default route, and no child ever starts", async () => {
    // given
    const machine = await world("child-fails")
    const engine = makeEngine(machine)

    // when
    const started = await startPin(engine, `${PROVIDER}/child-missing`)

    // then: a typed refusal that names both the pin and the route the child would have ridden
    if (started.kind === "started") throw new Error("the unhonourable pin started a child")
    expect(started.kind).toBe("plan_unresolved")
    if (started.kind === "plan_unresolved") {
      expect(started.error.code).toBe("model_unavailable")
      expect(started.error.message).toContain(`${PROVIDER}/child-missing`)
      expect(started.error.message).toContain(`${PROVIDER}/child-fails`)
    }
    // and: no record, no child session, no turn
    expect(engine.store.list().records).toEqual([])
    expect(sessions).toEqual([])
  }, 30_000)

  test("#given a pin carrying a service tier #when spawned #then it is a typed invalid_target, never a silently dropped tier", async () => {
    // given
    const machine = await world("child-fails")
    const engine = makeEngine(machine)

    // when
    const started = await startPin(engine, `${PROVIDER}/child-succeeds:priority`)

    // then
    if (started.kind === "started") throw new Error("a tiered pin started a child")
    expect(started.kind).toBe("plan_unresolved")
    if (started.kind === "plan_unresolved") {
      expect(started.error.code).toBe("invalid_target")
      expect(started.error.message).toContain("priority")
    }
    expect(engine.store.list().records).toEqual([])
  }, 30_000)

  test("1(c) #given a pin to a model registered late on the SAME provider #then the late child runs on it, and an absent one still fails typed", async () => {
    // given: child-late is absent while the spawn is planned
    const machine = await world("child-fails")
    const engine = makeEngine(machine)
    const early = await startPin(engine, `${PROVIDER}/child-late`)
    if (early.kind === "started") throw new Error("an absent model started a child")
    expect(early.kind).toBe("plan_unresolved")

    // when: the model arrives on the pinned provider itself, after that refusal
    registerLateModel(machine, "child-late")
    const started = await startPin(engine, `${PROVIDER}/child-late`)

    // then: the same pin now resolves against the live registry, and the child runs on IT
    if (started.kind !== "started") throw new Error("the late model did not start after registration")
    await engine.manager.waitFor(started.task_id)
    const record = engine.store.load(started.task_id)
    expect(record?.effective_model).toMatchObject({ provider: PROVIDER, model_id: "child-late" })
    const change = firstSessionEntry(engine, started.task_id, "model_change")
    expect(change.modelId).toBe("child-late")

    // and: a pin to a model that never arrives still fails typed - never the settings default
    const never = await startPin(engine, `${PROVIDER}/child-never`)
    expect(never.kind).toBe("plan_unresolved")
    expect(engine.store.list().records.map((record) => record.task_id)).toEqual([started.task_id])
  }, 30_000)
})
