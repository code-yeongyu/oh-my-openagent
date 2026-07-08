import { describe, expect, test } from "bun:test"

import {
  BTW_TOOL_GUARD_DENIAL_MESSAGE,
  createBtwToolGuardHook,
} from "../hooks/btw-tool-guard"
import { BTW_AUTO_SLASH_COMMAND_MARKER } from "../hooks/btw-context-strip/predicates"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { CreatedHooks } from "../create-hooks"
import type { PluginContext } from "./types"

function createContext(latestUserIsBtw: boolean): PluginContext {
  return unsafeTestValue<PluginContext>({
    client: {
      session: {
        messages: async () => ({
          data: [
            latestUserIsBtw
              ? { info: { role: "user", [BTW_AUTO_SLASH_COMMAND_MARKER]: true }, parts: [] }
              : { info: { role: "user" }, parts: [] },
          ],
        }),
      },
    },
  })
}

function createHooks(ctx: PluginContext): CreatedHooks {
  return unsafeTestValue<CreatedHooks>({
    btwToolGuard: createBtwToolGuardHook({ client: ctx.client }),
  })
}

function createOrderRecordingHooks(ctx: PluginContext, invocations: string[]): CreatedHooks {
  const recorder = (name: string) => ({
    "tool.execute.before": async (): Promise<void> => {
      invocations.push(name)
    },
  })

  return unsafeTestValue<CreatedHooks>({
    writeExistingFileGuard: recorder("writeExistingFileGuard"),
    claudeCodeHooks: recorder("claudeCodeHooks"),
    btwToolGuard: createBtwToolGuardHook({ client: ctx.client }),
  })
}

async function runReadTool(ctx: PluginContext): Promise<void> {
  const handler = createToolExecuteBeforeHandler({
    ctx,
    hooks: createHooks(ctx),
  })

  await handler(
    { tool: "Read", sessionID: "ses_btw_guard_dispatch", callID: "call_btw_guard_dispatch" },
    { args: { filePath: "/tmp/whatever.ts" } },
  )
}

describe("tool.execute.before btw-tool-guard dispatch", () => {
  test("#given the latest user message is a marked /btw answer turn #when a tool is attempted #then the handler dispatches btwToolGuard and denies it", async () => {
    // given a primary-session /btw answer turn
    const ctx = createContext(true)

    // when a tool is attempted
    let caughtMessage = ""
    try {
      await runReadTool(ctx)
    } catch (error) {
      if (error instanceof Error) {
        caughtMessage = error.message
      } else {
        throw error
      }
    }

    // then the dispatched guard blocks the tool
    expect(caughtMessage).toBe(BTW_TOOL_GUARD_DENIAL_MESSAGE)
  })

  test("#given the latest user message is not a /btw turn #when a tool is attempted #then the handler does not deny it", async () => {
    // given a normal (non-/btw) turn
    const ctx = createContext(false)

    // when a tool is attempted then the btw guard does not throw
    await runReadTool(ctx)
  })

  test("#given a marked /btw answer turn #when a tool is attempted #then the guard denies before side-effectful pre-tool hooks run", async () => {
    // given a primary-session /btw answer turn with hooks that record invocation order
    const ctx = createContext(true)
    const invocations: string[] = []
    const handler = createToolExecuteBeforeHandler({
      ctx,
      hooks: createOrderRecordingHooks(ctx, invocations),
    })

    // when a tool is attempted
    let caughtMessage = ""
    try {
      await handler(
        { tool: "Read", sessionID: "ses_btw_guard_order", callID: "call_btw_guard_order" },
        { args: { filePath: "/tmp/whatever.ts" } },
      )
    } catch (error) {
      if (error instanceof Error) {
        caughtMessage = error.message
      } else {
        throw error
      }
    }

    // then the guard denies the tool and no side-effectful hook observed the call
    expect(caughtMessage).toBe(BTW_TOOL_GUARD_DENIAL_MESSAGE)
    expect(invocations).toEqual([])
  })
})
