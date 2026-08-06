/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { delimiter, join, posix, win32 } from "node:path"
import type { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import {
  buildPathWithBinaryFirst,
  collectCandidateBinaryPaths,
  canExecuteBinary,
  findWorkingOpencodeBinary,
  withWorkingOpencodePath,
} from "./opencode-binary-resolver"

const RESOLVER_SOURCE = join(import.meta.dir, "opencode-binary-resolver.ts")

describe("collectCandidateBinaryPaths", () => {
  it("uses a node-safe default which resolver instead of raw Bun.which", () => {
    // given
    const source = readFileSync(RESOLVER_SOURCE, "utf8")

    // when
    const usesRawDefaultBunWhich = source.includes("= Bun.which")

    // then
    expect(usesRawDefaultBunWhich).toBe(false)
  })

  it("includes Bun.which results first and removes duplicates", () => {
    // given
    const pathEnv = ["/bad", "/good"].join(posix.delimiter)
    const which = (command: string): string | undefined => {
      if (command === "opencode") return "/bad/opencode"
      return undefined
    }

    // when
    const candidates = collectCandidateBinaryPaths(pathEnv, which, "darwin")

    // then
    expect(candidates[0]).toBe("/bad/opencode")
    expect(candidates).toContain("/good/opencode")
    expect(candidates.filter((candidate) => candidate === "/bad/opencode")).toHaveLength(1)
  })

  it("uses target Windows PATH rules when the target platform is Windows", () => {
    // given
    const pathEnv = ["C:\\bad", "C:\\good"].join(win32.delimiter)
    const which = (): undefined => undefined

    // when
    const candidates = collectCandidateBinaryPaths(pathEnv, which, "win32")

    // then
    expect(candidates).toContain(win32.join("C:\\good", "opencode.exe"))
  })
})

describe("findWorkingOpencodeBinary", () => {
  it("returns the first runnable candidate", async () => {
    // given
    const pathEnv = ["/bad", "/good"].join(posix.delimiter)
    const which = (command: string): string | undefined => {
      if (command === "opencode") return "/bad/opencode"
      return undefined
    }
    const probe = async (binaryPath: string): Promise<boolean> =>
      binaryPath === "/good/opencode"

    // when
    const resolved = await findWorkingOpencodeBinary(pathEnv, probe, which, "darwin")

    // then
    expect(resolved).toBe("/good/opencode")
  })
})

describe("canExecuteBinary", () => {
  it("returns false when a binary probe cannot spawn the candidate", async () => {
    // given
    const binaryPath = join("/definitely-missing", "opencode")
    const spawn = (): ReturnType<typeof spawnWithWindowsHide> => {
      throw new Error("spawn failed")
    }

    // when
    const canExecute = await canExecuteBinary(binaryPath, spawn)

    // then
    expect(canExecute).toBe(false)
  })
})

describe("buildPathWithBinaryFirst", () => {
  it("prepends the binary directory and avoids duplicate entries", () => {
    // given
    const binaryPath = "/good/opencode"
    const pathEnv = ["/bad", "/good", "/other"].join(delimiter)

    // when
    const updated = buildPathWithBinaryFirst(pathEnv, binaryPath)

    // then
    expect(updated).toBe(["/good", "/bad", "/other"].join(delimiter))
  })
})

describe("withWorkingOpencodePath", () => {
  it("temporarily updates PATH while starting the server", async () => {
    // given
    const originalPath = process.env.PATH
    process.env.PATH = ["/bad", "/other"].join(delimiter)
    const finder = async (): Promise<string | null> => "/good/opencode"
    let observedPath = ""

    // when
    await withWorkingOpencodePath(
      async () => {
        observedPath = process.env.PATH ?? ""
      },
      finder,
    )

    // then
    expect(observedPath).toBe(["/good", "/bad", "/other"].join(delimiter))
    expect(process.env.PATH).toBe(["/bad", "/other"].join(delimiter))
    process.env.PATH = originalPath
  })

  it("restores PATH when server startup fails", async () => {
    // given
    const originalPath = process.env.PATH
    process.env.PATH = ["/bad", "/other"].join(delimiter)
    const finder = async (): Promise<string | null> => join("/good", "opencode")

    // when
    let thrown: Error | undefined
    try {
      await withWorkingOpencodePath(
        async () => {
          throw new Error("boom")
        },
        finder,
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      thrown = error
    }

    // then
    expect(thrown?.message).toBe("boom")
    expect(process.env.PATH).toBe(["/bad", "/other"].join(delimiter))
    process.env.PATH = originalPath
  })
})
