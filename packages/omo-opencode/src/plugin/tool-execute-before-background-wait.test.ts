import { describe, expect, test } from "bun:test"

import { createToolExecuteBeforeHandler } from "./tool-execute-before"

function createTestContext() {
  return {
    client: {
      session: {
        messages: async () => ({ data: [] }),
      },
    },
  }
}

describe("createToolExecuteBeforeHandler background wait guard", () => {
  test("blocks placeholder sleep waits while background children are still active", async () => {
    //#given
    const backgroundManager = {
      hasActiveDescendantTasks: (sessionID: string) => sessionID === "ses_parent",
    }
    const handler = createToolExecuteBeforeHandler({
      ctx: createTestContext(),
      hooks: {},
      backgroundManager,
    })
    const output = {
      args: {
        command: "# Placeholder wait\nsleep 1",
      } as Record<string, unknown>,
    }

    //#when
    const run = handler({ tool: "bash", sessionID: "ses_parent", callID: "call_wait" }, output)

    //#then
    await expect(run).rejects.toThrow("Background task wait is already managed")
  })

  test("allows sleep commands when the session has no active background children", async () => {
    //#given
    const backgroundManager = {
      hasActiveDescendantTasks: () => false,
      hasPendingParentWake: () => false,
    }
    const handler = createToolExecuteBeforeHandler({
      ctx: createTestContext(),
      hooks: {},
      backgroundManager,
    })
    const output = {
      args: {
        command: "sleep 1",
      } as Record<string, unknown>,
    }

    //#when
    const run = handler({ tool: "bash", sessionID: "ses_parent", callID: "call_sleep" }, output)

    //#then
    await expect(run).resolves.toBeUndefined()
  })

  test("blocks placeholder sleep waits while a parent wake is pending", async () => {
    //#given
    const backgroundManager = {
      hasActiveDescendantTasks: () => false,
      hasPendingParentWake: (sessionID: string) => sessionID === "ses_parent",
    }
    const handler = createToolExecuteBeforeHandler({
      ctx: createTestContext(),
      hooks: {},
      backgroundManager,
    })
    const output = {
      args: {
        command: "# Placeholder wait\nsleep 1",
      } as Record<string, unknown>,
    }

    //#when
    const run = handler({ tool: "bash", sessionID: "ses_parent", callID: "call_wake" }, output)

    //#then
    await expect(run).rejects.toThrow("Background task wait is already managed")
  })

  test("allows non-wait bash commands while background children are active", async () => {
    //#given
    const backgroundManager = {
      hasActiveDescendantTasks: () => true,
      hasPendingParentWake: () => false,
    }
    const handler = createToolExecuteBeforeHandler({
      ctx: createTestContext(),
      hooks: {},
      backgroundManager,
    })
    const output = {
      args: {
        command: "sleep 1 && echo ready",
      } as Record<string, unknown>,
    }

    //#when
    const run = handler({ tool: "bash", sessionID: "ses_parent", callID: "call_work" }, output)

    //#then
    await expect(run).resolves.toBeUndefined()
  })
})
