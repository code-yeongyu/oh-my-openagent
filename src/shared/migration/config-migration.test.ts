/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { migrateConfigFile } from "./config-migration"
import { getSidecarPath } from "./migrations-sidecar"

const createdDirectories: string[] = []
const MIGRATION_KEY = "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6"

function createWorkdir(): string {
  const workdir = mkdtempSync(join(tmpdir(), "omo-config-migration-"))
  createdDirectories.push(workdir)
  return workdir
}

function createLegacyConfig(): Record<string, unknown> {
  return {
    agents: {
      prometheus: { model: "anthropic/claude-opus-4-5" },
    },
  }
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("migrateConfigFile sidecar write ordering", () => {
  test("writes the migrated config before recording the sidecar when both writes succeed", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = createLegacyConfig()

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then
    expect(needsWrite).toBe(true)
    expect(rawConfig._migrations).toBeUndefined()
    expect((rawConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-6",
    )

    const persistedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(persistedConfig._migrations).toBeUndefined()
    expect((persistedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-6",
    )

    const sidecar = JSON.parse(readFileSync(getSidecarPath(configPath), "utf-8")) as {
      appliedMigrations: string[]
    }
    expect(sidecar.appliedMigrations).toEqual([MIGRATION_KEY])
  })

  test("skips the sidecar when the config write fails so the migration retries on next startup", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "missing-parent", "oh-my-opencode.json")
    const firstAttemptConfig = createLegacyConfig()

    // when
    const firstAttemptNeedsWrite = migrateConfigFile(configPath, firstAttemptConfig)

    // then
    expect(firstAttemptNeedsWrite).toBe(true)
    expect(existsSync(getSidecarPath(configPath))).toBe(false)
    expect(firstAttemptConfig._migrations).toEqual([MIGRATION_KEY])

    // given
    mkdirSync(join(workdir, "missing-parent"), { recursive: true })
    writeFileSync(configPath, JSON.stringify(createLegacyConfig(), null, 2) + "\n")
    const retriedConfig = createLegacyConfig()

    // when
    const retriedNeedsWrite = migrateConfigFile(configPath, retriedConfig)

    // then
    expect(retriedNeedsWrite).toBe(true)
    expect(retriedConfig._migrations).toBeUndefined()
    expect((retriedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-6",
    )
    expect(existsSync(getSidecarPath(configPath))).toBe(true)
  })

  test("preserves _migrations in the config when the sidecar write fails after the config write succeeds", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = createLegacyConfig()

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")
    mkdirSync(getSidecarPath(configPath))

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then
    expect(needsWrite).toBe(true)
    expect(rawConfig._migrations).toEqual([MIGRATION_KEY])
    expect((rawConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-6",
    )

    const persistedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(persistedConfig._migrations).toEqual([MIGRATION_KEY])
    expect((persistedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-6",
    )
    expect(statSync(getSidecarPath(configPath)).isDirectory()).toBe(true)
  })
})

describe("migrateConfigFile backup skipping", () => {
  test("skips backup when file content is identical after migration", () => {
    // given - config with legacy key that migrates to same on-disk content
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const migratedContent = {
      disabled_hooks: ["comment-checker"],
    }

    // Write the already-migrated content to disk
    writeFileSync(configPath, JSON.stringify(migratedContent, null, 2) + "\n")

    // rawConfig still has the legacy hook that will be removed
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: ["gpt-permission-continuation", "comment-checker"],
    }

    // when
    migrateConfigFile(configPath, rawConfig)

    // then - no backup file should be created since file content is unchanged
    const files = require("fs").readdirSync(workdir) as string[]
    const backupFiles = files.filter((f: string) => f.includes(".bak."))
    expect(backupFiles.length).toBe(0)
  })

  test("creates backup when file content actually changes", () => {
    // given - config with model that needs migration
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = {
      agents: {
        prometheus: { model: "anthropic/claude-opus-4-5" },
      },
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig as Record<string, unknown>)

    // then - backup should be created since content changed
    expect(needsWrite).toBe(true)
    const files = require("fs").readdirSync(workdir) as string[]
    const backupFiles = files.filter((f: string) => f.includes(".bak."))
    expect(backupFiles.length).toBe(1)
  })
})
