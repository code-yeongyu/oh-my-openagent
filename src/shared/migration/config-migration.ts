import * as fs from "fs"
import { log } from "../logger"
import { AGENT_NAME_MAP, migrateAgentNames } from "./agent-names"
import { migrateHookNames } from "./hook-names"
import { migrateModelVersions } from "./model-versions"

export function migrateConfigFile(
  configPath: string,
  rawConfig: Record<string, unknown>
): boolean {
  const copy = structuredClone(rawConfig)
  let needsWrite = false

  // Load previously applied migrations
  const existingMigrations = Array.isArray(copy._migrations)
    ? new Set(copy._migrations as string[])
    : new Set<string>()
  const allNewMigrations: string[] = []

  if (copy.agents && typeof copy.agents === "object") {
    const { migrated, changed } = migrateAgentNames(copy.agents as Record<string, unknown>)
    if (changed) {
      copy.agents = migrated
      needsWrite = true
    }
  }

  // Migrate model versions in agents (skip already-applied migrations)
  if (copy.agents && typeof copy.agents === "object") {
    const { migrated, changed, newMigrations } = migrateModelVersions(
      copy.agents as Record<string, unknown>,
      existingMigrations
    )
    if (changed) {
      copy.agents = migrated
      needsWrite = true
      log("Migrated model versions in agents config")
    }
    allNewMigrations.push(...newMigrations)
  }

  // Migrate model versions in categories (skip already-applied migrations)
  if (copy.categories && typeof copy.categories === "object") {
    const { migrated, changed, newMigrations } = migrateModelVersions(
      copy.categories as Record<string, unknown>,
      existingMigrations
    )
    if (changed) {
      copy.categories = migrated
      needsWrite = true
      log("Migrated model versions in categories config")
    }
    allNewMigrations.push(...newMigrations)
  }

  // Record newly applied migrations
  if (allNewMigrations.length > 0) {
    const updatedMigrations = Array.from(existingMigrations)
    updatedMigrations.push(...allNewMigrations)
    copy._migrations = updatedMigrations
    needsWrite = true
  }

  if (copy.omo_agent) {
    copy.sisyphus_agent = copy.omo_agent
    delete copy.omo_agent
    needsWrite = true
  }

  if (copy.disabled_agents && Array.isArray(copy.disabled_agents)) {
    const migrated: string[] = []
    let changed = false
    for (const agent of copy.disabled_agents as string[]) {
      const newAgent = AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent
      if (newAgent !== agent) {
        changed = true
      }
      migrated.push(newAgent)
    }
    if (changed) {
      copy.disabled_agents = migrated
      needsWrite = true
    }
  }

  if (copy.disabled_hooks && Array.isArray(copy.disabled_hooks)) {
    const { migrated, changed, removed } = migrateHookNames(copy.disabled_hooks as string[])
    if (changed) {
      copy.disabled_hooks = migrated
      needsWrite = true
    }
    if (removed.length > 0) {
      log(
        `Removed obsolete hooks from disabled_hooks: ${removed.join(", ")} (these hooks no longer exist in v3.0.0)`
      )
    }
  }

  if (needsWrite) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = `${configPath}.bak.${timestamp}`
    let backupSucceeded = false
    try {
      fs.copyFileSync(configPath, backupPath)
      backupSucceeded = true
    } catch {
      // Original file may not exist yet — skip backup
    }

    let writeSucceeded = false
    try {
      fs.writeFileSync(configPath, JSON.stringify(copy, null, 2) + "\n", "utf-8")
      writeSucceeded = true
    } catch (err) {
      log(`Failed to write migrated config to ${configPath}:`, err)
    }

    for (const key of Object.keys(rawConfig)) {
      delete rawConfig[key]
    }
    Object.assign(rawConfig, copy)

    if (writeSucceeded) {
      const backupMessage = backupSucceeded ? ` (backup: ${backupPath})` : ""
      log(`Migrated config file: ${configPath}${backupMessage}`)
    } else {
      const backupMessage = backupSucceeded ? ` (backup: ${backupPath})` : ""
      log(`Applied migrated config in-memory for: ${configPath}${backupMessage}`)
    }
  }

  return needsWrite
}
