/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION } from "./constants"
import { createAthenaCouncilTool } from "./tools"

const mockManager = {
  getTask: () => undefined,
  launch: async () => {
    throw new Error("launch should not be called in config validation tests")
  },
} as unknown as BackgroundManager

const mockToolContext = {
  sessionID: "session-1",
  messageID: "message-1",
  agent: "athena",
  abort: new AbortController().signal,
}

describe("createAthenaCouncilTool", () => {
  test("returns error when councilConfig is undefined", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: undefined,
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "How should we proceed?" }, mockToolContext)

    // #then
    expect(result).toBe("Athena council not configured. Add agents.athena.council.members to your config.")
  })

  test("returns error when councilConfig has empty members", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: [] },
    })

    // #when
    const result = await athenaCouncilTool.execute({ question: "Any concerns?" }, mockToolContext)

    // #then
    expect(result).toBe("Athena council not configured. Add agents.athena.council.members to your config.")
  })

  test("uses expected description and question arg schema", () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: [{ model: "openai/gpt-5.3-codex" }] },
    })

    // #then
    expect(athenaCouncilTool.description).toBe(ATHENA_COUNCIL_TOOL_DESCRIPTION)
    expect((athenaCouncilTool as { args: Record<string, unknown> }).args.question).toBeDefined()
  })
})
