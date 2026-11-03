import { describe, expect, it } from "bun:test"

import { dispatchRunEnd, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "./index"
import { createLogger, sessionEventCtx } from "./ulw-loop.test-support"

const PLAN_A = "2026-10-24T01:00:00.000Z"
const PLAN_B = "2026-10-24T02:00:00.000Z"
const stopped = { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }

function status(createdAt: string, shape: "active" | "aggregate-complete" | "goals-done"): string {
  const done = shape !== "active"
  return JSON.stringify({
    ok: true,
    plan: {
      createdAt,
      ...(shape === "aggregate-complete" ? { aggregateCompletion: { status: "complete" } } : {}),
      goals: [
        {
          id: "G001",
          status: done ? "complete" : "in_progress",
          successCriteria: [{ id: "C001", status: done ? "pass" : "pending" }],
        },
      ],
    },
  })
}

const PLAN_MISSING = { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "ULW_LOOP_PLAN_MISSING" } }) }

async function setup(outputs: ReadonlyArray<string | { code: number; stdout: string }>): Promise<{
  pi: FakeExtensionAPI
  completed: string[]
}> {
  const queue = [...outputs]
  const pi = new FakeExtensionAPI()
  const completed: string[] = []
  pi.lifecycle = { markRunCompleted: (run) => completed.push(run.runId) }
  await createUlwLoopComponent({
    readStatus: async () => {
      const next = queue.shift()
      if (next === undefined) throw new Error("no status left for this read")
      return typeof next === "string" ? { code: 0, stdout: next } : next
    },
    planExists: () => true,
  }).register(pi, { logger: createLogger(), config: { getFlag: () => false } })
  return { pi, completed }
}

describe("omo-senpi ulw-loop run completion (#10782)", () => {
  it("#given an active plan #when a run ends with its aggregate complete #then the run is marked completed once", async () => {
    const { pi, completed } = await setup([status(PLAN_A, "active"), status(PLAN_A, "aggregate-complete")])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(completed).toEqual([`ulw-loop:${PLAN_A}`])
  })

  it("#given a completed plan #when it is read twice more #then there is still one record", async () => {
    const { pi, completed } = await setup([
      status(PLAN_A, "active"),
      status(PLAN_A, "aggregate-complete"),
      status(PLAN_A, "aggregate-complete"),
      status(PLAN_A, "aggregate-complete"),
    ])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))
    await pi.dispatch("tool_result", { toolName: "update_goal" }, sessionEventCtx("/repo"))

    expect(completed).toEqual([`ulw-loop:${PLAN_A}`])
  })

  it("#given a plan this session first reads already complete #when runs end #then the inherited completion is not marked", async () => {
    const { pi, completed } = await setup([status(PLAN_A, "aggregate-complete"), status(PLAN_A, "aggregate-complete")])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(completed).toEqual([])
  })

  it("#given no plan when the session started #when a run creates and completes one #then it is marked completed", async () => {
    const { pi, completed } = await setup([PLAN_MISSING, status(PLAN_A, "aggregate-complete")])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(completed).toEqual([`ulw-loop:${PLAN_A}`])
  })

  it("#given a first status read that fails #when a later read shows an already-complete plan #then the inherited completion is not marked", async () => {
    for (const failedRead of [
      { code: 2, stdout: JSON.stringify({ ok: false, error: { code: "ULW_LOOP_LOCKED" } }) },
      { code: 0, stdout: "not json" },
    ]) {
      const { pi, completed } = await setup([failedRead, status(PLAN_A, "aggregate-complete")])
      await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

      await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

      expect(completed).toEqual([])
    }
  })

  it("#given a host whose lifecycle port throws #when the plan completes #then the run still settles and the failure is logged", async () => {
    const logger = createLogger()
    const queue = [status(PLAN_A, "active"), status(PLAN_A, "aggregate-complete")]
    const pi = new FakeExtensionAPI()
    pi.lifecycle = {
      markRunCompleted: () => {
        throw new Error("stale generation")
      },
    }
    await createUlwLoopComponent({
      readStatus: async () => ({ code: 0, stdout: queue.shift() ?? status(PLAN_A, "aggregate-complete") }),
      planExists: () => true,
    }).register(pi, { logger, config: { getFlag: () => false } })
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(logger.entries.map((entry) => entry.message)).toContain("omo-senpi ulw-loop run completion not recorded")
  })

  it("#given an active plan #when every goal is done but the aggregate is not complete #then nothing is marked", async () => {
    const { pi, completed } = await setup([status(PLAN_A, "active"), status(PLAN_A, "goals-done")])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(completed).toEqual([])
  })

  it("#given a completed plan replaced by a new one #when the new plan completes #then each plan is marked once", async () => {
    const { pi, completed } = await setup([
      status(PLAN_A, "active"),
      status(PLAN_A, "aggregate-complete"),
      status(PLAN_B, "active"),
      status(PLAN_B, "aggregate-complete"),
    ])
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    await pi.dispatch("tool_result", { toolName: "update_goal" }, sessionEventCtx("/repo"))
    await dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))

    expect(completed).toEqual([`ulw-loop:${PLAN_A}`, `ulw-loop:${PLAN_B}`])
  })

  it("#given a host that cannot prove the session #when a plan would complete #then nothing is read or marked", async () => {
    const { pi, completed } = await setup([status(PLAN_A, "active"), status(PLAN_A, "aggregate-complete")])
    const unscoped = { cwd: "/repo" }
    await pi.dispatch("session_start", { type: "session_start" }, unscoped)

    await dispatchRunEnd(pi, stopped, unscoped)

    expect(completed).toEqual([])
  })

  it("#given a host without the lifecycle port #when the plan completes #then the run ends without error", async () => {
    const { pi } = await setup([status(PLAN_A, "active"), status(PLAN_A, "aggregate-complete")])
    pi.lifecycle = undefined
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))

    await expect(dispatchRunEnd(pi, stopped, sessionEventCtx("/repo"))).resolves.toBeDefined()
  })
})
