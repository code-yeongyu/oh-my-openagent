import * as fs from "fs"
import { log } from "./logger"

// Migration map: old keys → new keys (for backward compatibility)
export const AGENT_NAME_MAP: Record<string, string> = {
  // Legacy names (backward compatibility)
  omo: "Sisyphus",
  "OmO": "Sisyphus",
  "OmO-Plan": "Planner-Sisyphus",
  "omo-plan": "Planner-Sisyphus",
  // Current names
  sisyphus: "Sisyphus",
  "planner-sisyphus": "Planner-Sisyphus",
  build: "build",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "frontend-ui-ux-engineer": "frontend-ui-ux-engineer",
  "document-writer": "document-writer",
  "multimodal-looker": "multimodal-looker",
}

// Migration map: old hook names → new hook names (for backward compatibility)
export const HOOK_NAME_MAP: Record<string, string> = {
  // Legacy names (backward compatibility)
  "anthropic-auto-compact": "anthropic-context-window-limit-recovery",
}

export function migrateAgentNames(agents: Record<string, unknown>): { migrated: Record<string, unknown>; changed: boolean } {
  const migrated: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(agents)) {
    const newKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key
    if (newKey !== key) {
      changed = true
    }
    migrated[newKey] = value
  }

  return { migrated, changed }
}

export function migrateHookNames(hooks: string[]): { migrated: string[]; changed: boolean } {
  const migrated: string[] = []
  let changed = false

  for (const hook of hooks) {
    const newHook = HOOK_NAME_MAP[hook] ?? hook
    if (newHook !== hook) {
      changed = true
    }
    migrated.push(newHook)
  }

  return { migrated, changed }
}

export function migrateConfigFile(configPath: string, rawConfig: Record<string, unknown>): boolean {
  let needsWrite = false

  if (rawConfig.agents && typeof rawConfig.agents === "object") {
    const { migrated, changed } = migrateAgentNames(rawConfig.agents as Record<string, unknown>)
    if (changed) {
      rawConfig.agents = migrated
      needsWrite = true
    }
  }

  if (rawConfig.omo_agent) {
    rawConfig.sisyphus_agent = rawConfig.omo_agent
    delete rawConfig.omo_agent
    needsWrite = true
  }

  if (rawConfig.disabled_hooks && Array.isArray(rawConfig.disabled_hooks)) {
    const { migrated, changed } = migrateHookNames(rawConfig.disabled_hooks as string[])
    if (changed) {
      rawConfig.disabled_hooks = migrated
      needsWrite = true
    }
  }

  if (needsWrite) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8")
      log(`Migrated config file: ${configPath}`)
    } catch (err) {
      log(`Failed to write migrated config to ${configPath}:`, err)
    }
  }

  return needsWrite
}
