import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import { legacyConfigLeftoverWarning, findLegacyConfigLeftovers } from "./legacy-config-leftovers"

const fixtures: string[] = []

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("legacy config leftovers doctor warning", () => {
  test("#given a legacy OpenCode config #when doctor collects migration leftovers #then it emits a warning with the migrate command hint", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-doctor-legacy-config-"))
    fixtures.push(root)
    const homeDir = join(root, "home")
    const sourcePath = join(homeDir, ".config", "opencode", "oh-my-openagent.json")
    mkdirSync(join(homeDir, ".config", "opencode"), { recursive: true })
    writeFileSync(sourcePath, "{}")

    // when
    const leftovers = findLegacyConfigLeftovers({
      cwd: root,
      environment: { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") },
      homeDir,
      pathOperations: posix,
    })
    const warning = legacyConfigLeftoverWarning(leftovers)

    // then
    expect(leftovers).toHaveLength(1)
    expect(leftovers[0]).toEndWith(join(".config", "opencode", "oh-my-openagent.json"))
    expect(warning).toMatchObject({
      severity: "warning",
      fix: expect.stringContaining("oh-my-openagent config migrate"),
    })
  })
})
