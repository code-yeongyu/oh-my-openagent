import { describe, test, expect } from "bun:test"
import { TOOL_DEFINITIONS } from "./tool-registry"

describe("TOOL_DEFINITIONS", () => {
  test("#given browser MCP tools #when listed #then exposes 14 entries in canonical order", () => {
    expect(TOOL_DEFINITIONS.map(t => t.name)).toEqual([
      "browser_navigate",
      "browser_act",
      "browser_observe",
      "browser_end_session",
      "browser_extract",
      "browser_extract_network",
      "browser_screenshot",
      "browser_solve_captcha",
      "browser_fill",
      "browser_click",
      "browser_click_at",
      "browser_evaluate",
      "browser_press",
      "browser_list_sessions",
    ])
  })

  test("#given each tool #when checked #then has description and schema", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.inputSchema).toBeDefined()
    }
  })

  test("#given each tool name #when checked #then is unique", () => {
    const names = TOOL_DEFINITIONS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("#given browser_extract_network #when schema is inspected #then include_bodies is accepted", () => {
    const tool = TOOL_DEFINITIONS.find((definition) => definition.name === "browser_extract_network")

    const parsed = tool?.inputSchema.parse({ include_bodies: true })

    expect(parsed).toMatchObject({ include_bodies: true })
  })
})
