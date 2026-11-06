import { existsSync } from "node:fs"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import {
  applyContextWindowOverrides,
  clearContextWindowOverrides,
  clearWrittenWindows,
  modelsJsonPath,
  readModelsJsonConfig,
  readWrittenWindows,
  recordPath,
  writeModelsJsonConfig,
  writeWrittenWindows,
} from "./store"
import { computeWidenedWindows, parseReportedWindows, type CatalogRow } from "./windows"

const PROVIDER_ID = "chatgpt-subscription"
const MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
const REQUEST_TIMEOUT_MS = 15_000

type CatalogModel = {
  readonly id: string
  readonly provider: string
  readonly contextWindow: number
  readonly maxTokens: number
}

type ModelRegistryPort = {
  getAll(): readonly CatalogModel[]
  getApiKeyForProvider(providerId: string): Promise<string | undefined> | string | undefined
  refresh?(): unknown
}

export type ExtendedContextCommandContext = {
  readonly hasUI?: boolean
  readonly agentDir?: string
  readonly ui?: { notify(text: string, level?: string): void }
  readonly modelRegistry?: unknown
}

export type ExtendedContextDeps = {
  readonly fetchImpl?: typeof fetch
  readonly hostVersion?: string
}

function respond(ctx: ExtendedContextCommandContext, text: string, level: "info" | "warning" | "error" = "info"): string {
  if (ctx.hasUI === true) {
    ctx.ui?.notify(text, level)
    return text
  }
  const stream = level === "info" ? process.stdout : process.stderr
  stream.write(`${text}\n`)
  return text
}

function registryOf(value: unknown): ModelRegistryPort | undefined {
  const candidate = value as Partial<ModelRegistryPort> | undefined
  return typeof candidate?.getAll === "function" && typeof candidate.getApiKeyForProvider === "function"
    ? (candidate as ModelRegistryPort)
    : undefined
}

function catalogRows(models: readonly CatalogModel[]): CatalogRow[] {
  return models
    .filter((model) => model.provider === PROVIDER_ID && model.maxTokens > 0)
    .map((model) => ({ id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens }))
}

/**
 * The endpoint requires a client version and serves the catalog that version is entitled to, so the
 * request carries the running engine's own version rather than identifying itself as another CLI.
 */
async function fetchReportedWindows(token: string, hostVersion: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${MODELS_ENDPOINT}?client_version=${encodeURIComponent(hostVersion)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": `omo/${hostVersion}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from codex/models: ${(await response.text()).slice(0, 200)}`)
  }
  return response.json()
}

async function widen(
  ctx: ExtendedContextCommandContext,
  deps: ExtendedContextDeps,
  agentDir: string,
): Promise<string> {
  const registry = registryOf(ctx.modelRegistry)
  if (registry === undefined) {
    return respond(ctx, "extended-context needs an interactive session with a model registry.", "error")
  }
  const hostVersion = deps.hostVersion
  if (hostVersion === undefined || hostVersion === "") {
    return respond(ctx, "This engine does not report its version, so the subscription catalog cannot be read honestly.", "warning")
  }

  const token = await Promise.resolve(registry.getApiKeyForProvider(PROVIDER_ID))
  if (token === undefined || token === "") {
    return respond(ctx, "No ChatGPT subscription credential. Run /login chatgpt-subscription first.", "warning")
  }

  const rows = catalogRows(registry.getAll())
  if (rows.length === 0) {
    return respond(ctx, `No ${PROVIDER_ID} models are available in this session.`, "warning")
  }

  const path = modelsJsonPath(agentDir)
  const read = readModelsJsonConfig(path, existsSync(path))
  if (read.kind === "invalid") {
    return respond(ctx, `${path} does not parse, so nothing was written. Fix or move it first.`, "error")
  }

  const reported = parseReportedWindows(await fetchReportedWindows(token, hostVersion, deps.fetchImpl ?? fetch))
  const widened = computeWidenedWindows(rows, reported)
  if (widened.length === 0) {
    return respond(ctx, "Every ChatGPT subscription model already uses the window the subscription reports.")
  }

  const { config, written } = applyContextWindowOverrides(read.config, PROVIDER_ID, widened)
  await writeModelsJsonConfig(path, config)
  await writeWrittenWindows(recordPath(agentDir), PROVIDER_ID, written)
  await Promise.resolve(registry.refresh?.()).catch(() => undefined)

  const lines = widened.map((window) => `${window.id}: ${window.from} -> ${window.to}`)
  return respond(ctx, `Extended ${widened.length} model window(s) in ${path}\n${lines.join("\n")}`)
}

async function restore(ctx: ExtendedContextCommandContext, agentDir: string): Promise<string> {
  const path = modelsJsonPath(agentDir)
  const read = readModelsJsonConfig(path, existsSync(path))
  if (read.kind === "invalid") {
    return respond(ctx, `${path} does not parse, so nothing was written. Fix or move it first.`, "error")
  }

  const written = await readWrittenWindows(recordPath(agentDir))
  if (Object.keys(written).length === 0) {
    return respond(ctx, "No extended context windows were written here, so nothing was restored.")
  }

  const { config, cleared } = clearContextWindowOverrides(read.config, PROVIDER_ID, written)
  await writeModelsJsonConfig(path, config)
  await clearWrittenWindows(recordPath(agentDir))
  const registry = registryOf(ctx.modelRegistry)
  await Promise.resolve(registry?.refresh?.()).catch(() => undefined)

  return respond(
    ctx,
    cleared.length === 0
      ? "Nothing to restore: those windows are already gone or were changed by hand."
      : `Restored the shipped windows for ${cleared.length} model(s): ${cleared.join(", ")}`,
  )
}

export function registerExtendedContextCommand(pi: SenpiExtensionAPI, deps: ExtendedContextDeps = {}): void {
  const hostVersion = deps.hostVersion ?? (pi as { hostVersion?: string }).hostVersion
  const resolved: ExtendedContextDeps = { ...deps, ...(hostVersion === undefined ? {} : { hostVersion }) }
  pi.registerCommand("extended-context", {
    description: "Toggle or set ChatGPT subscription model windows (on | off)",
    handler: async (args: string, ctx: ExtendedContextCommandContext): Promise<string> => {
      const agentDir = ctx.agentDir ?? resolveAgentHome({ env: process.env })
      const command = (args ?? "").trim().toLowerCase()
      try {
        const wantsRestore = command === "off" || command === "restore" || command === "reset"
        const wantsWiden = command === "on"
        const written = await readWrittenWindows(recordPath(agentDir))
        const isOn = Object.keys(written).length > 0
        const shouldWiden = wantsWiden || (!wantsRestore && !isOn)
        return shouldWiden ? await widen(ctx, resolved, agentDir) : await restore(ctx, agentDir)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return respond(ctx, `extended-context failed: ${message}`, "error")
      }
    },
  })
}

export function createExtendedContextComponent(deps: ExtendedContextDeps = {}): OmoSenpiComponent {
  return {
    name: "extended-context",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      registerExtendedContextCommand(pi, deps)
    },
  }
}
