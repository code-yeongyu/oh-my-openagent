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

  it("matches a package dist cli suffix on Windows path separators", () => {
    // given
    const windowsPath = "C:\\Users\\test\\AppData\\Local\\cache\\oh-my-opencode\\dist\\packages\\lsp-tools-mcp\\dist\\cli.js"

    // when: matched against just the trailing `dist/cli.js` segment
    const matchesShortSuffix = hasCliSuffix(windowsPath, "dist/cli.js")
    // and the fully-qualified package suffix
    const matchesPackageSuffix = hasCliSuffix(windowsPath, "packages/lsp-tools-mcp/dist/cli.js")

    // then: both must succeed despite the backslashes
    expect(matchesShortSuffix).toBe(true)
    expect(matchesPackageSuffix).toBe(true)
  })
})
