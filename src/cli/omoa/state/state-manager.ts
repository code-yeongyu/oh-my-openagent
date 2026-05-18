import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeConfigDir } from "../../../shared/opencode-config-dir"
import { parseJsonc } from "../../../shared/jsonc-parser"
import { OmoaStateSchema, DEFAULT_OMOA_STATE, type OmoaState } from "./omoa-state-schema"

const OMOA_STATE_FILENAME = "omoa-state.json"

function getStatePath(): string {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  return join(configDir, OMOA_STATE_FILENAME)
}

export function readOmoaState(): OmoaState {
  const path = getStatePath()
  if (!existsSync(path)) return { ...DEFAULT_OMOA_STATE }
  try {
    const content = readFileSync(path, "utf-8")
    const raw = parseJsonc<unknown>(content)
    const parsed = OmoaStateSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    return { ...DEFAULT_OMOA_STATE }
  } catch {
    return { ...DEFAULT_OMOA_STATE }
  }
}

export function writeOmoaState(state: OmoaState): void {
  const path = getStatePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf-8")
}

export function isProviderEnabled(state: OmoaState, provider: string): boolean {
  const entry = state.providers[provider]
  if (!entry) return true
  return entry.enabled
}

export function setProviderEnabled(state: OmoaState, provider: string, enabled: boolean): OmoaState {
  const current = state.providers[provider] ?? { enabled: true, free_only: false, avoid_fallback_from: [] }
  return {
    ...state,
    providers: {
      ...state.providers,
      [provider]: { ...current, enabled },
    },
  }
}

export function getEnabledProviders(state: OmoaState): string[] {
  return Object.entries(state.providers)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name)
}

export function getDisabledProviders(state: OmoaState): string[] {
  return Object.entries(state.providers)
    .filter(([, s]) => !s.enabled)
    .map(([name]) => name)
}
