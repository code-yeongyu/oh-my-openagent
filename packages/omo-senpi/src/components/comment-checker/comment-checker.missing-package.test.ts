import { describe, expect, it } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  registerWithFakeRunner,
} from "./comment-checker.test-support"
import { resolveSenpiCommentCheckerBinary } from "./index"

function isolatedModuleUrl(): string {
  const cwd = createTempCwd()
  mkdirSync(join(cwd, "node_modules"))
  return pathToFileURL(join(cwd, "extension.js")).href
}

// The value Bun 1.3.x throws for a missing module: MODULE_NOT_FOUND, but not an Error instance (omo#8247).
const bunResolveMessage = { name: "ResolveMessage", code: "MODULE_NOT_FOUND", isError: false, message: "Cannot find module" }

describe("omo-senpi comment-checker missing package", () => {
  it("#given a missing package #when PATH has a checker #then real module resolution falls back to PATH", () => {
    // given
    const importMetaUrl = isolatedModuleUrl()
    const pathBinary = join(createTempCwd(), "comment-checker")
    const candidates: string[] = []

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      importMetaUrl,
      cacheDir: createTempCwd(),
      pathLookup: (binaryName) => {
        candidates.push(binaryName)
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(pathBinary)
    expect(candidates).toEqual([process.platform === "win32" ? "comment-checker.exe" : "comment-checker"])
  })

  it("#given no package, PATH, or cached checker #when resolving the binary #then it returns null", () => {
    // given
    const importMetaUrl = isolatedModuleUrl()

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      importMetaUrl,
      cacheDir: createTempCwd(),
      pathLookup: () => null,
    })

    // then
    expect(resolved).toBeNull()
  })

  it("#given Bun's non-Error ResolveMessage #when package loading throws it #then the package is treated as missing", () => {
    // given
    const pathBinary = join(createTempCwd(), "comment-checker")

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      requireModule: () => {
        throw bunResolveMessage
      },
      cacheDir: createTempCwd(),
      pathLookup: () => pathBinary,
    })

    // then
    expect(resolved).toBe(pathBinary)
  })

  it("#given no package, PATH, or cached checker and no download #when successful edits finish #then the hook disables once without failing", async () => {
    // given
    const cwd = createTempCwd()
    const importMetaUrl = isolatedModuleUrl()
    const logger = createRecordingLogger()
    let downloads = 0
    const { pi, calls } = await registerWithFakeRunner({
      logger,
      resolveBinary: () =>
        resolveSenpiCommentCheckerBinary({
          env: {},
          importMetaUrl,
          cacheDir: createTempCwd(),
          pathLookup: () => null,
        }),
      downloadBinary: async () => {
        downloads += 1
        return null
      },
    })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2" }), createContext(cwd))

    // then
    expect(calls).toEqual([])
    expect(downloads).toBe(1)
    expect(logger.entries.map((entry) => entry.level)).toEqual(["warn"])
  })

  it("#given an unrelated thrown value #when package loading fails #then the value still propagates", () => {
    // given
    const failure = { code: "UNEXPECTED_CHECKER_FAILURE" }
    let caught: unknown

    // when
    try {
      resolveSenpiCommentCheckerBinary({
        env: {},
        requireModule: () => {
          throw failure
        },
        cacheDir: createTempCwd(),
        pathLookup: () => null,
      })
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBe(failure)
  })
})
