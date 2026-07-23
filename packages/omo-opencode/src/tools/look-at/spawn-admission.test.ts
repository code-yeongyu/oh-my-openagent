import { expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createLookAt } from "./tools"

function createContext(agent: string | undefined): ToolContext {
  return unsafeTestValue<ToolContext>({
    sessionID: "parent-session",
    messageID: "parent-message",
    agent,
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  })
}

function createTool(sessionCreate: () => Promise<unknown>) {
  return createLookAt(unsafeTestValue({
    client: {
      session: {
        get: async () => ({ data: { directory: "/project" } }),
        create: sessionCreate,
      },
    },
    directory: "/project",
  }))
}

test("#given worker caller #when look_at runs #then it is denied before child session creation", async () => {
  const create = mock(async () => ({ data: { id: "child-session" } }))
  const result = await createTool(create).execute(
    { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "describe" },
    createContext("sisyphus-junior"),
  )

  expect(result).toContain("Subagent spawn denied")
  expect(create).not.toHaveBeenCalled()
})

test("#given missing caller identity #when look_at runs #then it is denied before child session creation", async () => {
  const create = mock(async () => ({ data: { id: "child-session" } }))
  const result = await createTool(create).execute(
    { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "describe" },
    createContext(undefined),
  )

  expect(result).toContain("trusted caller identity is required")
  expect(create).not.toHaveBeenCalled()
})
