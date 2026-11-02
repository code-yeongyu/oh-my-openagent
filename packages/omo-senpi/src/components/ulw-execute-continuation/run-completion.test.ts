import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { dispatchRunEnd, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createUlwExecuteContinuationComponent } from "./index"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type WorkStatus = "active" | "paused" | "completed" | "abandoned"

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-ulw-execute-run-"))
  roots.push(root)
  mkdirSync(join(root, ".omo", "plans"), { recursive: true })
  writeFileSync(join(root, ".omo", "plans", "t.md"), "## TODOs\n- [x] 1. One\n")
  return root
}

function writeWork(root: string, status: WorkStatus, owner = "senpi:qa-s1"): void {
  writeFileSync(
    join(root, ".omo", "boulder.json"),
    JSON.stringify({
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/t.md",
          plan_name: "t",
          session_ids: [owner],
          status,
          started_at: "2026-10-24T00:00:00Z",
        },
      },
    }),
  )
}

const ctxFor = (root: string) => ({ cwd: root, sessionManager: { getSessionId: () => "qa-s1" } })
const stopped = { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }

async function setup(): Promise<{ pi: FakeExtensionAPI; completed: string[] }> {
  const pi = new FakeExtensionAPI()
  const completed: string[] = []
  pi.lifecycle = { markRunCompleted: (run) => completed.push(run.runId) }
  await createUlwExecuteContinuationComponent().register(pi, {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { getFlag: () => false },
    idleCoordinator: new IdleInjectionCoordinator(() => {}),
  })
  return { pi, completed }
}

describe("omo-senpi ulw-execute-continuation run completion (#10782)", () => {
  it("#given this session's work was active #when a run ends with it completed #then the run is marked completed once", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "active")
    await pi.dispatch("input", { type: "input", text: "go", source: "user" }, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual(["ulw-execute:w1"])
  })

  it("#given a paused work #when a later run ends with it completed #then it is marked completed", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "paused")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual(["ulw-execute:w1"])
  })

  it("#given a completed work #when it is observed twice more #then there is still one record", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "active")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))
    await pi.dispatch("input", { type: "input", text: "thanks", source: "user" }, ctxFor(root))
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual(["ulw-execute:w1"])
  })

  it("#given a work this session first sees already completed #when runs end #then the inherited completion is not marked", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "completed")

    await pi.dispatch("input", { type: "input", text: "hi", source: "user" }, ctxFor(root))
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual([])
  })

  it("#given no work when the session started #when a run creates and completes one #then it is marked completed", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    await pi.dispatch("input", { type: "input", text: "execute the plan", source: "user" }, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual(["ulw-execute:w1"])
  })

  it("#given an active work #when it ends abandoned #then nothing is marked", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "active")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "abandoned")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual([])
  })

  it("#given another session's work #when it goes from active to completed #then nothing is marked", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeWork(root, "active", "senpi:other-session")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "completed", "senpi:other-session")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual([])
  })

  it("#given an unreadable boulder.json at the first look #when a later run finds the work completed #then it is not marked", async () => {
    const root = workspace()
    const { pi, completed } = await setup()
    writeFileSync(join(root, ".omo", "boulder.json"), "{ not json")
    await pi.dispatch("input", { type: "input", text: "hi", source: "user" }, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(completed).toEqual([])
  })

  it("#given a host whose lifecycle port throws #when the work completes #then the run still settles and the failure is logged", async () => {
    const root = workspace()
    const warnings: string[] = []
    const pi = new FakeExtensionAPI()
    pi.lifecycle = {
      markRunCompleted: () => {
        throw new Error("stale generation")
      },
    }
    await createUlwExecuteContinuationComponent().register(pi, {
      logger: { info: () => {}, warn: (message: string) => warnings.push(message), error: () => {} },
      config: { getFlag: () => false },
      idleCoordinator: new IdleInjectionCoordinator(() => {}),
    })
    writeWork(root, "active")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "completed")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    expect(warnings).toContain("omo-senpi ulw-execute run completion not recorded")
  })

  it("#given a host without the lifecycle port #when the work completes #then the run ends without error", async () => {
    const root = workspace()
    const { pi } = await setup()
    pi.lifecycle = undefined
    writeWork(root, "active")
    await dispatchRunEnd(pi, stopped, ctxFor(root))

    writeWork(root, "completed")
    await expect(dispatchRunEnd(pi, stopped, ctxFor(root))).resolves.toBeDefined()
  })
})
