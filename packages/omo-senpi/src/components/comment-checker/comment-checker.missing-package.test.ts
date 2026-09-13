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
      pathLookup: (binaryName) => {
        candidates.push(binaryName)
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(pathBinary)
    expect(candidates).toEqual([process.platform === "win32" ? "comment-checker.exe" : "comment-checker"])
  })

  it("#given no package or PATH checker #when resolving the binary #then it returns null", () => {
    // given
    const importMetaUrl = isolatedModuleUrl()

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      importMetaUrl,
      pathLookup: () => null,
    })

    // then
    expect(resolved).toBeNull()
  })

  it("#given no package or PATH checker #when successful edits finish #then the hook disables once without failing", async () => {
    // given
    const cwd = createTempCwd()
    const importMetaUrl = isolatedModuleUrl()
    const logger = createRecordingLogger()
    const { pi, calls } = await registerWithFakeRunner({
      logger,
      resolveBinary: () => resolveSenpiCommentCheckerBinary({
        env: {},
        importMetaUrl,
        pathLookup: () => null,
      }),
    })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2" }), createContext(cwd))

    // then
    expect(calls).toEqual([])
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
        requireModule: () => { throw failure },
        pathLookup: () => null,
      })
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBe(failure)
  })
})
