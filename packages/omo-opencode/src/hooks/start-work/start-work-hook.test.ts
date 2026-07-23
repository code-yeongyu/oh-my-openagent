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

describe("start-work PR delivery flags", () => {
  let testDir: string

  function createStartWorkPromptWithArgs(args: string): string {
    return `<command-instruction>
You are starting an Atlas work session.
</command-instruction>

<session-context>
Session ID: $SESSION_ID
</session-context>

<user-request>
${args}
</user-request>`
  }

  function createHookForDir(dir: string) {
    return createStartWorkHook(unsafeTestValue<Parameters<typeof createStartWorkHook>[0]>({
      directory: dir,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }))
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-hook-pr-delivery-${randomUUID()}`)
    mkdirSync(join(testDir, ".omo", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".omo", "plans", "work.md"), "# Work\n- [ ] First task\n")
    clearBoulderState(testDir)
  })

  afterEach(() => {
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("#given --make-pr without worktree #when processing #then injected context instructs task-owned worktree and PR delivery", async () => {
    // given
    const hook = createHookForDir(testDir)
    const output = {
      parts: [{ type: "text", text: createStartWorkPromptWithArgs("work --make-pr") }],
    }

    // when
    await hook["chat.message"]({ sessionID: "pr-sess" }, output)
    const injected = output.parts[0].text

    // then
    expect(injected).toContain("PR Delivery Mode")
    expect(injected).toContain("git worktree add")
    expect(injected).not.toContain("until the PR is MERGED")
  })

  test("#given --ship #when processing #then injected context includes the merge lifecycle", async () => {
    // given
    const hook = createHookForDir(testDir)
    const output = {
      parts: [{ type: "text", text: createStartWorkPromptWithArgs("work --ship") }],
    }

    // when
    await hook["chat.message"]({ sessionID: "ship-sess" }, output)
    const injected = output.parts[0].text

    // then
    expect(injected).toContain("PR Delivery Mode")
    expect(injected).toContain("until the PR is MERGED")
  })

  test("#given plain start-work #when processing #then no PR delivery block is injected", async () => {
    // given
    const hook = createHookForDir(testDir)
    const output = {
      parts: [{ type: "text", text: createStartWorkPromptWithArgs("work") }],
    }

    // when
    await hook["chat.message"]({ sessionID: "plain-sess" }, output)
    const injected = output.parts[0].text

    // then
    expect(injected).not.toContain("PR Delivery Mode")
  })

  test("#given --make-pr flag #when parsing plan name #then flag does not leak into boulder plan selection", async () => {
    // given
    const hook = createHookForDir(testDir)
    const output = {
      parts: [{ type: "text", text: createStartWorkPromptWithArgs("work --make-pr") }],
    }

    // when
    await hook["chat.message"]({ sessionID: "leak-sess" }, output)
    const state = readBoulderState(testDir)

    // then
    expect(state?.plan_name).toBe("work")
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
