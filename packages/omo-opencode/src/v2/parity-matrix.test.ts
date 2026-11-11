import { describe, expect, it, test } from "bun:test"
import v1Plugin from "../index"
import v2Plugin, { BOOTSTRAP_STAGE, PLUGIN_ID, statusHandler } from "./index"

describe("OpenCode V2 parity matrix", () => {
  it("keeps the V1 server entry available", () => {
    // given
    const server = v1Plugin.server

    // when
    const serverType = typeof server

    // then
    expect(serverType).toBe("function")
  })

  it("exposes the V2 id and setup entry", () => {
    // given
    const definition = v2Plugin

    // when
    const id = definition.id
    const setupType = typeof definition.setup

    // then
    expect(id).toBe(PLUGIN_ID)
    expect(setupType).toBe("function")
  })

  it("returns the bootstrap status response", async () => {
    // given
    const expected = { ok: true, stage: BOOTSTRAP_STAGE, plugin: PLUGIN_ID }

    // when
    const result = await statusHandler()

    // then
    expect(result).toEqual(expected)
  })

  test.todo("tools: glob")
  test.todo("tools: grep")
  test.todo("tools: execute before and after hooks")
  test.todo("prompt: prompt hook")
  test.todo("context: system and messages")
  test.todo("context: tool-call and tool-result pairing")
  test.todo("compaction: context and todo preservation")
  test.todo("agents: list")
  test.todo("agents: dispatch")
  test.todo("agents: unknown agent error")
  test.todo("commands: list")
  test.todo("mcp: built-in servers")
  test.todo("skills: shared skills")
  test.todo("config: domain projection")
  test.todo("orchestration: background task lifecycle")
  test.todo("orchestration: todo roundtrip")
  test.todo("orchestration: goal and boulder continuation")
  test.todo("orchestration: model fallback")
  test.todo("orchestration: team mode")
  test.todo("orchestration: monitor lifecycle")
  test.todo("tui: sidebar slot")
  test.todo("tui: keymap layer")
})
