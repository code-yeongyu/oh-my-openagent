/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { readBoulderState, clearBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createStartWorkHook } from "./start-work-hook"

describe("start-work hook platform session ids", () => {
  let testDir: string

  function createStartWorkPrompt(): string {
    return `<command-instruction>
You are starting a Sisyphus work session.
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
})
