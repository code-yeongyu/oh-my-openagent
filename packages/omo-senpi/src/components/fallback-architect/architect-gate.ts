import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"
import { resolveAvailableCategoryNames } from "@oh-my-opencode/senpi-task/category-resolver"

import { loadSenpiOmoConfig } from "../config-resolution"

export type GateRegistry = SenpiModelRegistryPort<SenpiModelPort>

export interface ArchitectGateOptions {
  /** Pins $HOME in tests so the loader cannot read the developer's real user config. */
  env?: { readonly HOME?: string; readonly USERPROFILE?: string }
  /**
   * The live senpi model registry (senpi's ExtensionContext.modelRegistry satisfies the port
   * structurally). When present, a builtin (user-undeclared) architect counts as active exactly
   * when the runtime category list exposes it - the same resolveCategory gating the task planner
   * applies, including the requiresModel: "claude-fable-5" check and fallback-chain viability.
   * When absent the gate falls back to the config-declared check, matching pre-registry callers.
   */
  registry?: GateRegistry
}

/**
 * The nudge is only useful when the session can actually route work to the architect category, so
 * the component asks this gate right before injecting. The config is read fresh every time: a
 * config-watch reload during the session must be able to turn the nudge on or off. A user-declared
 * entry always answers the gate (disable: true counts as inactive, declaration beats the builtin
 * requiresModel gate exactly as resolveCategory does).
 */
export function hasActiveArchitectCategory(cwd: string, options: ArchitectGateOptions = {}): boolean {
  try {
    const loadOptions = options.env === undefined ? { cwd } : { cwd, env: options.env }
    const { config } = loadSenpiOmoConfig(loadOptions)
    const architect = config.categories?.["architect"]
    if (architect !== undefined) return architect.disable !== true
    if (options.registry === undefined) return false
    return resolveAvailableCategoryNames(config, options.registry).includes("architect")
  } catch {
    return false
  }
}
