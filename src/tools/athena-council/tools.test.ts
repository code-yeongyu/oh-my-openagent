/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION } from "./constants"
import { createAthenaCouncilTool, filterCouncilMembers } from "./tools"

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

const configuredMembers = [
  { name: "Claude", model: "anthropic/claude-sonnet-4-5" },
  { name: "GPT", model: "openai/gpt-5.3-codex" },
  { model: "google/gemini-3-pro" },
]

describe("filterCouncilMembers", () => {
  test("returns all members when selection is undefined", () => {
    // #given
    const selectedMembers = undefined

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual(configuredMembers)
    expect(result.error).toBeUndefined()
  })

  test("returns all members when selection is empty", () => {
    // #given
    const selectedMembers: string[] = []

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual(configuredMembers)
    expect(result.error).toBeUndefined()
  })

  test("filters members using case-insensitive name and model matching", () => {
    // #given
    const selectedMembers = ["gpt", "GOOGLE/GEMINI-3-PRO"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([configuredMembers[1], configuredMembers[2]])
    expect(result.error).toBeUndefined()
  })

  test("returns helpful error when selected members are not configured", () => {
    // #given
    const selectedMembers = ["mistral", "xai/grok-3"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "Unknown council members: mistral, xai/grok-3. Available members: Claude, GPT, google/gemini-3-pro."
    )
  })

  test("returns error listing only unmatched names when partially matched", () => {
    // #given
    const selectedMembers = ["claude", "non-existent"]

    // #when
    const result = filterCouncilMembers(configuredMembers, selectedMembers)

    // #then
    expect(result.members).toEqual([])
    expect(result.error).toBe(
      "Unknown council members: non-existent. Available members: Claude, GPT, google/gemini-3-pro."
    )
  })
})

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
    expect((athenaCouncilTool as { args: Record<string, unknown> }).args.members).toBeDefined()
  })

  test("returns helpful error when members contains invalid names", async () => {
    // #given
    const athenaCouncilTool = createAthenaCouncilTool({
      backgroundManager: mockManager,
      councilConfig: { members: configuredMembers },
    })
    const toolArgs = {
      question: "Who should investigate this?",
      members: ["unknown-model"],
    }

    // #when
    const result = await athenaCouncilTool.execute(toolArgs, mockToolContext)

    // #then
    expect(result).toBe("Unknown council members: unknown-model. Available members: Claude, GPT, google/gemini-3-pro.")
  })
})
