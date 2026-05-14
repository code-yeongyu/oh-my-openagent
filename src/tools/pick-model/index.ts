import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../../config"
import {
  discoverRoles,
  setOverride,
  tryConsumeBudget,
} from "../../features/roles-models"
import { resolveAutoPick } from "../../features/roles-models/command-handler"

function chainContains(
  roleChain: { model: string; variant?: string }[],
  primary: { model: string; variant?: string } | undefined,
  model: string,
  variant: string | undefined,
): boolean {
  const matches = (entry: { model: string; variant?: string } | undefined): boolean =>
    !!entry && entry.model === model && (variant ? entry.variant === variant : true)
  if (matches(primary)) return true
  return roleChain.some(matches)
}

export function createPickModelTool(args: {
  pluginConfig: OhMyOpenCodeConfig
}): ToolDefinition {
  const { pluginConfig } = args

  return tool({
    description:
      "Override the active model for a role within this session. Only entries already declared in that role's primary or fallback_models chain are valid. Each role has a per-session swap budget (display.auto_pick_budget, default 2) to keep behavior bounded.",
    args: {
      role: tool.schema.string().describe("Role name (e.g. sisyphus, hephaestus, prometheus)."),
      model: tool.schema
        .string()
        .describe('Provider-prefixed model id (e.g. "anthropic/claude-opus-4-7").'),
      variant: tool.schema
        .string()
        .optional()
        .describe('Optional variant (e.g. "max", "medium").'),
      reason: tool.schema
        .string()
        .optional()
        .describe("One-line rationale for the swap, surfaced to the user."),
    },
    async execute(input, ctx) {
      const autoPickOn = resolveAutoPick(ctx.sessionID, pluginConfig)
      if (!autoPickOn) {
        return "pick_model is disabled: set display.auto_pick to true (config) or run /auto-pick on (session)."
      }

      const budget = pluginConfig.display?.auto_pick_budget ?? 2
      const roles = discoverRoles(pluginConfig)
      const target = roles.find((r) => r.name === input.role)

      if (!target) {
        return `Unknown role: ${input.role}. Known roles: ${roles.map((r) => r.name).join(", ")}.`
      }

      if (!chainContains(target.chain, target.primary, input.model, input.variant)) {
        const declared = [
          target.primary?.model,
          ...target.chain.map((e) => e.model),
        ]
          .filter(Boolean)
          .join(", ")
        return `Model ${input.model}${input.variant ? ` ${input.variant}` : ""} is not in ${input.role}'s declared chain. Declared: ${declared || "(none)"}.`
      }

      if (!tryConsumeBudget(ctx.sessionID, input.role, budget)) {
        return `Budget exhausted for role ${input.role} (max ${budget} swaps per session). Restart the session or raise display.auto_pick_budget to swap again.`
      }

      setOverride(ctx.sessionID, input.role, {
        model: input.model,
        ...(input.variant ? { variant: input.variant } : {}),
      })

      const reasonText = input.reason ? ` — ${input.reason}` : ""
      return `Active model for ${input.role} is now ${input.model}${input.variant ? ` ${input.variant}` : ""}${reasonText}.`
    },
  })
}
