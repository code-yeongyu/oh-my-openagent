import { describe, expect, it } from "bun:test"
import { runSg, type SpawnResult } from "./runner"

const runOptions = {
  pattern: "console.log($$$)",
  lang: "typescript",
} as const

describe("ast-grep core runner", () => {
  it("#given resolver cannot find sg #when runSg resolves binary #then returns install guidance", async () => {
    // given
    const noEntryError = new Error("ENOENT: ast-grep binary not found")
    Reflect.set(noEntryError, "code", "ENOENT")

    // when
    const result = await runSg(runOptions, {
      resolveBinary: async () => {
        throw noEntryError
      },
      spawnProcess: async () => successfulEmptySearch,
    })

    // then
    expect(result).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: false,
      error:
        "ast-grep (sg) binary not found.\n\nInstall options:\n  bun add -D @ast-grep/cli\n  cargo install ast-grep --locked\n  brew install ast-grep",
    })
  })

  it("#given spawn cannot find sg #when runSg executes search #then returns install guidance", async () => {
    // given
    const noEntryError = new Error("spawn sg ENOENT")
    Reflect.set(noEntryError, "code", "ENOENT")

    // when
    const result = await runSg(runOptions, {
      resolveBinary: async () => "sg",
      spawnProcess: async () => {
        throw noEntryError
      },
    })

    // then
    expect(result).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: false,
      error:
        "ast-grep (sg) binary not found.\n\nInstall options:\n  bun add -D @ast-grep/cli\n  cargo install ast-grep --locked\n  brew install ast-grep",
    })
  })

  it("#given spawn times out #when runSg executes search #then returns timeout truncation", async () => {
    // given
    const timeoutError = new Error("Process timeout after 30000ms")

    // when
    const result = await runSg(runOptions, {
      resolveBinary: async () => "sg",
      spawnProcess: async () => {
        throw timeoutError
      },
    })

    // then
    expect(result).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: true,
      truncatedReason: "timeout",
      error: "Process timeout after 30000ms",
    })
  })

  it("#given sg returns compact JSON #when runSg executes search #then parses matches", async () => {
    // given
    const stdout = JSON.stringify([
      {
        text: "console.log('hello')",
        file: "src/app.ts",
        range: {
          byteOffset: { start: 0, end: 20 },
          start: { line: 1, column: 1 },
          end: { line: 1, column: 21 },
        },
        lines: "console.log('hello')",
        charCount: 20,
        language: "TypeScript",
      },
    ])

    // when
    const result = await runSg(runOptions, {
      resolveBinary: async () => "sg",
      spawnProcess: async () => ({ stdout, stderr: "", exitCode: 0 }),
    })

    // then
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.file).toBe("src/app.ts")
    expect(result.totalMatches).toBe(1)
    expect(result.truncated).toBe(false)
  })
})

const successfulEmptySearch: SpawnResult = {
  stdout: "[]",
  stderr: "",
  exitCode: 0,
}
