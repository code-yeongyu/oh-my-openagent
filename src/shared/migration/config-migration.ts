import * as fs from "node:fs"
import { log } from "../logger"
import { writeFileAtomically } from "../write-file-atomically"
import { AGENT_NAME_MAP, migrateAgentNames } from "./agent-names"
import { migrateHookNames } from "./hook-names"
import { migrateModelVersions } from "./model-versions"
import { readAppliedMigrations, writeAppliedMigrations } from "./migrations-sidecar"

export function migrateConfigFile(
  configPath: string,
  rawConfig: Record<string, unknown>
): boolean {
  const copy = JSON.parse(JSON.stringify(rawConfig)) as Record<string, unknown>
  let needsWrite = false

  // Load previously applied migrations from BOTH the legacy in-config
  // `_migrations` field AND the external sidecar file. The sidecar is the
  // new source of truth because users were editing the config file to
  // revert auto-migrated values and accidentally dropping the `_migrations`
  // field in the process, which produced an infinite migration loop on
  // every startup (#3263). Reading from both sources keeps old configs
  // that still carry `_migrations` working without a forced reset.
  const sidecarMigrations = readAppliedMigrations(configPath)
  const inConfigMigrations = Array.isArray(copy._migrations)
    ? new Set(copy._migrations as string[])
    : new Set<string>()
  const existingMigrations = new Set<string>([
    ...sidecarMigrations,
    ...inConfigMigrations,
  ])
  const hadLegacyInConfigMigrations = inConfigMigrations.size > 0
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

  // Record newly applied migrations. We persist the full set (existing +
  // new) to the external sidecar file and strip the legacy `_migrations`
  // field from the config body on its way out, so users stop having to
  // think about a field that never should have been in their config in
  // the first place. The in-memory `rawConfig` never re-exposes
  // `_migrations` to downstream schema validation.
  const newMigrationsToRecord = allNewMigrations.filter(mKey => !existingMigrations.has(mKey))
  const fullMigrationSet = new Set<string>([
    ...existingMigrations,
    ...newMigrationsToRecord,
  ])
  const shouldWriteSidecar = newMigrationsToRecord.length > 0 || hadLegacyInConfigMigrations
  if (newMigrationsToRecord.length > 0) {
    needsWrite = true
  }
  if (hadLegacyInConfigMigrations) {
    // Migrating state out of the config body is itself a config write.
    needsWrite = true
  }
  if (shouldWriteSidecar) {
    // Keep `_migrations` in the first config write so a later sidecar failure
    // does not strand the config with migrated state missing from disk.
    ;(copy as Record<string, unknown>)._migrations = Array.from(fullMigrationSet)
    needsWrite = true
  }

  if (copy.omo_agent) {
    copy.sisyphus_agent = copy.omo_agent
    delete copy.omo_agent
    needsWrite = true
  }

  if (copy.experimental && typeof copy.experimental === "object") {
    const experimental = copy.experimental as Record<string, unknown>
    if ("hashline_edit" in experimental) {
      if (copy.hashline_edit === undefined) {
        copy.hashline_edit = experimental.hashline_edit
      }
      delete experimental.hashline_edit
      if (Object.keys(experimental).length === 0) {
        delete copy.experimental
      }
      needsWrite = true
    }
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
    let finalConfig = JSON.parse(JSON.stringify(copy)) as Record<string, unknown>
    const newContent = JSON.stringify(finalConfig, null, 2) + "\n"

    // Compare with existing file content to skip backup when unchanged.
    // The config may still need an in-memory migration even if the file
    // content is identical (e.g. removing a deleted hook from disabled_hooks
    // results in content that was already written by a prior migration).
    let existingContent: string | undefined
    try {
      existingContent = fs.readFileSync(configPath, "utf-8")
    } catch {
      // File may not exist yet
    }
    const contentChanged = existingContent !== newContent

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = `${configPath}.bak.${timestamp}`
    let backupSucceeded = false
    if (contentChanged) {
      try {
        fs.copyFileSync(configPath, backupPath)
        backupSucceeded = true
      } catch {
        backupSucceeded = false
      }
    }

    let writeSucceeded = false
    try {
      writeFileAtomically(configPath, newContent)
      writeSucceeded = true
    } catch (err) {
      log(`Failed to write migrated config to ${configPath}:`, err)
    }

    if (writeSucceeded && shouldWriteSidecar) {
      const sidecarWriteSucceeded = writeAppliedMigrations(configPath, fullMigrationSet)
      if (sidecarWriteSucceeded && "_migrations" in finalConfig) {
        const configWithoutLegacyMigrations = JSON.parse(JSON.stringify(finalConfig)) as Record<string, unknown>
        delete configWithoutLegacyMigrations._migrations
        try {
          writeFileAtomically(configPath, JSON.stringify(configWithoutLegacyMigrations, null, 2) + "\n")
          finalConfig = configWithoutLegacyMigrations
        } catch (err) {
          log(`Failed to remove legacy _migrations fallback from ${configPath}:`, err)
        }
      }
    }

    for (const key of Object.keys(rawConfig)) {
      delete rawConfig[key]
    }
    Object.assign(rawConfig, finalConfig)

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
