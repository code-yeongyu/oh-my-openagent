import { describe, expect, test } from "bun:test"

import { createNotepadWriteGuardHook } from "../hooks/notepad-write-guard"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { CreatedHooks } from "../create-hooks"
import type { PluginContext } from "./types"

const REFUSED_PREFIX = "Refused: Write to"

function createContext(): PluginContext {
  return unsafeTestValue<PluginContext>({
    client: {
      session: {
        messages: async () => ({ data: [] }),
      },
    },
  })
}

function createHooks(): CreatedHooks {
  return unsafeTestValue<CreatedHooks>({
    notepadWriteGuard: createNotepadWriteGuardHook(),
  })
}

async function runTool(args: { readonly tool: string; readonly filePath: string }): Promise<void> {
  const handler = createToolExecuteBeforeHandler({
    ctx: createContext(),
    hooks: createHooks(),
  })

  await handler(
    { tool: args.tool, sessionID: "ses_notepad", callID: "call_notepad" },
    { args: { file_path: args.filePath } },
  )
}

async function expectBlocked(args: { readonly tool: string; readonly filePath: string }): Promise<void> {
  let caughtMessage = ""
  try {
    await runTool(args)
  } catch (error) {
    if (error instanceof Error) {
      caughtMessage = error.message
    } else {
      throw error
    }
  }

  expect(caughtMessage).toContain(REFUSED_PREFIX)
}

describe("tool.execute.before notepad-write-guard dispatch", () => {
  test("#given guard enabled #when Write targets current .omo notepad #then blocks", async () => {
    await expectBlocked({
      tool: "Write",
      filePath: ".omo/notepads/plan.md",
    })
  })

  test("#given guard enabled #when Write targets other .omo path #then allows", async () => {
    await runTool({
      tool: "Write",
      filePath: ".omo/somewhere-else.md",
    })
  })

  test("#given guard enabled #when Edit targets current .omo notepad #then allows", async () => {
    await runTool({
      tool: "Edit",
      filePath: ".omo/notepads/plan.md",
    })
  })
})
