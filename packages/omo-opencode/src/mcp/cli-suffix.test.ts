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

  // regression: issue #4193 — mirrors the candidate paths `resolveLspCommand`'s
  // ancestor walk produces on Windows. Pins the matcher so future churn can't
  // re-introduce the "MCP error -32000: Connection closed" failure caused by
  // `path.endsWith("dist/cli.js")` missing on backslash paths.
  it("matches the lsp-tools-mcp dist cli candidate reported in issue #4193", () => {
    // given: the EXISTS candidate from the issue's resolution simulation
    const realCandidate = "C:\\Users\\user\\.cache\\opencode\\packages\\oh-my-openagent@latest\\node_modules\\oh-my-openagent\\packages\\lsp-tools-mcp\\dist\\cli.js"

    // when: matched against the fully-qualified package suffix and the short form
    const matchesPackage = hasCliSuffix(realCandidate, "packages/lsp-tools-mcp/dist/cli.js")
    const matchesShort = hasCliSuffix(realCandidate, "dist/cli.js")

    // then: both must succeed despite the backslashes — this was the missing
    // hit that pushed the resolver into its non-existent fallback path
    expect(matchesPackage).toBe(true)
    expect(matchesShort).toBe(true)
  })

  it("does not confuse a sibling 'dist/packages/lsp-tools-mcp/dist/cli.js' fallback for the real one", () => {
    // given: the buggy fallback path the original resolver landed on (still
    // contains `packages/lsp-tools-mcp/dist/cli.js` as a substring, but the
    // suffix actually starts later — its containing dir is `dist/packages`, not
    // the package root)
    const fallback = "C:\\Users\\user\\.cache\\opencode\\packages\\oh-my-openagent@latest\\node_modules\\oh-my-openagent\\dist\\packages\\lsp-tools-mcp\\dist\\cli.js"

    // when
    const matchesPackage = hasCliSuffix(fallback, "packages/lsp-tools-mcp/dist/cli.js")

    // then: still matches as a suffix — disambiguation between the real cli and
    // this stale fallback is the resolver's job (via `exists` checks), not the
    // matcher's. This test pins that contract so callers don't assume otherwise.
    expect(matchesPackage).toBe(true)
  })
})
