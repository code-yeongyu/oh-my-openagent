import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { readJsoncFile } from "@oh-my-opencode/utils"

import type { WidenedWindow } from "./windows"

const CONTEXT_WINDOW_KEY = "contextWindow"

export type ModelOverride = Record<string, unknown>
export type ModelsJson = {
  providers?: Record<string, { modelOverrides?: Record<string, ModelOverride> }>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function modelsJsonPath(agentDir: string): string {
  return join(agentDir, "models.json")
}

export function readModelsJsonConfig(path: string): ModelsJson {
  const parsed = asRecord(readJsoncFile<unknown>(path))
  return parsed === undefined ? {} : (parsed as ModelsJson)
}

export async function writeModelsJsonConfig(path: string, config: ModelsJson): Promise<void> {
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

export function applyContextWindowOverrides(
  config: ModelsJson,
  providerId: string,
  widened: readonly WidenedWindow[],
): ModelsJson {
  const providers = { ...config.providers }
  const provider = { ...providers[providerId] }
  const overrides = { ...provider.modelOverrides }

  for (const window of widened) {
    overrides[window.id] = { ...overrides[window.id], [CONTEXT_WINDOW_KEY]: window.to }
  }

  provider.modelOverrides = overrides
  providers[providerId] = provider
  return { ...config, providers }
}

export function contextWindowOverrideIds(config: ModelsJson, providerId: string): string[] {
  const overrides = config.providers?.[providerId]?.modelOverrides
  if (overrides === undefined) return []
  return Object.entries(overrides)
    .filter(([, override]) => CONTEXT_WINDOW_KEY in override)
    .map(([id]) => id)
}

export function clearContextWindowOverrides(
  config: ModelsJson,
  providerId: string,
): { config: ModelsJson; cleared: string[] } {
  const providers = { ...config.providers }
  const provider = providers[providerId]
  if (provider?.modelOverrides === undefined) return { config, cleared: [] }

  const overrides: Record<string, ModelOverride> = {}
  const cleared: string[] = []
  for (const [id, override] of Object.entries(provider.modelOverrides)) {
    const { [CONTEXT_WINDOW_KEY]: _removed, ...rest } = override
    if (CONTEXT_WINDOW_KEY in override) cleared.push(id)
    if (Object.keys(rest).length > 0) overrides[id] = rest
  }

  const nextProviders = { ...providers }
  if (Object.keys(overrides).length === 0) {
    const { modelOverrides: _dropped, ...rest } = provider
    if (Object.keys(rest).length === 0) delete nextProviders[providerId]
    else nextProviders[providerId] = rest
  } else {
    nextProviders[providerId] = { ...provider, modelOverrides: overrides }
  }

  const nextConfig: ModelsJson = { ...config, providers: nextProviders }
  return { config: nextConfig, cleared }
}
