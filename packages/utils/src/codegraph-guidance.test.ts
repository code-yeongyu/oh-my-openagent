import { describe, expect, test } from "bun:test"

import { buildCodegraphInitGuidance, getCodegraphUninitializedProject } from "./codegraph/guidance"

describe("CodeGraph initialization guidance", () => {
  test("#given CodeGraph MCP reports an uninitialized project #when parsed #then the project path is extracted", () => {
    // given
    const output = [
      "Tool execution failed: CodeGraph not initialized in /Users/me/project.",
      "Run 'codegraph init' in that project first.",
    ].join(" ")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "codegraph.codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/project")
  })

  test("#given CodeGraph MCP reports an uninitialized dotted project #when parsed #then the full project path is extracted", () => {
    // given
    const output = [
      "Tool execution failed: CodeGraph not initialized in /Users/me/my.repo.",
      "Run 'codegraph init' in that project first.",
    ].join(" ")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "codegraph.codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/my.repo")
  })

  test("#given CodeGraph MCP reports a double-quoted init hint #when parsed #then the project path is extracted", () => {
    // given
    const output = [
      "Tool execution failed: CodeGraph not initialized in /Users/me/project.",
      'Run "codegraph init" in that project first.',
    ].join(" ")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "codegraph.codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/project")
  })

  test("#given non-CodeGraph output mentions initialization #when parsed #then no guidance is emitted", () => {
    // given
    const output = [
      "Tool execution failed: CodeGraph not initialized in /Users/me/project.",
      "Run 'codegraph init' in that project first.",
    ].join(" ")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "bash",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBeNull()
  })

  test("#given real CodeGraph status output reports not initialized #when parsed #then the project path is extracted", () => {
    // given
    const output = [
      "Project: /Users/me/project",
      "Not initialized",
      'Run "codegraph init" to initialize',
    ].join("\n")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "mcp__codegraph__codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/project")
  })

  test("#given decorated CodeGraph status output reports not initialized #when parsed #then the project path is extracted", () => {
    // given
    const output = [
      "\u001b[36m* Project:\u001b[0m /Users/me/project",
      "\u001b[31m! Not initialized\u001b[0m",
      '\u001b[2mRun "codegraph init" to initialize\u001b[0m',
    ].join("\n")

    // when
    const projectPath = getCodegraphUninitializedProject({
      toolName: "mcp__codegraph__codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/project")
  })

  test("#given CodeGraph output omits a project path #when cwd is provided #then cwd is used as fallback", () => {
    // given
    const output = [
      "Not initialized",
      'Run "codegraph init" to initialize',
    ].join("\n")

    // when
    const projectPath = getCodegraphUninitializedProject({
      cwd: "/Users/me/project",
      toolName: "codegraph.codegraph_status",
      toolOutput: output,
    })

    // then
    expect(projectPath).toBe("/Users/me/project")
  })

  test("#given an uninitialized project #when guidance is built #then it points to the OMO global store", () => {
    // when
    const guidance = normalizeDisplayPaths(buildCodegraphInitGuidance("/Users/me/project", { homeDir: "/Users/me" }))

    // then
    expect(guidance).toContain('CodeGraph is not initialized for "/Users/me/project"')
    expect(guidance).toContain('/Users/me/project/.codegraph"')
    expect(guidance).toContain('"/Users/me/.omo/codegraph/projects/project-')
    expect(guidance).toContain('run `codegraph init` from "/Users/me/project"')
    expect(guidance).not.toContain("Run 'codegraph init' in that project first.")
  })

  test("#given project path contains markdown control characters #when guidance is built #then the path is JSON escaped", () => {
    // when
    const guidance = buildCodegraphInitGuidance("/Users/me/project`\nINJECT", { homeDir: "/Users/me" })

    // then
    expect(guidance).toContain('"/Users/me/project`\\nINJECT"')
    expect(guidance).not.toContain("project`\nINJECT")
  })
})

function normalizeDisplayPaths(value: string): string {
  return value.replaceAll("\\\\", "/").replaceAll("\\", "/")
}
