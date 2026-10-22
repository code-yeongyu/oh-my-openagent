import type { OhMyOpenCodeConfig } from "../config"
import { OverridableAgentNameSchema } from "../config/schema/agent-names"
import { addConfigLoadError } from "../shared/config-errors"

/**
 * Fields on an `agents.<name>` entry that only take effect through the built-in
 * agent merge path (agent-config-handler -> createBuiltinAgents ->
 * mergeAgentConfig). For a name outside the built-in agent list these are
 * silently dropped, while name-keyed fields (model, variant, fallback_models)
 * still apply through lookups elsewhere - a configuration trap where routing
 * works but the prompt/mode does not, with no signal explaining why.
 */
const BUILTIN_ONLY_OVERRIDE_FIELDS = ["prompt", "prompt_append", "mode"] as const

/**
 * The agent names the built-in merge path recognizes. Kept in lockstep with the
 * explicit (non-catchall) keys of `AgentOverridesSchema` via the shared enum.
 */
const BUILTIN_AGENT_NAMES: ReadonlySet<string> = new Set(OverridableAgentNameSchema.options)

/**
 * Warns when `agents.<name>` targets a name outside the built-in agent list and
 * carries merge-path-only fields (`prompt`, `prompt_append`, `mode`) that the
 * runtime will silently ignore. Surfaces through the config-load error channel
 * so the setting no longer fails as an unexplained no-op. See issue #8143.
 */
export function addIgnoredAgentOverrideWarnings(config: OhMyOpenCodeConfig): void {
  const agents = config.agents
  if (!agents) return

  for (const [name, agentConfig] of Object.entries(agents)) {
    if (!agentConfig || typeof agentConfig !== "object") continue
    if (BUILTIN_AGENT_NAMES.has(name)) continue

    const entry = agentConfig as Record<string, unknown>
    const ignoredFields = BUILTIN_ONLY_OVERRIDE_FIELDS.filter((field) => entry[field] !== undefined)
    if (ignoredFields.length === 0) continue

    addConfigLoadError({
      path: `agents.${name}`,
      error:
        `${ignoredFields.join(", ")} ignored: "${name}" is not a built-in agent, so these fields have no effect. ` +
        `Define custom agents in an opencode-native agent file (~/.config/opencode/agent/${name}.md); ` +
        `model/variant/fallback_models on this entry still apply.`,
    })
  }
}
