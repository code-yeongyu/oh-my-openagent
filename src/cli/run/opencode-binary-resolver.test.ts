import { describe, expect, it } from "bun:test"
import { delimiter, join } from "node:path"
import {
  buildPathWithBinaryFirst,
  collectCandidateBinaryPaths,
  findWorkingOpencodeBinary,
  withWorkingOpencodePath,
} from "./opencode-binary-resolver"

describe("collectCandidateBinaryPaths", () => {
  it("includes Bun.which results first and removes duplicates", () => {
    // given
    const pathEnv = ["/bad", "/good"].join(delimiter)
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
})

describe("findWorkingOpencodeBinary", () => {
  it("returns the first runnable candidate", async () => {
    // given
    const pathEnv = ["/bad", "/good"].join(delimiter)
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

    // when & then
    await expect(
      withWorkingOpencodePath(
        async () => {
          throw new Error("boom")
        },
        finder,
      ),
    ).rejects.toThrow("boom")
    expect(process.env.PATH).toBe(["/bad", "/other"].join(delimiter))
    process.env.PATH = originalPath
  })
})
