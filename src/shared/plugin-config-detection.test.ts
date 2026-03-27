import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { detectPluginConfigFile } from "./jsonc-parser"

describe("detectPluginConfigFile - canonical config detection", () => {
  const testDir = join(__dirname, ".test-detect-plugin-canonical")

  test("detects oh-my-openagent config when no legacy config exists", () => {
    //#given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, "oh-my-openagent.jsonc"), "{}")

    //#when
    const result = detectPluginConfigFile(testDir)

    //#then
    expect(result.format).toBe("jsonc")
    expect(result.path).toBe(join(testDir, "oh-my-openagent.jsonc"))

    rmSync(testDir, { recursive: true, force: true })
  })
})
