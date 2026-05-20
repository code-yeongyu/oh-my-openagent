import { describe, expect, it } from "bun:test"
import { hasCliSuffix } from "./cli-suffix"

describe("hasCliSuffix", () => {
  it("matches cli suffixes across platform separators", () => {
    // given
    const suffix = "packages/lsp-tools-mcp/dist/cli.js"
    const candidatePaths = [
      "/home/user/project/packages/lsp-tools-mcp/dist/cli.js",
      "C:\\Users\\yeongyu\\project\\packages\\lsp-tools-mcp\\dist\\cli.js",
      "\\\\server\\share\\project\\packages\\lsp-tools-mcp\\dist\\cli.js",
      "C:/Users/yeongyu/project\\packages/lsp-tools-mcp\\dist/cli.js",
    ]

    // when
    const results = candidatePaths.map((candidatePath) => hasCliSuffix(candidatePath, suffix))

    // then
    expect(results).toEqual([true, true, true, true])
  })

  it("does not match unrelated cli suffixes", () => {
    // given
    const candidatePath = "C:\\Users\\yeongyu\\project\\packages\\other-mcp\\dist\\cli.js"

    // when
    const result = hasCliSuffix(candidatePath, "packages/lsp-tools-mcp/dist/cli.js")

    // then
    expect(result).toBe(false)
  })
})
