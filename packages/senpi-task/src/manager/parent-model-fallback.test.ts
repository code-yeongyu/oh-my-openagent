import { afterEach, describe, expect, test } from "bun:test"

import { readFileSync } from "node:fs"

import { DEFAULT_CATEGORIES } from "../category"
import { createTaskRecordStore } from "../store"
import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { createTaskManager } from "./manager"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"
import { baseSpec, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { observeParentModelFallback } from "./parent-model-fallback"
import { ALT, CLAUDE, COUNT_TOOL, createParentModelWorld, GPT, type ParentModelWorld, type Step } from "./__fixtures__/parent-model-world"

const PRIMARY = `${CLAUDE}/primary`
const PARENT = `${GPT}/parent`

const rung = (provider: string, id: string): ResolvedModelRecord => ({ source: "category", provider, model_id: id, display: `${provider}/${id}` })

const claudeOnly: ResolvedChildPlan = {
  model: PRIMARY,
  category: "unspecified-high",
  requested_model: rung(CLAUDE, "primary"),
  resolved_model: rung(CLAUDE, "primary"),
  fallback_models: [],
}

let world: ParentModelWorld | undefined
afterEach(() => {
  world?.dispose()
  world = undefined
  cleanupProjects()
})

async function runChild(input: {
  readonly scripts: Readonly<Record<string, readonly Step[]>>
  readonly plan?: ResolvedChildPlan
  readonly spec?: Partial<ManagerStartSpec>
}): Promise<{ readonly record: TaskRecord; readonly world: ParentModelWorld; readonly settingsBefore: string }> {
  world = await createParentModelWorld(input.scripts)
  const settingsBefore = readFileSync(world.settingsPath, "utf8")
  const project = tempProject()
  const runner = world.runner()
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: input.plan ?? claudeOnly }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  try {
    const started = await manager.start(baseSpec({ category: "unspecified-high", parent_model: PARENT, ...input.spec }))
    if (started.kind !== "started") throw new Error(`child did not start: ${JSON.stringify(started)}`)
    const record = await manager.waitFor(started.task_id)
    return { record, world, settingsBefore }
  } finally {
    manager.workpools.dispose()
  }
}

describe("a category child whose whole chain is spent runs on its parent's model (#10750)", () => {
  test("#given a Claude-only chain and a parent on GPT #when Claude hits its usage limit before any tool call #then the child completes on GPT and records why, leaving the user's settings untouched", async () => {
    // given / when
    const { record, world, settingsBefore } = await runChild({ scripts: { [PRIMARY]: ["quota"] } })

    // then
    expect(record.status).toBe("completed")
    expect(record.final_response).toBe(`${PARENT} completed`)
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, PARENT])
    expect(record.parent_model).toBe(PARENT)
    expect(record.parent_model_fallback).toMatchObject({ from_model: PRIMARY, reason: "usage_limit", resets: "3:20am" })
    expect(readFileSync(world.settingsPath, "utf8")).toBe(settingsBefore)
  }, 30_000)

  test("#given the child already ran a tool #when Claude hits its usage limit on the next request #then GPT continues the same transcript and the tool ran exactly once", async () => {
    // given / when
    const { record, world } = await runChild({ scripts: { [PRIMARY]: [{ tool: COUNT_TOOL }, "quota"] } })

    // then
    expect(record.status).toBe("completed")
    expect(world.toolRuns()).toBe(1)
    const parentCall = world.calls.find((call) => call.model === PARENT)
    expect(parentCall?.toolResults).toBe(1)
    expect(record.parent_model_fallback?.reason).toBe("usage_limit")
  }, 30_000)

  test("#given Claude was still writing a tool call #when its usage limit cuts the call off #then the call never runs and the record names it as interrupted", async () => {
    // given / when
    const { record, world } = await runChild({ scripts: { [PRIMARY]: [{ partialTool: COUNT_TOOL }] } })

    // then
    expect(record.status).toBe("completed")
    expect(world.toolRuns()).toBe(0)
    expect(record.parent_model_fallback?.interrupted_tools).toEqual([COUNT_TOOL])
  }, 30_000)

  test("#given a Claude-only chain with provider_lock true #when Claude hits its usage limit #then the child never runs on the GPT parent and fails typed with the category and reset (#12006)", async () => {
    // given
    const locked: ResolvedChildPlan = { ...claudeOnly, providerLock: true }

    // when
    const { record, world } = await runChild({ scripts: { [PRIMARY]: ["quota"] }, plan: locked })

    // then
    expect(record.status).toBe("error")
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY])
    expect(record.parent_model).toBeUndefined()
    expect(record.failure_kind).toBe("provider_lock_exhausted")
    expect(record.error_message).toContain("category \"unspecified-high\"")
    expect(record.error_message).toContain("until 3:20am")
  }, 30_000)

  test("#given the shipped deep-high lock and an OpenAI-only chain #when its only vendor hits its usage limit under a Claude parent #then the child fails typed with the reset and never runs on the parent (#12006)", async () => {
    // given
    const astra = rung(GPT, "gpt-6-astra")
    const deepHigh: ResolvedChildPlan = {
      model: astra.display,
      category: "deep-high",
      requested_model: astra,
      resolved_model: astra,
      fallback_models: [],
      providerLock: DEFAULT_CATEGORIES["deep-high"]?.provider_lock,
    }
    const claudeParent = `${CLAUDE}/claude-opus-5-5`

    // when
    const { record, world } = await runChild({
      scripts: { [astra.display]: ["quota"] },
      plan: deepHigh,
      spec: { category: "deep-high", parent_model: claudeParent },
    })

    // then
    expect(record.status).toBe("error")
    expect(world.calls.map((call) => call.model)).toEqual([astra.display])
    expect(record.parent_model).toBeUndefined()
    expect(record.provider_lock).toBe("openai")
    expect(record.failure_kind).toBe("provider_lock_exhausted")
    expect(record.error_message).toContain("category \"deep-high\"")
    expect(record.error_message).toContain("until 3:20am")
  }, 30_000)

  test("#given the parent runs on the same spent account #when Claude hits its usage limit #then the child fails as before and never tries the parent's model", async () => {
    // given / when
    const sibling = `${CLAUDE}/sibling`
    const { record, world } = await runChild({ scripts: { [PRIMARY]: ["quota"] }, spec: { parent_model: sibling } })

    // then
    expect(record.status).toBe("error")
    expect(world.calls.map((call) => call.model)).not.toContain(sibling)
    expect(record.parent_model_fallback).toBeUndefined()
  }, 30_000)

  test("#given a category rung that still works #when Claude hits its usage limit #then the child routes to that rung exactly as before", async () => {
    // given / when
    const { record, world } = await runChild({
      scripts: { [PRIMARY]: ["quota"] },
      plan: { ...claudeOnly, fallback_models: [rung(ALT, "rung")] },
    })

    // then
    expect(record.status).toBe("completed")
    expect(world.calls.map((call) => call.model)).toEqual([PRIMARY, `${ALT}/rung`])
    expect(record.parent_model_fallback).toBeUndefined()
  }, 30_000)

  test("#given senpi labels an account-limit hop as transient #when the child lands on the parent's model #then the record still says usage limit and when it resets", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record: TaskRecord = {
      ...createTaskRecord({
        parent_session_id: "parent-1", root_session_id: "parent-1", depth: 1, execution_mode: "in-process",
        notify_on_terminal: false, model: PRIMARY,
      }),
      parent_model: PARENT,
    }
    store.save(record)
    const { handle } = makeHandle(record.task_id)
    const observe = observeParentModelFallback({ handle, store, taskId: record.task_id, now: () => 0, failedTurns: new WeakMap() })

    // when
    observe({ type: "message_end", message: { role: "assistant", stopReason: "error", content: [], errorMessage: "You've hit your session limit \u00b7 resets 3pm (Asia/Seoul)" } })
    observe(Object.assign({ type: "retry_fallback_applied" }, { from: PRIMARY, to: PARENT, reason: "transient" }))

    // then
    expect(store.load(record.task_id)?.parent_model_fallback).toMatchObject({ reason: "usage_limit", resets: "3pm (Asia/Seoul)" })
  })

  test("#given an agent-routed child #when it spawns #then the parent's model is not added to its chain", async () => {
    // given / when
    const { record } = await runChild({
      scripts: {},
      spec: { category: undefined, subagent_type: "explore" },
    })

    // then
    expect(record.parent_model).toBeUndefined()
    expect(record.fallback_models?.map((model) => model.display) ?? []).not.toContain(PARENT)
  }, 30_000)
})
