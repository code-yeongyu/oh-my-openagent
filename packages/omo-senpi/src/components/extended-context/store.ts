import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { readJsoncFile } from "@oh-my-opencode/utils"

import type { WidenedWindow } from "./windows"

const CONTEXT_WINDOW_KEY = "contextWindow"
const RECORD_FILE = "extended-context.json"
const RECORD_VERSION = 1

export type ModelOverride = Record<string, unknown>
export type ModelsJson = {
  providers?: Record<string, Record<string, unknown> & { modelOverrides?: Record<string, ModelOverride> }>
}

/** Which windows this command wrote, so restoring never touches an override the user set. */
export type WrittenWindows = Record<string, number>

export type ModelsJsonRead =
  | { readonly kind: "missing"; readonly config: ModelsJson }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly config: ModelsJson }

export function modelsJsonPath(agentDir: string): string {
  return join(agentDir, "models.json")
}

export function recordPath(agentDir: string): string {
  return join(agentDir, RECORD_FILE)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function readModelsJsonConfig(path: string, exists: boolean): ModelsJsonRead {
  const parsed = asRecord(readJsoncFile<unknown>(path))
  if (parsed !== undefined) return { kind: "ok", config: parsed as ModelsJson }
  return exists ? { kind: "invalid" } : { kind: "missing", config: {} }
}

export async function writeModelsJsonConfig(path: string, config: ModelsJson): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}

export async function readWrittenWindows(path: string): Promise<WrittenWindows> {
  const parsed = asRecord(await readFile(path, "utf8").then(
    (text) => JSON.parse(text) as unknown,
    () => undefined,
  ))
  const windows = asRecord(parsed?.windows)
  if (parsed?.version !== RECORD_VERSION || typeof parsed?.provider !== "string" || windows === undefined) {
    return {}
  }
  const written: WrittenWindows = {}
  for (const [id, value] of Object.entries(windows)) {
    if (typeof value === "number" && Number.isSafeInteger(value)) written[id] = value
  }
  return written
}

export async function writeWrittenWindows(
  path: string,
  providerId: string,
  windows: WrittenWindows,
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  const record = { version: RECORD_VERSION, provider: providerId, windows }
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}

export async function clearWrittenWindows(path: string): Promise<void> {
  await rm(path, { force: true })
}

export function applyContextWindowOverrides(
  config: ModelsJson,
  providerId: string,
  widened: readonly WidenedWindow[],
): { config: ModelsJson; written: WrittenWindows } {
  const providers = { ...config.providers }
  const provider = { ...providers[providerId] }
  const overrides = { ...provider.modelOverrides }
  const written: WrittenWindows = {}

  for (const window of widened) {
    overrides[window.id] = { ...overrides[window.id], [CONTEXT_WINDOW_KEY]: window.to }
    written[window.id] = window.to
  }

  provider.modelOverrides = overrides
  providers[providerId] = provider
  return { config: { ...config, providers }, written }
}

const PROVIDER_FIELDS = ["baseUrl", "headers", "apiKey", "api", "models", "modelOverrides", "compat", "authHeader"]

function providerIsEmpty(provider: Record<string, unknown>): boolean {
  return PROVIDER_FIELDS.every((field) => provider[field] === undefined)
}

export function clearContextWindowOverrides(
  config: ModelsJson,
  providerId: string,
  written: WrittenWindows,
): { config: ModelsJson; cleared: string[] } {
  const providers = { ...config.providers }
  const provider = providers[providerId]
  const overrides = provider?.modelOverrides
  if (provider === undefined || overrides === undefined) return { config, cleared: [] }

  const nextOverrides: Record<string, ModelOverride> = {}
  const cleared: string[] = []
  for (const [id, override] of Object.entries(overrides)) {
    const recoredValue = written[id]
    const matchesWritten = recoredValue !== undefined && override[CONTEXT_WINDOW_KEY] === recoredValue
    if (!matchesWritten) {
      nextOverrides[id] = override
      continue
    }
    const { [CONTEXT_WINDOW_KEY]: _removed, ...rest } = override
    cleared.push(id)
    if (Object.keys(rest).length > 0) nextOverrides[id] = rest
  }

  const nextProvider = { ...provider }
  if (Object.keys(nextOverrides).length === 0) delete nextProvider.modelOverrides
  else nextProvider.modelOverrides = nextOverrides

  const nextProviders = { ...providers }
  if (providerIsEmpty(nextProvider)) delete nextProviders[providerId]
  else nextProviders[providerId] = nextProvider

  return { config: { ...config, providers: nextProviders }, cleared }
}
