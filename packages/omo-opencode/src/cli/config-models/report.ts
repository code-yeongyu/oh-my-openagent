import { resolve } from "node:path"

import { prunePluginView } from "../../config/prune-plugin-view"
import { loadOmoOpenCodeConfigChain } from "../../plugin-config/omo-config-chain"
import { projectDeclarations } from "./declarations"
import { pluginDiagnostics, projectDiagnostic } from "./diagnostics"
import type { ConfigModelsOptions, ConfigModelsReport, ModelMapSource, ModelMapView } from "./types"

export function buildConfigModelsReport(options: ConfigModelsOptions): ConfigModelsReport {
  const directory = resolve(options.directory ?? process.cwd())
  const environment = options.environment ?? process.env
  const homeDir = environment.HOME ?? environment.USERPROFILE
  const chain = loadOmoOpenCodeConfigChain(directory, environment)
  const sourcePaths = new Set(chain.sources.map((source) => source.path))
  const diagnostics = chain.diagnostics.map((diagnostic) => projectDiagnostic(diagnostic, sourcePaths))
  const views: ModelMapView[] = []
  for (const view of chain.views) {
    if (view.scope === undefined) continue
    const pruned = prunePluginView({ ...view, homeDir })
    diagnostics.push(...pluginDiagnostics(view, pruned, homeDir))
    views.push({
      path: view.path,
      scope: view.scope,
      keyPrefix: view.keyPrefix,
      declarations: pruned.issues.length > 0 ? [] : projectDeclarations(pruned.config, view.keyPrefix),
    })
  }
  const sources = chain.sources.map((source): ModelMapSource => ({
    path: source.path,
    scope: source.scope,
    status: !source.exists ? "missing" : !source.loaded ? "rejected"
      : diagnostics.some((entry) => entry.path === source.path && entry.severity === "error") ? "partial" : "loaded",
  }))
  return {
    directory,
    profile: chain.profile ?? null,
    valid: !diagnostics.some((entry) => entry.severity === "error"),
    sources,
    views,
    diagnostics,
  }
}
