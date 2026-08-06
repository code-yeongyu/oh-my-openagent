import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import { parse } from "jsonc-parser"

import {
  CONFIG_JSONC_MIGRATION_ID,
  OPENCODE_CONFIG_MIGRATION_ID,
  createLegacyConfigMigrationPlans,
  executeLegacyConfigMigrationPlan,
} from "./index"

describe("legacy config migration plans", () => {
  test("#given user, profile, config.jsonc, project, and sidecar fixtures #when planning and executing #then distinct group markers and exact backup destinations preserve every source", () => {
    // given
    const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-config-migration-plan-"))
    const homeDir = join(fixtureRoot, "home")
    const projectDir = join(fixtureRoot, "project")
    const rootPath = join(homeDir, ".config", "opencode", "oh-my-openagent.jsonc")
    const sidecarPath = `${rootPath}.migrations.json`
    const profilePath = join(homeDir, ".config", "opencode", "profiles", "kimi", "oh-my-openagent.jsonc")
    const configJsoncPath = join(homeDir, ".omo", "config.jsonc")
    const configSidecarPath = `${configJsoncPath}.migrations.json`
    const projectPath = join(projectDir, ".opencode", "oh-my-opencode.json")
    const timestamp = "2026-07-27T12-34-56-789Z"
    for (const path of [rootPath, profilePath, configJsoncPath, projectPath]) {
      mkdirSync(join(path, ".."), { recursive: true })
    }
    writeFileSync(rootPath, JSON.stringify({ agents: { oracle: { model: "reverted-old-model" } } }))
    writeFileSync(sidecarPath, JSON.stringify({ appliedMigrations: ["model-version:reverted-old-model->new-model"] }))
    writeFileSync(profilePath, JSON.stringify({ agents: { oracle: { model: "kimi-model" } } }))
    writeFileSync(configJsoncPath, JSON.stringify({ codegraph: { excluded_roots: ["/generated"] } }))
    writeFileSync(configSidecarPath, JSON.stringify({ appliedMigrations: ["legacy-config-jsonc"] }))
    writeFileSync(projectPath, JSON.stringify({ agents: { oracle: { model: "project-model" } } }))
    writeFileSync(`${rootPath}.bak.unrelated`, "keep")
    const canonicalHomeDir = realpathSync(homeDir)
    const canonicalProjectDir = realpathSync(projectDir)
    const canonicalRootPath = realpathSync(rootPath)
    const canonicalConfigJsoncPath = realpathSync(configJsoncPath)

    try {
      // when
      const plans = createLegacyConfigMigrationPlans({
        backupTimestamp: timestamp,
        cwd: projectDir,
        environment: { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") },
        homeDir,
        pathOperations: posix,
        platform: "linux",
      })
      const opencodeUserPlan = plans.find((plan) =>
        plan.id === OPENCODE_CONFIG_MIGRATION_ID && plan.sources.some((source) => source.path === canonicalRootPath))
      const configJsoncPlan = plans.find((plan) =>
        plan.id === CONFIG_JSONC_MIGRATION_ID && plan.sources.some((source) => source.path === canonicalConfigJsoncPath))
      const projectPlan = plans.find((plan) =>
        plan.id === OPENCODE_CONFIG_MIGRATION_ID && plan.sources.some((source) => source.path.endsWith("oh-my-opencode.json")))
      if (opencodeUserPlan === undefined || configJsoncPlan === undefined || projectPlan === undefined) {
        throw new Error("Expected user, config.jsonc, and project migration plans")
      }
      const configResult = executeLegacyConfigMigrationPlan(configJsoncPlan, { env: { HOME: homeDir } })
      const opencodeResult = executeLegacyConfigMigrationPlan(opencodeUserPlan, { env: { HOME: homeDir } })
      const projectResult = executeLegacyConfigMigrationPlan(projectPlan, { env: { HOME: homeDir } })

      // then
      expect(configResult.status).toBe("migrated")
      expect(opencodeResult.status).toBe("migrated")
      expect(projectResult.status).toBe("migrated")
      const userDocument = parse(readFileSync(join(homeDir, ".omo", "omo.jsonc"), "utf-8")) as Record<string, unknown>
      expect(userDocument._migrations).toEqual([
        CONFIG_JSONC_MIGRATION_ID,
        OPENCODE_CONFIG_MIGRATION_ID,
      ])
      expect(userDocument["[opencode]"]).toEqual({ agents: { oracle: { model: "reverted-old-model" } } })
      expect(userDocument.legacy_migrations).toMatchObject({
        [canonicalRootPath]: ["model-version:reverted-old-model->new-model"],
        [canonicalConfigJsoncPath]: ["legacy-config-jsonc"],
      })
      expect(opencodeUserPlan.sources.map((source) => source.backupPath)).toEqual([
        join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".config", "opencode", "oh-my-openagent.jsonc"),
        join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".config", "opencode", "oh-my-openagent.jsonc.migrations.json"),
        join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".config", "opencode", "profiles", "kimi", "oh-my-openagent.jsonc"),
      ])
      expect(configJsoncPlan.sources.map((source) => source.backupPath)).toEqual([
        join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".omo", "config.jsonc"),
        join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".omo", "config.jsonc.migrations.json"),
      ])
      expect(projectPlan.sources.map((source) => source.backupPath)).toEqual([
        join(canonicalProjectDir, ".omo", `migration-backup-${timestamp}`, "oh-my-opencode.json"),
      ])
      expect(existsSync(join(canonicalHomeDir, ".omo", `migration-backup-${timestamp}-opencode-config`, ".config", "opencode", "oh-my-openagent.jsonc"))).toBe(true)
      expect(existsSync(join(canonicalProjectDir, ".omo", `migration-backup-${timestamp}`, "oh-my-opencode.json"))).toBe(true)
      expect(existsSync(`${rootPath}.bak.unrelated`)).toBe(true)
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true })
    }
  })

  test("#given overlapping legacy [omo] and [senpi] blocks #when previewing and migrating config.jsonc #then both results report the transform conflict", () => {
    // given
    const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-config-migration-diagnostics-"))
    const homeDir = join(fixtureRoot, "home")
    const configJsoncPath = join(homeDir, ".omo", "config.jsonc")
    mkdirSync(join(configJsoncPath, ".."), { recursive: true })
    writeFileSync(configJsoncPath, JSON.stringify({
      "[omo]": { agents: { oracle: { model: "legacy" } } },
      "[senpi]": { agents: { oracle: { model: "current" } } },
    }))

    try {
      const plans = createLegacyConfigMigrationPlans({
        backupTimestamp: "2026-07-27T12-34-56-789Z",
        cwd: homeDir,
        environment: { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") },
        homeDir,
        pathOperations: posix,
        platform: "linux",
      })
      const plan = plans.find((candidate) => candidate.id === CONFIG_JSONC_MIGRATION_ID)
      if (plan === undefined) throw new Error("Expected config.jsonc migration plan")

      // when
      const dryRun = executeLegacyConfigMigrationPlan(plan, { dryRun: true, env: { HOME: homeDir } })
      const migrated = executeLegacyConfigMigrationPlan(plan, { env: { HOME: homeDir } })

      // then
      expect(dryRun.diagnostics).toContain("conflict: [senpi] legacy [omo] kept [senpi]")
      expect(migrated.diagnostics).toContain("conflict: [senpi] legacy [omo] kept [senpi]")
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true })
    }
  })
})
