import { statSync } from "node:fs"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { resolveModelRoutingRows, type ModelRoutingPlannerInputs, type ModelRoutingRow } from "./model-routing-rows"
import type { TaskModelRegistry } from "./planner"

/**
 * The desktop app's model-routing read. The method name in shipped source is what
 * the desktop's runtime build checks for, and an engine without it answers the unknown-method refusal the desktop
 * reads as `unsupported`. `schemaVersion` versions the answer.
 */
export const MODEL_ROUTING_RESOLVE_RPC_METHOD = "omo.modelRouting.resolve"

export type ModelRoutingAnswer =
  | { readonly schemaVersion: 1; readonly rows: readonly ModelRoutingRow[] }
  | {
      readonly kind: "error"
      readonly code: "cwd_unavailable" | "config_invalid" | "registry_unavailable"
      readonly message: string
    }

export interface ModelRoutingRpcDeps {
  /** The directory the planner's live config is read from (the task component's register-time cwd). */
  readonly cwd: () => string
  readonly loadConfig: (cwd: string) => SenpiOmoConfigResult
  readonly registry: () => TaskModelRegistry | undefined
  /** The planner's own agent table and the parent's service tier, read per answer. */
  readonly planner: () => ModelRoutingPlannerInputs
}

// A layer the loader could not read or parse is skipped, so rows built without it would describe a config the user
// never wrote; pruned values and unknown keys keep the rest of the layer and still resolve as the engine does.
const UNREADABLE_CONFIG_KINDS: ReadonlySet<string> = new Set(["read", "parse", "validation"])

export function registerModelRoutingRpc(pi: SenpiExtensionAPI, deps: ModelRoutingRpcDeps): void {
  pi.rpc?.handle?.(MODEL_ROUTING_RESOLVE_RPC_METHOD, () => answerModelRouting(deps))
}

function answerModelRouting(deps: ModelRoutingRpcDeps): ModelRoutingAnswer {
  const cwd = deps.cwd()
  if (!isDirectory(cwd))
    return {
      kind: "error",
      code: "cwd_unavailable",
      message: `The session's working directory ${cwd} is not a directory.`,
    }
  const loaded = deps.loadConfig(cwd)
  const unreadable = loaded.diagnostics.filter((diagnostic) => UNREADABLE_CONFIG_KINDS.has(diagnostic.kind))
  if (unreadable.length > 0) {
    return {
      kind: "error",
      code: "config_invalid",
      message: unreadable.map((diagnostic) => diagnostic.message).join("\n"),
    }
  }
  const registry = deps.registry()
  if (registry === undefined)
    return { kind: "error", code: "registry_unavailable", message: "The session has no model registry yet." }
  return { schemaVersion: 1, rows: resolveModelRoutingRows(loaded.config, registry, deps.planner()) }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
