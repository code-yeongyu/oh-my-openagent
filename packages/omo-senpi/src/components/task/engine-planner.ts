import { homedir } from "node:os"

import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { resolveTaskAgents, type ChildPlanner, type PlanConfigError, type PlanResolution } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { SenpiConfigDiagnostic } from "../config-resolution"
import { createGenerationObservingPlanner, type CategoryConfigGenerations } from "./category-config-generation"
import { createCategoryUnavailableWarner } from "./category-unavailable-warning"
import { createTaskChildPlanner, type ResolveDefaultRoute, type ResolveModelRegistry } from "./planner"
import { isRoutingPath, routingIssues } from "./routing-config-check"
import type { TaskRuntimeContext } from "./runtime-context"

/** One read of the effective omo config: the merged config and what the loader found wrong with each layer. */
export type SpawnOmoConfig = {
  readonly config: OmoConfig
  readonly diagnostics: readonly SenpiConfigDiagnostic[]
  // Each layer as the loader kept it (the user layer, then the project layers), with its file. Absent for the startup snapshot.
  readonly layers?: readonly { readonly config: unknown; readonly source: { readonly path: string } }[]
}

export type EnginePlannerInput = {
  readonly pi: SenpiExtensionAPI
  readonly runtime: TaskRuntimeContext
  readonly settings: OmoTaskSettings
  readonly loadOmoConfig: () => SpawnOmoConfig
  readonly resolveRegistry: ResolveModelRegistry
  readonly resolveDefaultRoute: ResolveDefaultRoute
  readonly generations: CategoryConfigGenerations
}

// A layer that cannot be parsed or read, and a model catalog cycle, leave routing undefined, so they always block.
// A validation error or a dropped leaf blocks only when it is in a routing field; anything else (task settings,
// memory, ...) is dropped and warned about by the loader, exactly as before (#11355).
function blocksRouting(diagnostic: SenpiConfigDiagnostic): boolean {
  if (diagnostic.kind === "parse" || diagnostic.kind === "read" || diagnostic.kind === "model_catalog_cycle") return true
  if (diagnostic.kind !== "validation" && diagnostic.kind !== "invalid-value") return false
  const paths = diagnostic.issuePaths ?? []
  return paths.length === 0 || paths.some(isRoutingPath)
}

/** The path with the home directory shown as `~`, on POSIX and Windows separators alike. */
export function displayConfigPath(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path
}

function configError(diagnostic: SenpiConfigDiagnostic): PlanConfigError {
  const position = "position" in diagnostic ? diagnostic.position : undefined
  // A catalog cycle is found after the layers merge, so it names model references, not a file.
  if (diagnostic.kind === "model_catalog_cycle") {
    return { kind: "catalog", ...(diagnostic.issuePaths === undefined ? {} : { issue_paths: diagnostic.issuePaths }) }
  }
  return {
    kind: diagnostic.kind === "parse" || diagnostic.kind === "read" ? diagnostic.kind : "validation",
    path: displayConfigPath(diagnostic.path),
    ...(position === undefined ? {} : { position }),
    ...(diagnostic.issuePaths === undefined ? {} : { issue_paths: diagnostic.issuePaths }),
  }
}

function spawnConfigError(loaded: SpawnOmoConfig): PlanConfigError | undefined {
  const blocking = loaded.diagnostics.find(blocksRouting)
  if (blocking !== undefined) return configError(blocking)
  const layers = loaded.layers ?? []
  for (const { layer, issues } of routingIssues(layers, loaded.config.models)) {
    const source = layers[layer]?.source
    if (issues.length > 0 && source !== undefined) {
      return { kind: "validation", path: displayConfigPath(source.path), issue_paths: issues }
    }
  }
  return undefined
}

function configErrorMessage(error: PlanConfigError): string {
  if (error.kind === "catalog") {
    const at = error.issue_paths !== undefined && error.issue_paths.length > 0 ? ` at ${error.issue_paths.join(", ")}` : ""
    return `omo model catalog has a reference cycle${at}. No task was started; fix the model references and spawn again (the task never runs on another config).`
  }
  const where = error.position !== undefined
    ? `${error.path}:${error.position.line}:${error.position.column}`
    : error.issue_paths !== undefined && error.issue_paths.length > 0
      ? `${error.path} at ${error.issue_paths.join(", ")}`
      : error.path
  const what = error.kind === "parse" ? "is not valid JSON" : error.kind === "read" ? "could not be read" : "has an invalid value"
  return `omo config ${where} ${what}. No task was started; fix the file and spawn again (the task never runs on another config).`
}

/**
 * The engine's spawn planner. omo config is read once per plan, so a category chain or an agent edited in
 * omo.json reaches the next spawned child without restarting the session or its task host (#11355). A layer
 * that exists but cannot be parsed, read or validated fails the spawn with a typed `config_invalid` error
 * naming the file and position: routing never falls back to another layer, the defaults or the session's
 * startup config. That one read also feeds the dead-chain warning, so a spawn costs exactly one config load.
 */
export function createEnginePlanner(input: EnginePlannerInput): ChildPlanner {
  const { pi, runtime, settings, loadOmoConfig, resolveRegistry, resolveDefaultRoute, generations } = input
  const warn = createCategoryUnavailableWarner({ pi, runtime, settings })
  return (spec): PlanResolution => {
    const loaded = loadOmoConfig()
    const configFailure = spawnConfigError(loaded)
    if (configFailure !== undefined) {
      return { kind: "error", error: { code: "config_invalid", message: configErrorMessage(configFailure), config_error: configFailure } }
    }
    const omoConfig = loaded.config
    const resolution = createGenerationObservingPlanner({
      planner: createTaskChildPlanner(omoConfig, resolveTaskAgents(omoConfig), resolveRegistry, () => runtime.parentServiceTier(), resolveDefaultRoute),
      omoConfig,
      resolveRegistry,
      generations,
    })(spec)
    warn(resolution, omoConfig)
    return resolution
  }
}
