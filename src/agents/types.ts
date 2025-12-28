import type { AgentConfig } from "@opencode-ai/sdk"
import type { CodeReviewerMode } from "./code-reviewer"

/**
 * Base interface for agent factory options.
 * Agent-specific options should extend this interface.
 * @example
 * interface MyAgentOptions extends BaseAgentOptions {
 *   customSetting?: string
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BaseAgentOptions {}

/**
 * Generic factory function type for creating agents.
 * Each agent can define its own options type extending BaseAgentOptions.
 * @template TOptions - Agent-specific options type (defaults to BaseAgentOptions)
 */
export type AgentFactory<TOptions extends BaseAgentOptions = BaseAgentOptions> = (
  model?: string,
  options?: TOptions
) => AgentConfig

export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || model.startsWith("github-copilot/gpt-")
}

export type BuiltinAgentName =
  | "Sisyphus"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"
  | "code-reviewer"

export type OverridableAgentName =
  | "build"
  | "plan"
  | "OpenCode-Builder"
  | "Planner-Sisyphus"
  | BuiltinAgentName

export type AgentName = BuiltinAgentName

export type BaseAgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string
}

export type CodeReviewerOverrideConfig = BaseAgentOverrideConfig & {
  code_reviewer_mode?: CodeReviewerMode
}

export type AgentOverrideConfig = BaseAgentOverrideConfig | CodeReviewerOverrideConfig

export type AgentOverrides = {
  [K in Exclude<OverridableAgentName, "code-reviewer">]?: BaseAgentOverrideConfig
} & {
  "code-reviewer"?: CodeReviewerOverrideConfig
}
