import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const UTILS_SRC = join(import.meta.dir, "..")

/**
 * `@oh-my-opencode/omo-config-core` owns `resolveOmoConfigPaths` for the `omo.jsonc`
 * surface. The codegraph/harness loader here resolves a different file (`config.jsonc`)
 * with a different scope vocabulary, so re-exporting its same-named helpers from the
 * utils barrel put two different contracts behind one import name.
 */
function barrelExports(): readonly string[] {
  return readFileSync(join(UTILS_SRC, "index.ts"), "utf-8")
    .split("\n")
    .filter((line) => line.startsWith("export"))
}

describe("omo config resolver name collision", () => {
  test("#given the utils barrel #when inspected #then it does not re-export the core-owned resolver module", () => {
    // given
    const exports = barrelExports()

    // when
    const resolveReexport = exports.filter((line) => line.includes("./omo-config/resolve"))

    // then
    expect(resolveReexport).toEqual([])
  })

  test("#given the harness config loader #when loading a legacy config #then it still resolves its own candidates internally", async () => {
    // given
    const { loadOmoConfig } = await import("./loader")
    const homeDir = join(tmpdir(), `omo-collision-${crypto.randomUUID()}`)
    const cwd = join(homeDir, "repo")
    mkdirSync(join(homeDir, ".omo"), { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(homeDir, ".omo", "config.jsonc"), `{"codegraph":{"telemetry":true}}`)

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.config.codegraph?.telemetry).toBe(true)
      expect(result.sources.some((source) => source.scope === "global" && source.loaded)).toBe(true)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})
