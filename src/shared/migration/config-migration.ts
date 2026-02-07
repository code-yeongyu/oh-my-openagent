import * as fs from "fs"
import { log } from "../logger"
import { AGENT_NAME_MAP, migrateAgentNames } from "./agent-names"
import { migrateHookNames } from "./hook-names"
import { migrateModelVersions } from "./model-versions"

export function migrateConfigFile(
  configPath: string,
  rawConfig: Record<string, unknown>
): boolean {
  let needsWrite = false

  // Load previously applied migrations
  const existingMigrations = Array.isArray(rawConfig._migrations)
    ? new Set(rawConfig._migrations as string[])
    : new Set<string>()
  const allNewMigrations: string[] = []

  if (rawConfig.agents && typeof rawConfig.agents === "object") {
    const { migrated, changed } = migrateAgentNames(rawConfig.agents as Record<string, unknown>)
    if (changed) {
      rawConfig.agents = migrated
      needsWrite = true
    }
  }

  // Migrate model versions in agents (skip already-applied migrations)
  if (rawConfig.agents && typeof rawConfig.agents === "object") {
    const { migrated, changed, newMigrations } = migrateModelVersions(
      rawConfig.agents as Record<string, unknown>,
      existingMigrations
    )
    if (changed) {
      rawConfig.agents = migrated
      needsWrite = true
      log("Migrated model versions in agents config")
    }
    allNewMigrations.push(...newMigrations)
  }

  // Migrate model versions in categories (skip already-applied migrations)
  if (rawConfig.categories && typeof rawConfig.categories === "object") {
    const { migrated, changed, newMigrations } = migrateModelVersions(
      rawConfig.categories as Record<string, unknown>,
      existingMigrations
    )
    if (changed) {
      rawConfig.categories = migrated
      needsWrite = true
      log("Migrated model versions in categories config")
    }
    allNewMigrations.push(...newMigrations)
  }

  // Record newly applied migrations
  if (allNewMigrations.length > 0) {
    const updatedMigrations = Array.from(existingMigrations)
    updatedMigrations.push(...allNewMigrations)
    rawConfig._migrations = updatedMigrations
    needsWrite = true
  }

  if (rawConfig.omo_agent) {
    rawConfig.sisyphus_agent = rawConfig.omo_agent
    delete rawConfig.omo_agent
    needsWrite = true
  }

  if (rawConfig.disabled_agents && Array.isArray(rawConfig.disabled_agents)) {
    const migrated: string[] = []
    let changed = false
    for (const agent of rawConfig.disabled_agents as string[]) {
      const newAgent = AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent
      if (newAgent !== agent) {
        changed = true
      }
      migrated.push(newAgent)
    }
    if (changed) {
      rawConfig.disabled_agents = migrated
      needsWrite = true
    }
  }

  if (rawConfig.disabled_hooks && Array.isArray(rawConfig.disabled_hooks)) {
    const { migrated, changed, removed } = migrateHookNames(rawConfig.disabled_hooks as string[])
    if (changed) {
      rawConfig.disabled_hooks = migrated
      needsWrite = true
    }
    if (removed.length > 0) {
      log(
        `Removed obsolete hooks from disabled_hooks: ${removed.join(", ")} (these hooks no longer exist in v3.0.0)`
      )
    }
  }

  if (needsWrite) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const backupPath = `${configPath}.bak.${timestamp}`
      fs.copyFileSync(configPath, backupPath)

      fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8")
      log(`Migrated config file: ${configPath} (backup: ${backupPath})`)
    } catch (err) {
      log(`Failed to write migrated config to ${configPath}:`, err)
    }
  }

  return needsWrite
}
