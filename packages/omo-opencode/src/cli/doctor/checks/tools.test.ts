import { describe, expect, it } from "bun:test"
import { buildToolIssues } from "./tools"

describe("buildToolIssues", () => {
  it("#given every user MCP is valid #when building issues #then reports none (tool health belongs to Components)", () => {
    // when
    const issues = buildToolIssues(0)

    // then
    expect(issues).toEqual([])
  })

  it("#given invalid user MCP servers #when building issues #then reports their count", () => {
    // when
    const issues = buildToolIssues(2)

    // then
    expect(issues).toHaveLength(1)
    expect(issues[0]?.description).toContain("2 user MCP server(s)")
  })
})
