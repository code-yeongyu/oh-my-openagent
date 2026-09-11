import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { resolveModelProfile, type ModelProfileResolution } from "./resolve"

/**
 * Applies the active `model_profile` to the MAIN session model at session start.
 *
 * Session-scoped by construction: the apply path is the session-only model setter (senpi
 * `agent-session.ts` `persistDefault: false`), never the persisting one, which runs
 * `setDefaultModelAndProvider()` -> `settings.json` and would turn the profile into the very pin
 * that disables it on the next start. The component never
 * reads `settings.json` either - senpi's own `recommended-models` builtin and `/model` rewrite
 * `defaultProvider`/`defaultModel` on the same event, so those keys mean "last used", not "pinned".
 * The pin lives in `model_profile` itself as a literal `provider/model`.
 *
 * In-tier fallback is start-time only. Mid-session failures follow senpi's `retry.fallbackChains`
 * (keyed by model family); wiring those to the tier is a named follow-up, and the applied notice
 * says so.
 */

export const MODEL_PROFILE_APPLIED_TYPE = "omo-model-profile:applied"
export const MODEL_PROFILE_UNAVAILABLE_TYPE = "omo-model-profile:unavailable"
export const MODEL_PROFILE_UNKNOWN_TYPE = "omo-model-profile:unknown"

const MID_SESSION_NOTE = "mid-session fallback follows senpi's retry chains"

export interface ModelProfileComponentOptions {
  readonly loadConfig?: typeof loadSenpiOmoConfig
}

type SessionModelApi = {
  setSessionModel(model: unknown): Promise<boolean> | Promise<unknown> | boolean | void
  setSessionThinkingLevel?(level: string): void
}

type SessionRegistry = {
  getAvailable(): readonly unknown[]
  find(provider: string, modelId: string): unknown
}

// Mirrors senpi-task's `asSenpiThinkingLevel` (packages/senpi-task/src/senpi/thinking-level.ts),
// which that package does not export publicly: omo.json spells the disabled level "none" where
// senpi spells it "off", "auto" and unknown tokens leave the session default alone.
const SENPI_THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

function asSenpiThinkingLevel(reasoning: string | undefined): string | undefined {
  if (reasoning === undefined) return undefined
  const normalized = reasoning === "none" ? "off" : reasoning
  return SENPI_THINKING_LEVELS.includes(normalized) ? normalized : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sessionModelApi(pi: SenpiExtensionAPI): SessionModelApi | undefined {
  const candidate: unknown = pi
  if (!isRecord(candidate) || typeof candidate["setSessionModel"] !== "function") return undefined
  return candidate as unknown as SessionModelApi
}

// senpi's ExtensionContext.modelRegistry satisfies this structurally; untyped hosts yield undefined
// and the component stays silent rather than guessing a provider.
function extractRegistry(eventCtx: unknown): SessionRegistry | undefined {
  if (!isRecord(eventCtx)) return undefined
  const registry = eventCtx["modelRegistry"]
  if (!isRecord(registry)) return undefined
  if (typeof registry["getAvailable"] !== "function" || typeof registry["find"] !== "function") return undefined
  return registry as unknown as SessionRegistry
}

function extractSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = eventCtx["sessionManager"]
  if (!isRecord(manager) || typeof manager["getSessionId"] !== "function") return undefined
  const id: unknown = Reflect.apply(manager["getSessionId"], manager, [])
  return typeof id === "string" ? id : undefined
}

// Only a fresh session may receive the profile: a resume/fork carries its own model history, a
// reload keeps the running session, and a `--model` flag or scoped model is explicit user state.
// A session_start without any provenance is treated as explicit too: senpi omits the field on a
// `--model` run, and silently overriding an unknown origin would clobber the user's choice.
function isFreshSessionWithoutExplicitModel(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  const reason = payload["reason"]
  if (reason !== "startup" && reason !== "new") return false
  const provenance = payload["initialModelProvenance"]
  if (typeof provenance !== "string") return false
  return provenance !== "cli" && provenance !== "scoped"
}

function extractCwd(pi: SenpiExtensionAPI, eventCtx: unknown): string {
  if (pi.cwd !== undefined) return pi.cwd
  if (isRecord(eventCtx) && typeof eventCtx["cwd"] === "string") return eventCtx["cwd"]
  return process.cwd()
}

function availableSelectors(registry: SessionRegistry): string[] {
  const selectors: string[] = []
  for (const model of registry.getAvailable()) {
    if (!isRecord(model)) continue
    const provider = model["provider"]
    const id = model["id"]
    if (typeof provider === "string" && typeof id === "string") selectors.push(`${provider}/${id}`)
  }
  return selectors
}

function noticeContent(resolution: ModelProfileResolution): string {
  switch (resolution.kind) {
    case "resolved": {
      const model = `${resolution.provider}/${resolution.modelId}`
      const skipped = resolution.skipped.length > 0 ? ` (skipped: ${resolution.skipped.join(", ")})` : ""
      return `omo-senpi: model profile "${resolution.profile.id}" selected ${model}${skipped}; ${MID_SESSION_NOTE}`
    }
    case "unavailable":
      return `omo-senpi: model profile "${resolution.profile.id}" has no available model (chain: ${resolution.chain.join(", ")}); keeping senpi's default model`
    case "empty":
      return `omo-senpi: model profile "${resolution.profile.id}" defines no models; keeping senpi's default model`
    case "unknown":
      return `omo-senpi: ${resolution.message}`
  }
}

export function createModelProfileComponent(options: ModelProfileComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  return {
    name: "model-profile",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      // One apply per session id; a host that reports no id gets exactly one apply per extension
      // instance, which is the conservative reading of "never clobber twice".
      const appliedSessions = new Set<string>()
      pi.on("session_start", async (payload, eventCtx) => {
        if (!isFreshSessionWithoutExplicitModel(payload)) return
        const sessionId = extractSessionId(eventCtx) ?? ""
        if (appliedSessions.has(sessionId)) return
        appliedSessions.add(sessionId)

        const config = loadConfig({ cwd: extractCwd(pi, eventCtx) }).config
        const active = config.model_profile
        if (active === undefined || active.trim().length === 0) return

        const registry = extractRegistry(eventCtx)
        if (registry === undefined) {
          ctx.logger.warn("omo-senpi: model profile skipped - no model registry on the session context")
          return
        }
        const api = sessionModelApi(pi)
        if (api === undefined) {
          ctx.logger.warn("omo-senpi: model profile skipped - this senpi runtime has no setSessionModel")
          return
        }

        const resolution = resolveModelProfile({
          profiles: config.model_profiles,
          active,
          availableModels: availableSelectors(registry),
        })
        const content = noticeContent(resolution)

        if (resolution.kind !== "resolved") {
          const customType = resolution.kind === "unknown" ? MODEL_PROFILE_UNKNOWN_TYPE : MODEL_PROFILE_UNAVAILABLE_TYPE
          pi.sendMessage({ customType, content, display: true })
          ctx.logger.warn(content)
          return
        }

        const model = registry.find(resolution.provider, resolution.modelId)
        if (model === undefined) {
          const message = `omo-senpi: model profile "${resolution.profile.id}" resolved ${resolution.provider}/${resolution.modelId} but the registry no longer lists it`
          pi.sendMessage({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE, content: message, display: true })
          ctx.logger.warn(message)
          return
        }
        await api.setSessionModel(model)
        const thinkingLevel = asSenpiThinkingLevel(resolution.reasoning)
        if (thinkingLevel !== undefined) api.setSessionThinkingLevel?.(thinkingLevel)
        const selectedModel = `${resolution.provider}/${resolution.modelId}`
        pi.sendMessage({
          customType: MODEL_PROFILE_APPLIED_TYPE,
          content,
          display: true,
          details: { profile: resolution.profile.id, model: selectedModel, skipped: [...resolution.skipped] },
        })
        ctx.logger.info(content, { profile: resolution.profile.id, model: selectedModel })
      })
    },
  }
}
