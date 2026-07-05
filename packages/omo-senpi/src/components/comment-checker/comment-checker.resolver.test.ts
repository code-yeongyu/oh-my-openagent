import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { createTempCwd } from "./comment-checker.test-support"
import { resolveSenpiCommentCheckerBinary } from "./index"

describe("omo-senpi comment-checker binary resolver", () => {
  it("#given OMO_COMMENT_CHECKER_BIN and other candidates #when resolving binary #then env var wins first", () => {
    // given
    const cwd = createTempCwd()
    const envBinary = join(cwd, "env-checker-cli.js")
    const packageBinary = join(cwd, "node_modules", "@code-yeongyu", "comment-checker", "cli.js")
    const pathBinary = join(cwd, "bin", "comment-checker")

    let packageApiCalls = 0
    let pathCalls = 0

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: { OMO_COMMENT_CHECKER_BIN: envBinary },
      existsSync: (path: string) => path === envBinary || path === packageBinary || path === pathBinary,
      importMetaUrl: import.meta.url,
      requireModule: () => {
        packageApiCalls += 1
        return { getBinaryPath: () => packageBinary }
      },
      pathLookup: () => {
        pathCalls += 1
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(envBinary)
    expect(packageApiCalls).toBe(0)
    expect(pathCalls).toBe(0)
  })

  it("#given package api exports getBinaryPath #when env is unset #then package api resolves before PATH", () => {
    // given
    const cwd = createTempCwd()
    const packageBinary = join(cwd, "node_modules", "@code-yeongyu", "comment-checker", "cli.js")
    const pathBinary = join(cwd, "bin", "comment-checker")
    let pathCalls = 0

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      existsSync: (path: string) => path === packageBinary || path === pathBinary,
      importMetaUrl: import.meta.url,
      requireModule: (packageName: string) => {
        expect(packageName).toBe("@code-yeongyu/comment-checker")
        return { getBinaryPath: () => packageBinary }
      },
      pathLookup: () => {
        pathCalls += 1
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(packageBinary)
    expect(pathCalls).toBe(0)
  })

  it("#given env and package resolution fail #when PATH has comment-checker #then PATH fallback resolves last", () => {
    // given
    const cwd = createTempCwd()
    const pathBinary = join(cwd, "bin", "comment-checker")
    const resolutionOrder: string[] = []

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      existsSync: () => false,
      importMetaUrl: import.meta.url,
      requireModule: () => {
        resolutionOrder.push("package-api")
        throw new Error("package api unavailable")
      },
      pathLookup: (binaryName: string) => {
        resolutionOrder.push(`path:${binaryName}`)
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(pathBinary)
    const expectedPathCandidate = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
    expect(resolutionOrder).toEqual(["package-api", `path:${expectedPathCandidate}`])
  })
})
