import { readFileSync, statSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import { applyEdits, createScanner, isPlainRecord, modify, parseJsonc, readJsoncFile, SyntaxKind, writeFileAtomically } from "@oh-my-opencode/utils"

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

export function readModelsJsonConfig(path: string, exists: boolean): ModelsJsonRead {
  const parsed = readJsoncFile<unknown>(path)
  if (isPlainRecord(parsed)) {
    if (parsed.providers !== undefined && !isPlainRecord(parsed.providers)) return { kind: "invalid" }
    const providers = parsed.providers
    if (isPlainRecord(providers)) {
      for (const provider of Object.values(providers)) {
        if (!isPlainRecord(provider)) return { kind: "invalid" }
        if (provider.modelOverrides !== undefined && !isPlainRecord(provider.modelOverrides)) return { kind: "invalid" }
        if (isPlainRecord(provider.modelOverrides) && Object.values(provider.modelOverrides).some((value) => !isPlainRecord(value))) {
          return { kind: "invalid" }
        }
      }
    }
    return { kind: "ok", config: parsed as ModelsJson }
  }
  return exists ? { kind: "invalid" } : { kind: "missing", config: {} }
}

function comments(content: string): string[] {
  const scanner = createScanner(content)
  const result: string[] = []
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
      result.push(scanner.getTokenValue())
    }
  }
  return result
}

export async function writeModelsJsonConfig(path: string, config: ModelsJson, expected: ModelsJson): Promise<void> {
  let original: string
  try {
    original = readFileSync(path, "utf8")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    original = "{}\n"
  }
  const old = parseJsonc<ModelsJson>(original)
  if (!isDeepStrictEqual(old, expected)) {
    throw new Error(`${path} changed while the command was running; try again`)
  }
  let next = original
  const oldProvider = old.providers?.["chatgpt-subscription"]
  const newProvider = config.providers?.["chatgpt-subscription"]
  if (old.providers === undefined) {
    next = applyEdits(next, modify(next, ["providers"], config.providers ?? {}, {}))
  } else if (newProvider === undefined) {
    next = applyEdits(next, modify(next, ["providers", "chatgpt-subscription"], undefined, {}))
  } else if (oldProvider === undefined) {
    next = applyEdits(next, modify(next, ["providers", "chatgpt-subscription"], newProvider, {}))
  } else {
    const oldOverrides = oldProvider.modelOverrides ?? {}
    const newOverrides = newProvider.modelOverrides ?? {}
    for (const id of new Set([...Object.keys(oldOverrides), ...Object.keys(newOverrides)])) {
      if (JSON.stringify(oldOverrides[id]) === JSON.stringify(newOverrides[id])) continue
      const before = oldOverrides[id]
      const after = newOverrides[id]
      const editPath = ["providers", "chatgpt-subscription", "modelOverrides", id]
      if (before !== undefined && after !== undefined) {
        next = applyEdits(next, modify(next, [...editPath, CONTEXT_WINDOW_KEY], after.contextWindow, {}))
      } else {
        next = applyEdits(next, modify(next, editPath, after, {}))
      }
    }
    if (newProvider.modelOverrides === undefined && oldProvider.modelOverrides !== undefined) {
      next = applyEdits(next, modify(next, ["providers", "chatgpt-subscription", "modelOverrides"], undefined, {}))
    }
  }
  if (JSON.stringify(comments(original)) !== JSON.stringify(comments(next))) {
    throw new Error(`Cannot update ${path} without removing comments`)
  }
  if (!isDeepStrictEqual(parseJsonc<ModelsJson>(next), config)) {
    throw new Error(`Cannot safely update ${path}`)
  }
  const mode = (() => {
    try {
      return statSync(path).mode & 0o777
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0o600
      throw error
    }
  })()
  writeFileAtomically(path, next, { mode })
}

export async function readWrittenWindows(path: string): Promise<WrittenWindows> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}
    throw error
  }
  const value: unknown = JSON.parse(text)
  const parsed = isPlainRecord(value) ? value : undefined
  const windows = isPlainRecord(parsed?.windows) ? parsed.windows : undefined
  if (parsed?.version !== RECORD_VERSION || parsed?.provider !== "chatgpt-subscription" || windows === undefined) {
    throw new Error(`Invalid extended context record: ${path}`)
  }
  const written: WrittenWindows = {}
  for (const [id, value] of Object.entries(windows)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid extended context record: ${path}`)
    }
    written[id] = value
  }
  return written
}

export async function writeWrittenWindows(
  path: string,
  providerId: string,
  windows: WrittenWindows,
): Promise<void> {
  const record = { version: RECORD_VERSION, provider: providerId, windows }
  writeFileAtomically(path, `${JSON.stringify(record, null, 2)}\n`)
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
    const recordedValue = written[id]
    const matchesWritten = recordedValue !== undefined && override[CONTEXT_WINDOW_KEY] === recordedValue
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
  if (Object.keys(nextProvider).length === 0) delete nextProviders[providerId]
  else {
    const valid = (Array.isArray(nextProvider.models) && nextProvider.models.length > 0)
      || Boolean(nextProvider.baseUrl || nextProvider.headers || nextProvider.extraBody || nextProvider.compat
        || nextProvider.whitelist || nextProvider.blacklist || nextProvider.apiKey)
      || nextProvider.hideFreeModels !== undefined
      || nextProvider.authHeader !== undefined
      || Object.keys(nextOverrides).length > 0
    if (!valid) {
      throw new Error(`Cannot remove the last override without leaving an invalid ${providerId} provider`)
    }
    nextProviders[providerId] = nextProvider
  }

  return { config: { ...config, providers: nextProviders }, cleared }
}
