import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { runWithRequestContext } from "../request-context.js"
import type { LspClient } from "./client.js"
import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics.js"
import { __resetServerBinaryResolutionCacheForTests } from "./server-installation.js"
import type { Diagnostic, ResolvedServer } from "./types.js"
import {
  contextFor,
  createTypescriptProjects,
  installTypescript,
  writeExecutable,
} from "./typescript-project-test-support.js"

const projects = createTypescriptProjects("lsp-dir-mixed-ts-")
let previousPath: string | undefined

beforeEach(() => {
  previousPath = process.env["PATH"]
  __resetServerBinaryResolutionCacheForTests()
})

afterEach(() => {
  if (previousPath === undefined) delete process.env["PATH"]
  else process.env["PATH"] = previousPath
  projects.cleanup()
  __resetServerBinaryResolutionCacheForTests()
})

interface Acquisition {
  readonly root: string
  readonly command: readonly string[]
  readonly files: string[]
}

function recordingManager() {
  const acquisitions: Acquisition[] = []
  let released = 0
  const manager = {
    async getClient(root: string, server: ResolvedServer) {
      const acquisition: Acquisition = { root, command: server.command, files: [] }
      acquisitions.push(acquisition)
      const client = {
        async diagnostics(filePath: string) {
          acquisition.files.push(filePath)
          const item: Diagnostic = {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: `checked by ${server.command[0]}`,
          }
          return { items: [item] }
        },
      } as Pick<LspClient, "diagnostics"> as LspClient
      return client
    },
    releaseClient() {
      released += 1
    },
  }
  return { manager, acquisitions, released: () => released }
}

function monorepo(): { readonly root: string; readonly packageX: string; readonly packageY: string } {
  const root = projects.makeProject()
  mkdirSync(join(root, ".git"))
  const packageX = join(root, "packages", "x")
  const packageY = join(root, "packages", "y")
  for (const packageDir of [packageX, packageY]) {
    mkdirSync(join(packageDir, "src"), { recursive: true })
    writeFileSync(join(packageDir, "package.json"), "{}\n")
    writeFileSync(join(packageDir, "src", "a.ts"), "export const a = 1\n")
    writeFileSync(join(packageDir, "src", "b.ts"), "export const b = 1\n")
  }
  process.env["PATH"] = join(root, "definitely-empty")
  return { root, packageX, packageY }
}

describe("directory diagnostics across packages on different TypeScript versions", () => {
  test("#given packages on TypeScript 7 and TypeScript 5 #when scanning the repository root #then each package's files go to its own server", async () => {
    // given
    const { root, packageX, packageY } = monorepo()
    const languageServer = writeExecutable(join(root, "node_modules", ".bin", "typescript-language-server"))
    const tscX = installTypescript(join(packageX, "node_modules"), 7)
    installTypescript(join(packageY, "node_modules"), 5)
    const recording = recordingManager()

    // when
    const result = await runWithRequestContext(contextFor(root), () =>
      aggregateDiagnosticsForDirectory(root, ".ts", "all", 50, { manager: recording.manager as never }),
    )

    // then
    expect(result.fileFailures).toEqual([])
    expect(recording.acquisitions).toHaveLength(2)
    const native = recording.acquisitions.find((entry) => entry.command[0] === tscX)
    const wrapped = recording.acquisitions.find((entry) => entry.command.includes(languageServer))
    expect(native?.files.toSorted()).toEqual([join(packageX, "src", "a.ts"), join(packageX, "src", "b.ts")])
    expect(wrapped?.files.toSorted()).toEqual([join(packageY, "src", "a.ts"), join(packageY, "src", "b.ts")])
    expect(recording.released()).toBe(2)
  })

  test("#given a root without a typescript server but a TypeScript 7 package #when scanning the root #then the package is diagnosed and only the unserved files report the missing server", async () => {
    // given
    const { root, packageX, packageY } = monorepo()
    const tscX = installTypescript(join(packageX, "node_modules"), 7)
    const recording = recordingManager()

    // when
    const result = await runWithRequestContext(contextFor(root), () =>
      aggregateDiagnosticsForDirectory(root, ".ts", "all", 50, { manager: recording.manager as never }),
    )

    // then
    expect(recording.acquisitions.map((entry) => entry.command[0])).toEqual([tscX])
    expect(result.totalDiagnostics).toBe(2)
    expect(result.fileFailures.map((failure) => failure.file).toSorted()).toEqual([
      join(packageY, "src", "a.ts"),
      join(packageY, "src", "b.ts"),
    ])
    expect(result.fileFailures.every((failure) => failure.error.includes("NOT INSTALLED"))).toBe(true)
  })
})
