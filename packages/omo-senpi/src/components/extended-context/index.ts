import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import {
  applyContextWindowOverrides,
  clearContextWindowOverrides,
  contextWindowOverrideIds,
  modelsJsonPath,
  readModelsJsonConfig,
  writeModelsJsonConfig,
} from "./store"
import { computeWidenedWindows, parseReportedWindows, type CatalogRow } from "./windows"

const PROVIDER_ID = "chatgpt-subscription"
const MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
// Below 0.160.0 the endpoint answers with a truncated catalog that omits every gpt-6.1 model, so a
// lower version would silently leave the model this command exists for untouched.
const CLIENT_VERSION = "0.200.0"
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
}

export type ExtendedContextCommandContext = {
  readonly hasUI?: boolean
  readonly agentDir?: string
  readonly ui?: { notify(text: string, level?: string): void }
  readonly modelRegistry?: unknown
}

function respond(ctx: ExtendedContextCommandContext, text: string, level: "info" | "warning" | "error" = "info"): string {
  ctx.ui?.notify(text, level)
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
    .filter((model) => model.provider === PROVIDER_ID)
    .map((model) => ({ id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens }))
}

async function fetchReportedWindows(token: string): Promise<unknown> {
  const response = await fetch(`${MODELS_ENDPOINT}?client_version=${CLIENT_VERSION}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": `codex-cli/${CLIENT_VERSION}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from codex/models: ${(await response.text()).slice(0, 200)}`)
  }
  return response.json()
}

async function widen(ctx: ExtendedContextCommandContext, path: string): Promise<string> {
  const registry = registryOf(ctx.modelRegistry)
  if (registry === undefined) {
    return respond(ctx, "extended-context needs an interactive session with a model registry.", "error")
  }

  const token = await Promise.resolve(registry.getApiKeyForProvider(PROVIDER_ID))
  if (token === undefined || token === "") {
    return respond(ctx, "No ChatGPT subscription credential. Run /login chatgpt-subscription first.", "warning")
  }

  const rows = catalogRows(registry.getAll())
  if (rows.length === 0) {
    return respond(ctx, `No ${PROVIDER_ID} models are available in this session.`, "warning")
  }

  const widened = computeWidenedWindows(rows, parseReportedWindows(await fetchReportedWindows(token)))
  if (widened.length === 0) {
    return respond(ctx, "Every ChatGPT subscription model already uses the window the subscription reports.")
  }

  const config = readModelsJsonConfig(path)
  await writeModelsJsonConfig(path, applyContextWindowOverrides(config, PROVIDER_ID, widened))
  const lines = widened.map((window) => `${window.id}: ${window.from} -> ${window.to}`)
  return respond(ctx, `Extended ${widened.length} model window(s) in ${path}\n${lines.join("\n")}`)
}

async function restore(ctx: ExtendedContextCommandContext, path: string): Promise<string> {
  const { config, cleared } = clearContextWindowOverrides(readModelsJsonConfig(path), PROVIDER_ID)
  if (cleared.length === 0) return respond(ctx, "No extended context windows to restore.")

  await writeModelsJsonConfig(path, config)
  return respond(ctx, `Restored the shipped windows for ${cleared.length} model(s): ${cleared.join(", ")}`)
}

export function registerExtendedContextCommand(pi: SenpiExtensionAPI): void {
  pi.registerCommand("extended-context", {
    description: "Toggle ChatGPT subscription model windows between the shipped values and the reported maximum",
    handler: async (args: string, ctx: ExtendedContextCommandContext): Promise<string> => {
      const path = modelsJsonPath(ctx.agentDir ?? resolveAgentHome({ env: process.env }))
      const command = (args ?? "").trim().toLowerCase()
      try {
        const wantsRestore = command === "off" || command === "restore" || command === "reset"
        const hasOverrides = contextWindowOverrideIds(readModelsJsonConfig(path), PROVIDER_ID).length > 0
        return wantsRestore || hasOverrides ? await restore(ctx, path) : await widen(ctx, path)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return respond(ctx, `extended-context failed: ${message}`, "error")
      }
    },
  })
}

export function createExtendedContextComponent(): OmoSenpiComponent {
  return {
    name: "extended-context",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      registerExtendedContextCommand(pi)
    },
  }
}
