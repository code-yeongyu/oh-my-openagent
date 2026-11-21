import { displayOmoConfigPath, omoConfigDiagnosticLines, resolveHomeDir } from "@oh-my-opencode/omo-config-core"
import { categoryShadowedAgentNames, categoryShadowMessage } from "@oh-my-opencode/senpi-task/category-shadow"
import { describeModelChains, type ModelChainEntry } from "@oh-my-opencode/senpi-task/model-chains"
import { loadSenpiOmoConfig, type SenpiConfigDiagnostic } from "../../config-resolution"
import type { ConfigContext } from "."
import { type EngineSettingsFile, type EngineView, engineView, fallbackChainFor, readEngineLayers } from "./engine"
import { readModelSwaps, sessionFileFor } from "./model-swaps"

export type ConfigFile = {
  readonly kind: "omo" | "engine"
  readonly scope: "user" | "project" | "global"
  readonly path: string
  readonly exists: boolean
  readonly loaded: boolean
  readonly diagnostics: readonly string[]
}

export type RoutingEntry = {
  readonly name: string
  readonly source: "user" | "builtin"
  readonly chain: readonly string[]
  /** With `models` given: the model a spawn would run now, `null` when no rung is usable. */
  readonly pick?: string | null
}

export type EngineStatus = EngineView & {
  /** The engine's fallback chain for `model` (else the session's current model); empty when it has none. */
  readonly fallbackChain?: { readonly model: string; readonly chain: readonly string[] }
}

export type ConfigStatus = {
  readonly files: readonly ConfigFile[]
  readonly diagnostics: readonly string[]
  readonly routing: { readonly categories: readonly RoutingEntry[]; readonly agents: readonly RoutingEntry[] }
  readonly engine: EngineStatus
}

export type AvailableModel = { readonly provider: string; readonly id: string }

export type StatusOptions = {
  /** The machine's available models; given, each routing entry names the rung a spawn would pick. */
  readonly models?: readonly AvailableModel[]
  /** A `provider/id` or bare model id whose engine fallback chain to report. */
  readonly model?: string
  /** A session record path or id; the calling session's when omitted. */
  readonly session?: string
}

function diagnosticLines(diagnostic: SenpiConfigDiagnostic, homeDir: string): readonly string[] {
  return diagnostic.kind === "model_catalog_cycle"
    ? [`config: ${displayOmoConfigPath(diagnostic.path, homeDir)}: ${diagnostic.message}`]
    : omoConfigDiagnosticLines([{ ...diagnostic, kind: diagnostic.kind }], { homeDir })
}

function routingEntry(entry: ModelChainEntry, withPick: boolean): RoutingEntry {
  return {
    name: entry.name,
    source: entry.rungs.some((rung) => rung.source !== "built-in") ? "user" : "builtin",
    chain: entry.rungs.map((rung) => rung.model),
    ...(withPick ? { pick: entry.primary ?? null } : {}),
  }
}

const engineFile = (file: EngineSettingsFile): ConfigFile => ({
  kind: "engine",
  scope: file.scope,
  path: file.path,
  exists: file.exists,
  loaded: file.loaded,
  diagnostics: file.diagnostics,
})

export function configStatus(context: ConfigContext, options: StatusOptions = {}): ConfigStatus {
  const homeDir = resolveHomeDir(context.env)
  const loaded = loadSenpiOmoConfig({ cwd: context.cwd, env: context.env })
  const fileLines = new Map<string, string[]>()
  const mergedLines: string[] = []
  const addLine = (path: string, line: string): void => {
    const lines = fileLines.get(path)
    if (lines === undefined) mergedLines.push(line)
    else lines.push(line)
  }
  for (const source of loaded.sources) fileLines.set(source.path, [])
  for (const diagnostic of loaded.diagnostics)
    for (const line of diagnosticLines(diagnostic, homeDir)) addLine(diagnostic.path, line)
  for (const name of categoryShadowedAgentNames(loaded.config)) {
    const owner = loaded.layers.findLast((layer) => {
      const categories = layer.config["categories"]
      return typeof categories === "object" && categories !== null && Object.hasOwn(categories, name)
    })
    addLine(owner?.source.path ?? "", `config: ${categoryShadowMessage(loaded.config, name)}`)
  }

  const engineLayers = readEngineLayers(context)
  const files: ConfigFile[] = [
    ...loaded.sources.map((source): ConfigFile => ({
      kind: "omo",
      ...source,
      diagnostics: fileLines.get(source.path) ?? [],
    })),
    engineFile(engineLayers.global),
    engineFile(engineLayers.project),
  ]

  const models = options.models ?? []
  const report = describeModelChains(loaded.config, {
    getAvailable: () => models,
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
  })
  const withPick = options.models !== undefined

  const view = engineView(engineLayers.global.document, engineLayers.project.document, context.engineVersion())
  const sessionFile = options.model === undefined ? sessionFileFor(options.session, context) : undefined
  const model = options.model ?? (sessionFile === undefined ? null : readModelSwaps(sessionFile).currentModel)

  return {
    files,
    diagnostics: [...files.flatMap((file) => file.diagnostics), ...mergedLines],
    routing: {
      categories: report.categories.map((entry) => routingEntry(entry, withPick)),
      agents: report.agents.map((entry) => routingEntry(entry, withPick)),
    },
    engine: {
      ...view,
      ...(model === null
        ? {}
        : { fallbackChain: { model, chain: fallbackChainFor(view.fallbackChains, model) ?? [] } }),
    },
  }
}
