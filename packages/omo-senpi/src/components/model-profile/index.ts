import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { DEFAULT_MODEL_PROFILE_ID } from "./builtin-profiles"
import { credentialRotationPolicy } from "./credential-policy"
import { authFailedDetails, noticeContent } from "./notice"
import { type AuthFailure, type ProbeRegistry, probeRequestAuth, probeRuntime, sanitizedAuthErrorDetail } from "./request-auth"
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
 * A rung counts only when the first turn could use it: `request-auth.ts` reproduces that turn's
 * credential resolution (per credential slot, then the model's own request configuration), so a
 * stored login that no longer refreshes drops its provider and a model whose headers do not
 * resolve drops only itself. The walk continues with the survivors.
 *
 * In-tier fallback is start-time only. Mid-session failures follow senpi's `retry.fallbackChains`
 * (keyed by model family); wiring those to the tier is a named follow-up, and the applied notice
 * says so.
 */

export const MODEL_PROFILE_APPLIED_TYPE = "omo-model-profile:applied"
export const MODEL_PROFILE_UNAVAILABLE_TYPE = "omo-model-profile:unavailable"
export const MODEL_PROFILE_UNKNOWN_TYPE = "omo-model-profile:unknown"

export interface ModelProfileComponentOptions {
  readonly loadConfig?: typeof loadSenpiOmoConfig
}

type SessionModelApi = {
  setSessionModel(model: unknown): Promise<boolean> | Promise<unknown> | boolean | void
  setSessionThinkingLevel?(level: string): void
}

type SessionRegistry = ProbeRegistry & {
  getAvailable(): readonly unknown[]
  find(provider: string, modelId: string): unknown
  getProviderAuthStatus?(provider: string): unknown
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

function extractMode(eventCtx: unknown): string | undefined {
  return isRecord(eventCtx) && typeof eventCtx["mode"] === "string" ? eventCtx["mode"] : undefined
}

function extractAgentDir(eventCtx: unknown): string | undefined {
  return isRecord(eventCtx) && typeof eventCtx["agentDir"] === "string" ? eventCtx["agentDir"] : undefined
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

// Lanes have no TUI surface yet: the terminal shows neither the lane nor its reasoning, so an
// interactive TUI session keeps the model the user started with. The desktop (rpc) and headless
// runs still apply the profile.
function isTuiSession(eventCtx: unknown): boolean {
  return extractMode(eventCtx) === "tui"
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

function providerOf(selector: string): string {
  return selector.slice(0, selector.indexOf("/"))
}

function logSkippedCandidate(ctx: ComponentContext, failure: AuthFailure): void {
  const candidate = `${failure.provider}/${failure.model}`
  ctx.logger.warn(`omo-senpi: model profile skipped ${candidate}: request auth did not resolve (${failure.reason}, ${failure.errorKind})`, {
    provider: failure.provider,
    model: failure.model,
    reason: failure.reason,
    errorKind: failure.errorKind,
  })
  if (process.env.OMO_DEBUG) {
    ctx.logger.info(`omo-senpi: model profile skipped ${candidate}: ${sanitizedAuthErrorDetail(failure.error)}`)
  }
}

type ProbedResolution = { readonly resolution: ModelProfileResolution; readonly model: unknown; readonly failures: AuthFailure[] }

// Each failed probe removes at least one selector (the whole provider for a credential failure,
// the one model for a request-configuration failure), so the walk ends after at most one pass per
// available selector. A literal pin is the user's explicit choice and is never swapped, so it is
// not probed; a host whose registry exposes no runtime keeps the plain walk.
async function resolveWithRequestAuth(
  ctx: ComponentContext,
  registry: SessionRegistry,
  agentDir: string | undefined,
  profiles: Parameters<typeof resolveModelProfile>[0]["profiles"],
  active: string,
): Promise<ProbedResolution> {
  const available = availableSelectors(registry)
  const excludedProviders = new Set<string>()
  const excludedSelectors = new Set<string>()
  const failures: AuthFailure[] = []
  const resolve = () =>
    resolveModelProfile({
      profiles,
      active,
      availableModels: available.filter(
        (selector) => !excludedSelectors.has(selector) && !excludedProviders.has(providerOf(selector)),
      ),
    })
  const runtime = probeRuntime(registry)
  const mayRotate = credentialRotationPolicy(registry, agentDir)
  let resolution = resolve()
  let model: unknown
  while (resolution.kind === "resolved") {
    model = registry.find(resolution.provider, resolution.modelId)
    if (model === undefined || resolution.profile.source === "pin" || runtime === undefined) break
    const failure = await probeRequestAuth(registry, runtime, mayRotate, resolution.provider, resolution.modelId, model)
    if (failure === undefined) break
    failures.push(failure)
    logSkippedCandidate(ctx, failure)
    if (failure.reason === "request") excludedSelectors.add(`${failure.provider}/${failure.model}`)
    else excludedProviders.add(failure.provider)
    resolution = resolve()
  }
  return { resolution, model, failures }
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
        if (isTuiSession(eventCtx) || !isFreshSessionWithoutExplicitModel(payload)) return
        const sessionId = extractSessionId(eventCtx) ?? ""
        if (appliedSessions.has(sessionId)) return
        appliedSessions.add(sessionId)

        const config = loadConfig({ cwd: extractCwd(pi, eventCtx) }).config
        const configured = config.model_profile
        const active =
          configured !== undefined && configured.trim().length > 0 ? configured : DEFAULT_MODEL_PROFILE_ID

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

        const mode = extractMode(eventCtx)
        const { resolution, model, failures } = await resolveWithRequestAuth(
          ctx,
          registry,
          extractAgentDir(eventCtx),
          config.model_profiles,
          active,
        )
        const content = noticeContent(resolution, failures, mode)

        if (resolution.kind !== "resolved") {
          const customType = resolution.kind === "unknown" ? MODEL_PROFILE_UNKNOWN_TYPE : MODEL_PROFILE_UNAVAILABLE_TYPE
          const details =
            resolution.kind === "unavailable" && failures.length > 0
              ? { details: { profile: resolution.profile.id, ...authFailedDetails(failures) } }
              : {}
          pi.sendMessage({ customType, content, display: true, ...details })
          ctx.logger.warn(content)
          return
        }

        if (model === undefined) {
          const message = `OmO Native: model profile "${resolution.profile.id}" resolved ${resolution.provider}/${resolution.modelId} but the registry no longer lists it`
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
          details: {
            profile: resolution.profile.id,
            model: selectedModel,
            skipped: [...resolution.skipped],
            ...(resolution.reasoning !== undefined ? { reasoning: resolution.reasoning } : {}),
            ...authFailedDetails(failures),
          },
        })
        ctx.logger.info(content, { profile: resolution.profile.id, model: selectedModel })
      })
    },
  }
}
