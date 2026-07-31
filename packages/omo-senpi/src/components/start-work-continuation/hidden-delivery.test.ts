import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createStartWorkContinuationComponent } from "./index"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function activeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-start-work-hidden-"))
  roots.push(root)
  mkdirSync(join(root, ".omo", "plans"), { recursive: true })
  writeFileSync(join(root, ".omo", "plans", "task.md"), "## TODOs\n- [ ] 1. Task one\n")
  writeFileSync(
    join(root, ".omo", "boulder.json"),
    JSON.stringify({
      schema_version: 2,
      active_work_id: "w1",
      works: {
        w1: {
          work_id: "w1",
          active_plan: ".omo/plans/task.md",
          plan_name: "task",
          session_ids: ["senpi:qa-s1"],
          status: "active",
          started_at: "2026-07-17T00:00:00Z",
          updated_at: "2026-07-17T01:00:00Z",
        },
      },
    }),
  )
  return root
}

function logger(): ComponentContext["logger"] {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

function eventCtx(root: string): unknown {
  return { cwd: root, sessionManager: { getSessionId: () => "qa-s1" } }
}

describe("start-work continuation hidden delivery", () => {
  it("#given active work #when idle agent_end fires #then continuation is a hidden followUp", async () => {
    const root = activeWorkspace()
    const pi = new FakeExtensionAPI()
    await createStartWorkContinuationComponent().register(pi, {
      logger: logger(),
      config: { getFlag: () => false },
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, eventCtx(root))

    expect(pi.userMessages).toEqual([])
    expect(pi.messages).toEqual([
      {
        message: {
          customType: "omo-senpi:start-work-continuation",
          content: expect.stringContaining("Plan file:"),
          display: false,
        },
        options: { triggerTurn: true, deliverAs: "followUp" },
      },
    ])
  })

  it("#given active work #when input is idle versus queued #then only queued text is transformed", async () => {
    const root = activeWorkspace()
    const pi = new FakeExtensionAPI()
    await createStartWorkContinuationComponent().register(pi, {
      logger: logger(),
      config: { getFlag: () => false },
    })

    const idle = await pi.dispatch("input", { type: "input", text: "hello", source: "user" }, eventCtx(root))
    const queued = await pi.dispatch(
      "input",
      { type: "input", text: "hello", source: "user", streamingBehavior: "steer" },
      eventCtx(root),
    )

    expect(idle).toEqual([{ action: "continue" }])
    expect(queued[0]).toMatchObject({ action: "transform" })
  })
})
