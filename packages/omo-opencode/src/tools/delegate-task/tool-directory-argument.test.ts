import { describe, expect, test } from "bun:test"

import { createDelegateTask } from "./tools"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"

describe("task directory argument", () => {
  test("exposes an optional non-empty directory in the public tool schema", () => {
    //#given
    const task = createDelegateTask({
      manager: {},
      client: {},
      directory: "/default",
    } as never)

    //#when
    const explicit = task.args.directory.safeParse("/worktree-a")
    const omitted = task.args.directory.safeParse(undefined)
    const empty = task.args.directory.safeParse("")
    const nonString = task.args.directory.safeParse(42)

    //#then
    expect(explicit.success).toBe(true)
    expect(omitted.success).toBe(true)
    expect(empty.success).toBe(false)
    expect(nonString.success).toBe(false)
  })

  test("preserves an explicit directory through argument preparation", async () => {
    //#when
    const result = await prepareDelegateTaskArgs({
      prompt: "inspect the worktree",
      directory: "/worktree-a",
    }, {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: new AbortController().signal,
    })

    //#then
    expect(result.directory).toBe("/worktree-a")
  })

  test("keeps directory undefined when omitted", async () => {
    //#when
    const result = await prepareDelegateTaskArgs({
      prompt: "inspect the parent",
    }, {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: new AbortController().signal,
    })

    //#then
    expect(result.directory).toBeUndefined()
  })
})
