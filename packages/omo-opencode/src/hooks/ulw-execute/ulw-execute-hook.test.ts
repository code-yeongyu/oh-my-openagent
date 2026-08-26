/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { readBoulderState, clearBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createUlwExecuteHook } from "./ulw-execute-hook"
import { ULW_EXECUTE_TEMPLATE } from "../../features/builtin-commands/templates/ulw-execute"
import { createPrDeliveryBlock } from "./worktree-block"

describe("ulw-execute hook platform session ids", () => {
  let testDir: string

  function createUlwExecutePrompt(): string {
    return `<command-instruction>
You are starting an Atlas work session.
</command-instruction>

<session-context></session-context>`
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `ulw-execute-hook-session-prefix-${randomUUID()}`)
    mkdirSync(join(testDir, ".omo", "plans"), { recursive: true })
    clearBoulderState(testDir)
  })

  afterEach(() => {
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("#given raw chat session id #when processing ulw-execute template #then boulder stores opencode-prefixed id", async () => {
    // given
    writeFileSync(join(testDir, ".omo", "plans", "work.md"), "# Work\n- [ ] First task\n")
    const hook = createUlwExecuteHook(unsafeTestValue<Parameters<typeof createUlwExecuteHook>[0]>({
      directory: testDir,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }))
    const output = {
      parts: [{ type: "text", text: createUlwExecutePrompt() }],
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
    const hook = createUlwExecuteHook(unsafeTestValue<Parameters<typeof createUlwExecuteHook>[0]>({
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
      parts: [{ type: "text", text: createUlwExecutePrompt() }],
    }

    // when
    await hook["chat.message"]({ sessionID: "raw-sess" }, output)

    // then
    expect(sessionMessageIds).toContain("raw-sess")
    expect(sessionMessageIds).not.toContain("opencode:raw-sess")
  })
})

describe("ulw-execute PR delivery flags", () => {
  let testDir: string

  function createUlwExecutePromptWithArgs(args: string): string {
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
    return createUlwExecuteHook(unsafeTestValue<Parameters<typeof createUlwExecuteHook>[0]>({
      directory: dir,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }))
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `ulw-execute-hook-pr-delivery-${randomUUID()}`)
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

  test.each([
    { flag: "--make-pr", flags: { makePr: true, ship: false } },
    { flag: "--ship", flags: { makePr: false, ship: true } },
  ])("#given $flag #when processing #then the hook injects exactly that PR delivery branch", async ({ flag, flags }) => {
    // given - the expected branch is pinned independently of the production
    // parser: createPrDeliveryBlock only renders the shipped copy for flags
    // the test itself chose, so a hook/parser branch flip cannot pass
    const prompt = createUlwExecutePromptWithArgs(`work ${flag}`)
    const selectedBlock = createPrDeliveryBlock(flags, undefined)
    const rejectedBlock = createPrDeliveryBlock(
      { makePr: !flags.makePr, ship: !flags.ship },
      undefined,
    )
    const hook = createHookForDir(testDir)
    const output = { parts: [{ type: "text", text: prompt }] }

    // when
    await hook["chat.message"]({ sessionID: `delivery-${flag.slice(2)}` }, output)

    // then - branch selection, hook integration, and persisted plan state agree
    expect(output.parts[0].text).toContain(selectedBlock)
    expect(output.parts[0].text).not.toContain(rejectedBlock)
    expect(readBoulderState(testDir)).toMatchObject({
      plan_name: "work",
      worktree_path: undefined,
    })
  })

  test("#given no delivery flags #when processing #then no PR delivery block is injected", async () => {
    // given - a plain work request renders neither shipped delivery branch
    const prompt = createUlwExecutePromptWithArgs("work")
    const hook = createHookForDir(testDir)
    const output = { parts: [{ type: "text", text: prompt }] }

    // when
    await hook["chat.message"]({ sessionID: "plain-sess" }, output)

    // then - neither branch's shipped block is present in the plain path
    expect(output.parts[0].text).not.toContain(
      createPrDeliveryBlock({ makePr: true, ship: false }, undefined),
    )
    expect(output.parts[0].text).not.toContain(
      createPrDeliveryBlock({ makePr: false, ship: true }, undefined),
    )
    expect(readBoulderState(testDir)).toMatchObject({
      plan_name: "work",
      worktree_path: undefined,
    })
  })

  test("#given --make-pr flag #when parsing plan name #then flag does not leak into boulder plan selection", async () => {
    // given
    const hook = createHookForDir(testDir)
    const output = {
      parts: [{ type: "text", text: createUlwExecutePromptWithArgs("work --make-pr") }],
    }

    // when
    await hook["chat.message"]({ sessionID: "leak-sess" }, output)
    const state = readBoulderState(testDir)

    // then
    expect(state?.plan_name).toBe("work")
  })
})

describe("ulw-execute template label matches the activated agent (#5499)", () => {
  test("#given /ulw-execute activates Atlas #when reading the shipped template header #then it carries the marker the hook gates on", () => {
    // /ulw-execute activates the atlas agent (see createUlwExecuteHook), and the
    // hook only fires on messages containing this marker, so the shipped
    // template must keep it (#5499).
    expect(ULW_EXECUTE_TEMPLATE).toContain("You are starting an Atlas work session.")
  })
})
