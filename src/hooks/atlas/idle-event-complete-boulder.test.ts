import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"

const { createAtlasHook } = await import("./index")

describe("atlas hook idle-event complete boulder", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-complete-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  it("marks work completed with ended_at and elapsed_ms when progress is complete", async () => {
    // given
    const sessionID = "ses_complete"
    const planPath = join(testDirectory, "complete-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Done\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-complete",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00.000Z",
      session_ids: [sessionID],
      plan_name: "complete-plan",
      works: {
        "work-complete": {
          work_id: "work-complete",
          active_plan: planPath,
          plan_name: "complete-plan",
          started_at: "2026-01-02T10:00:00.000Z",
          session_ids: [sessionID],
          status: "active",
        },
      },
    })

    const hook = createAtlasHook(testCoerce<Parameters<typeof createAtlasHook>[0]>({
      directory: testDirectory,
      client: {
        session: {
          get: async () => ({ data: { id: sessionID } }),
          messages: async () => ({ data: [] }),
          prompt: async () => ({ data: {} }),
          promptAsync: async () => ({ data: {} }),
        },
      },
    }))

    // when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then
    const work = readBoulderState(testDirectory)?.works?.["work-complete"]
    expect(work?.status).toBe("completed")
    expect(work?.ended_at).toBeString()
    expect((work?.elapsed_ms ?? 0) > 0).toBe(true)
  })
})
