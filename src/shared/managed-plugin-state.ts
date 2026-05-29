import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CONFIG_BASENAME } from "./plugin-identity"

export interface ManagedPluginState {
  entry: string
  channel: string
}

const MANAGED_PLUGIN_STATE_FILENAME = `${CONFIG_BASENAME}-plugin-state.json`

export function getManagedPluginStatePath(configDir: string): string {
  return join(configDir, MANAGED_PLUGIN_STATE_FILENAME)
}

export function readManagedPluginState(configDir: string): ManagedPluginState | null {
  try {
    const content = readFileSync(getManagedPluginStatePath(configDir), "utf-8")
    const parsed = JSON.parse(content) as Partial<ManagedPluginState> | null
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    if (typeof parsed.entry !== "string" || typeof parsed.channel !== "string") {
      return null
    }
    return {
      entry: parsed.entry,
      channel: parsed.channel,
    }
  } catch {
    return null
  }
}

export function writeManagedPluginState(configDir: string, state: ManagedPluginState): boolean {
  try {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getManagedPluginStatePath(configDir), JSON.stringify(state, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}
