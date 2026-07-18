/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { readBoulderState, clearBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createStartWorkHook } from "./start-work-hook"
import { START_WORK_TEMPLATE } from "../../features/builtin-commands/templates/start-work"

describe("start-work hook platform session ids", () => {
  let testDir: string

  function createStartWorkPrompt(): string {
    return `<command-instruction>
You are starting an Atlas work session.
</command-instruction>

<session-context></session-context>`
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-hook-session-prefix-${randomUUID()}`)
    mkdirSync(join(testDir, ".omo", "plans"), { recursive: true })
    clearBoulderState(testDir)
  })

  afterEach(() => {
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("#given raw chat session id #when processing start-work template #then boulder stores opencode-prefixed id", async () => {
    // given
    writeFileSync(join(testDir, ".omo", "plans", "work.md"), "# Work\n- [ ] First task\n")
    const hook = createStartWorkHook(unsafeTestValue<Parameters<typeof createStartWorkHook>[0]>({
      directory: testDir,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }))
    const output = {
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    // when
    await hook["chat.message"]({ sessionID: "raw-sess" }, output)
    const state = readBoulderState(testDir)

    // then
    expect(state?.session_ids).toEqual(["opencode:raw-sess"])
  })

  test("#given raw chat session id #when locating the recent session plan #then the SDK receives the bare ses id (#5285)", async () => {
    // given
    writeFileSync(join(testDir, ".omo", "plans", "work.md"), "# Work\n- [ ] First task\n")
    const sessionMessageIds: string[] = []
    const hook = createStartWorkHook(unsafeTestValue<Parameters<typeof createStartWorkHook>[0]>({
      directory: testDir,
      client: {
        session: {
          messages: async (args: { path: { id: string } }) => {
            sessionMessageIds.push(args.path.id)
            return { data: [] }
          },
        },
      },
    }))
    const output = {
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    // when
    await hook["chat.message"]({ sessionID: "raw-sess" }, output)

    // then
    expect(sessionMessageIds).toContain("raw-sess")
    expect(sessionMessageIds).not.toContain("opencode:raw-sess")
  })
})

describe("start-work template label matches the activated agent (#5499)", () => {
  test("#given /start-work activates Atlas #when reading the shipped template header #then it announces an Atlas work session, not Sisyphus", () => {
    // /start-work activates the atlas agent (see createStartWorkHook), so the
    // shipped template header must not announce a stale 'Sisyphus work session' (#5499).
    expect(START_WORK_TEMPLATE).toContain("You are starting an Atlas work session.")
    expect(START_WORK_TEMPLATE).not.toContain("Sisyphus work session")
  })
})
