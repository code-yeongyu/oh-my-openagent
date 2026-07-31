import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { executeLegacyConfigMigrationPlan } from "./index"

describe("executeLegacyConfigMigrationPlan", () => {
  test("#given a plan whose predicate is false #when executing #then creates no directories or files", () => {
    // given
    const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-migration-executor-"))
    const homeDir = join(fixtureRoot, "home")
    const sourcePath = join(fixtureRoot, "legacy", "config.jsonc")
    const targetPath = join(homeDir, ".omo", "omo.jsonc")
    const backupPath = join(fixtureRoot, "backup", "config.jsonc")
    mkdirSync(join(sourcePath, ".."), { recursive: true })
    mkdirSync(join(targetPath, ".."), { recursive: true })
    writeFileSync(sourcePath, "{}")
    writeFileSync(targetPath, '{"_migrations":["already-migrated"]}')
    const entriesBefore = readdirSync(fixtureRoot, { recursive: true }).sort()

    try {
      // when
      const result = executeLegacyConfigMigrationPlan({
        id: "already-migrated",
        inspect: () => ({ diagnostics: [], document: {} }),
        sources: [{ backupPath, path: sourcePath }],
        targetPath,
        transform: () => ({}),
      }, { env: { HOME: homeDir } })

      // then
      expect(result.status).toBe("skipped")
      expect(existsSync(join(backupPath, ".."))).toBe(false)
      expect(readdirSync(fixtureRoot, { recursive: true }).sort()).toEqual(entriesBefore)
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true })
    }
  })
})
