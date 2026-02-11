import { describe, expect, it } from "bun:test"
import { createDefaultArgs, parseMcbToolResponse } from "./mcb-client-helper"

describe("mcb-integration/mcb-client-helper", () => {
  //#given memory tool defaults
  //#when createDefaultArgs is called
  //#then all required memory fields are present
  it("builds required default args for memory", () => {
    const args = createDefaultArgs("memory")
    expect(args).toHaveProperty("action")
    expect(args).toHaveProperty("resource")
    expect(args).toHaveProperty("data")
    expect(args).toHaveProperty("ids")
    expect(args).toHaveProperty("project_id")
    expect(args).toHaveProperty("repo_id")
    expect(args).toHaveProperty("session_id")
    expect(args).toHaveProperty("tags")
    expect(args).toHaveProperty("query")
    expect(args).toHaveProperty("anchor_id")
    expect(args).toHaveProperty("depth_before")
    expect(args).toHaveProperty("depth_after")
    expect(args).toHaveProperty("window_secs")
    expect(args).toHaveProperty("observation_types")
    expect(args).toHaveProperty("max_tokens")
    expect(args).toHaveProperty("limit")
  })

  //#given search tool defaults
  //#when createDefaultArgs is called
  //#then all required search fields are present
  it("builds required default args for search", () => {
    const args = createDefaultArgs("search")
    expect(args).toHaveProperty("query")
    expect(args).toHaveProperty("resource")
    expect(args).toHaveProperty("collection")
    expect(args).toHaveProperty("extensions")
    expect(args).toHaveProperty("filters")
    expect(args).toHaveProperty("limit")
    expect(args).toHaveProperty("min_score")
    expect(args).toHaveProperty("tags")
    expect(args).toHaveProperty("session_id")
    expect(args).toHaveProperty("token")
  })

  //#given an unknown tool
  //#when createDefaultArgs is called
  //#then an empty object is returned
  it("returns empty defaults for unsupported tools", () => {
    const args = createDefaultArgs("org_entity")
    expect(args).toEqual({})
  })

  //#given MCP response text with JSON content
  //#when parseMcbToolResponse runs
  //#then it returns parsed JSON
  it("parses JSON response text", () => {
    const parsed = parseMcbToolResponse({
      content: [{ type: "text", text: '{"count":0,"items":[]}' }],
    })
    expect(parsed).toEqual({ count: 0, items: [] })
  })

  //#given MCP response text with plain text
  //#when parseMcbToolResponse runs
  //#then it returns plain text payload
  it("returns plain text when response is not JSON", () => {
    const parsed = parseMcbToolResponse({
      content: [{ type: "text", text: "internal error" }],
      isError: true,
    })
    expect(parsed).toEqual({ text: "internal error", isError: true })
  })

  //#given MCP response without text items
  //#when parseMcbToolResponse runs
  //#then it returns empty text payload
  it("handles response without text content", () => {
    const parsed = parseMcbToolResponse({ content: [{ type: "image", text: "" }] })
    expect(parsed).toEqual({ text: "", isError: false })
  })
})
