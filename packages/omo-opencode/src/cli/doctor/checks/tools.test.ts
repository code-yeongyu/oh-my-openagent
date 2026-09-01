import { describe, expect, it } from "bun:test"
import type { ToolsSummary } from "../framework/types"
import { buildToolIssues } from "./tools"

function completeSummary(overrides: Partial<ToolsSummary> = {}): ToolsSummary {
    return {
      astGrepCli: true,
      commentChecker: true,
    ghCli: { authenticated: true, installed: true, username: "octocat" },
    lspServers: [{ extensions: [".ts"], id: "typescript" }],
    mcpBuiltin: [],
    mcpUser: [],
    ...overrides,
  }
}

describe("buildToolIssues", () => {
  it("#given no ast-grep CLI #when building issues #then references the ast-grep skill instead of MCP tool names", () => {
    // given
    const summary = completeSummary({ astGrepCli: false })

    // when
    const issues = buildToolIssues(summary)

    // then
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("AST-Grep unavailable")
    expect(issues[0]?.affects).toEqual(["ast-grep skill"])
    expect(issues[0]?.fix).toContain("ast-grep skill")
    expect(issues[0]?.fix).toContain("sg automatically")
  })
})
