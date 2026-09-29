import type { Plugin } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { isRecord } from "@oh-my-opencode/utils"
import { getModelCapabilities, log, resolveCompatibleModelSettings } from "./shared"
import { getSessionPromptParams } from "./shared/session-prompt-params-state"
import { setSessionAgent } from "./features/claude-code-session-state"

const SAFE_MAX_OUTPUT_TOKENS_FALLBACK = 4096

export function applyContextParamsV2(event: SessionContext): void {
  const stored = getSessionPromptParams(event.sessionID)
  if (stored?.temperature !== undefined) {
    event.options.temperature = stored.temperature
  }
  if (stored?.topP !== undefined) {
    event.options.topP = stored.topP
  }
  if (typeof stored?.maxOutputTokens === "number" && stored.maxOutputTokens > 0) {
    event.options.maxTokens = stored.maxOutputTokens
  }
  if (stored?.options) {
    Object.assign(event.options, stored.options)
  }

  const capabilities = getModelCapabilities({
    providerID: event.model.providerID,
    modelID: event.model.id,
  })
  const compatibility = resolveCompatibleModelSettings({
    providerID: event.model.providerID,
    modelID: event.model.id,
    desired: {
      // V1 also reconciled message.variant here. The V2 context hook exposes no
      // message access, so variant reconciliation has no equivalent and is skipped.
      variant: undefined,
      reasoningEffort: typeof event.options.reasoningEffort === "string"
        ? event.options.reasoningEffort
        : undefined,
      temperature: typeof event.options.temperature === "number" ? event.options.temperature : undefined,
      topP: typeof event.options.topP === "number" ? event.options.topP : undefined,
      maxTokens: typeof event.options.maxTokens === "number" ? event.options.maxTokens : undefined,
      thinking: isRecord(event.options.thinking) ? event.options.thinking : undefined,
    },
    capabilities,
  })

  if (compatibility.reasoningEffort !== undefined) {
    event.options.reasoningEffort = compatibility.reasoningEffort
  } else if ("reasoningEffort" in event.options) {
    delete event.options.reasoningEffort
  }

  if ("temperature" in compatibility) {
    if (compatibility.temperature !== undefined) {
      event.options.temperature = compatibility.temperature
    } else {
      delete event.options.temperature
    }
  }

  if ("topP" in compatibility) {
    if (compatibility.topP !== undefined) {
      event.options.topP = compatibility.topP
    } else {
      delete event.options.topP
    }
  }

  if ("maxTokens" in compatibility) {
    if (compatibility.maxTokens !== undefined && compatibility.maxTokens > 0) {
      event.options.maxTokens = compatibility.maxTokens
    } else {
      const originalMaxTokens = typeof event.options.maxTokens === "number"
        ? event.options.maxTokens
        : compatibility.maxTokens
      event.options.maxTokens = SAFE_MAX_OUTPUT_TOKENS_FALLBACK
      if (typeof originalMaxTokens === "number" && originalMaxTokens <= 0) {
        log(
          `[plugin] maxTokens=${originalMaxTokens} is non-positive; using safe fallback ${SAFE_MAX_OUTPUT_TOKENS_FALLBACK}`,
        )
      }
    }
  }

  if ("thinking" in compatibility) {
    if (compatibility.thinking !== undefined) {
      event.options.thinking = compatibility.thinking
    } else {
      delete event.options.thinking
    }
  }
}

export async function registerSessionV2Hooks(ctx: Plugin.Context): Promise<void> {
  await ctx.session.hook("context", (event) => {
    // The context hook is the only V2 hook that carries the agent identity;
    // record it so agent-gated before-guards can resolve agents session-locally.
    if (typeof event.agent === "string" && event.agent.length > 0) {
      setSessionAgent(event.sessionID, event.agent)
    }
    applyContextParamsV2(event)
  })
}
