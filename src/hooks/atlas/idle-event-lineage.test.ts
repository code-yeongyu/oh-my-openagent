import { afterEach, beforeEach, describe, it } from "bun:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import type { BoulderState } from "../../features/boulder-state"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"

const { createAtlasHook } = await import("./index")

describe("atlas hook idle-event session lineage", () => {
  const MAIN_SESSION_ID = "main-session-123"

  let testDirectory = ""
  let promptCalls: Array<unknown> = []

  function writeIncompleteBoulder(): void {
    const planPath = join(testDirectory, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [MAIN_SESSION_ID],
      plan_name: "test-plan",
    }

    writeBoulderState(testDirectory, state)
  }

  function createHook(parentSessionIDs?: Record<string, string | undefined>) {
    return createAtlasHook({
      directory: testDirectory,
      client: {
        session: {
          get: async (input: { path: { id: string } }) => ({
            data: {
              parentID: parentSessionIDs?.[input.path.id],
            },
          }),
          messages: async () => ({ data: [] }),
          prompt: async (input: unknown) => {
            promptCalls.push(input)
            return { data: {} }
          },
          promptAsync: async (input: unknown) => {
            promptCalls.push(input)
            return { data: {} }
          },
        },
      },
    } as unknown as Parameters<typeof createAtlasHook>[0])
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-lineage-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }

    promptCalls = []
    clearBoulderState(testDirectory)
    _resetForTesting()
    subagentSessions.clear()
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }

    _resetForTesting()
  })

  it("does not append unrelated subagent sessions during idle", async () => {
    const unrelatedSubagentSessionID = "subagent-session-unrelated"
    const unrelatedParentSessionID = "unrelated-parent-session"

    writeIncompleteBoulder()
    subagentSessions.add(unrelatedSubagentSessionID)

    const hook = createHook({
      [unrelatedSubagentSessionID]: unrelatedParentSessionID,
    })

    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: unrelatedSubagentSessionID },
      },
    })

    assert.equal(readBoulderState(testDirectory)?.session_ids.includes(unrelatedSubagentSessionID), false)
    assert.equal(promptCalls.length, 0)
  })

  it("appends boulder-owned subagent sessions during idle when lineage reaches tracked session", async () => {
    const subagentSessionID = "subagent-session-456"
    const intermediateParentSessionID = "subagent-parent-789"

    writeIncompleteBoulder()
    subagentSessions.add(subagentSessionID)

    const hook = createHook({
      [subagentSessionID]: intermediateParentSessionID,
      [intermediateParentSessionID]: MAIN_SESSION_ID,
    })

    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    assert.equal(readBoulderState(testDirectory)?.session_ids.includes(subagentSessionID), true)
    assert.equal(promptCalls.length, 1)
  })
})
