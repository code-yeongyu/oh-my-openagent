import type { OmoModelProfile } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_MODEL_PROFILE_ID } from "../model-profile/builtin-profiles"
import { resolveModelProfile } from "../model-profile/resolve"
import type { ThreadToolResult } from "./contracts"
import { isModelSetter, MODEL_SETTERS, modelLabel, type ModelSetter, type ThreadModel } from "./gateway/session-models"
import { failure, resolution, resolveEntries, routingId, sessionPort, summary, targetSession } from "./tools/internals"
import type { ModelCatalogEntry, ThreadHostView, ThreadToolSurfaceOptions } from "./tools/ports"

/**
 * #9425: how a gateway session gets its model. A session opened with no model is AUTO: the active
 * `model_profile` ladder (the same `resolveModelProfile` the session-start component runs) over the
 * models the connected providers serve, else the first connected model; never the host's own default
 * order, because the choice is passed to `open_session` explicitly. An explicit model is matched the
 * way `thread_set_model` matches it, and wins. Either way the choice is recorded in the gateway store
 * with its provenance, keyed by the durable id, so every resume path reports it.
 */

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export const REASONING_SCOPES = ["session", "turn"] as const

export type ModelProfileChoice = { readonly profiles?: Readonly<Record<string, OmoModelProfile>> | undefined; readonly active: string }

export type CreateThreadInput = {
  readonly name?: string
  readonly cwd?: string
  readonly fork_from?: string
  readonly provider?: string
  readonly model?: string
  readonly thinking?: string
  readonly set_by?: ModelSetter
}

type Failure = Extract<ThreadToolResult, { kind: "error" }>
type Matched = { readonly kind: "ok"; readonly entry: ModelCatalogEntry }

function isThinkingLevel(value: string): boolean {
  return (THINKING_LEVELS as readonly string[]).includes(value)
}

// omo.json spells the disabled level "none" where senpi spells it "off" (model-profile/index.ts).
function profileThinking(reasoning: string | undefined): string | undefined {
  const level = reasoning === "none" ? "off" : reasoning
  return level !== undefined && isThinkingLevel(level) ? level : undefined
}

/**
 * The `model_profile` choice from a loaded omo.json view: the default profile when unset. Reading
 * omo.json is the caller's job (the extension through `loadSenpiOmoConfig`, the `omo thread` CLI through
 * its task-config runtime), so the thread SDK bundle stays free of the config loader.
 */
export function modelProfileChoice(config: { readonly model_profile?: string; readonly model_profiles?: Readonly<Record<string, OmoModelProfile>> }): ModelProfileChoice {
  const active = config.model_profile?.trim()
  return { profiles: config.model_profiles, active: active !== undefined && active.length > 0 ? active : DEFAULT_MODEL_PROFILE_ID }
}

/** The provider filter a caller asked for, lowercased; an empty or whitespace-only provider asks for none. */
function providerFilter(provider: string | undefined): string | undefined {
  const wanted = provider?.trim().toLowerCase()
  return wanted === undefined || wanted.length === 0 ? undefined : wanted
}

/** Exact `provider/id`, then exact id, then a case-insensitive fragment of the id or display name; `provider` narrows first. */
export function matchModel(catalog: readonly ModelCatalogEntry[], model: string, provider?: string): Matched | Failure {
  const pattern = model.trim().toLowerCase()
  if (pattern.length === 0) return failure("invalid_arguments", "The model pattern is empty.", "Pass a model id or display-name fragment.") as Failure
  const wanted = providerFilter(provider)
  const available = wanted === undefined ? catalog : catalog.filter((entry) => entry.provider.toLowerCase() === wanted)
  let matches = available.filter((entry) => modelLabel(entry).toLowerCase() === pattern)
  if (matches.length === 0) matches = available.filter((entry) => entry.id.toLowerCase() === pattern)
  if (matches.length === 0) matches = available.filter((entry) => entry.id.toLowerCase().includes(pattern) || entry.name?.toLowerCase().includes(pattern))
  if (matches.length === 0) return failure("model_not_found", `No available model matches "${model}".`, "Choose a provider/id from the available list and retry.", { available: catalog.slice(0, 20).map(modelLabel) }) as Failure
  if (matches.length > 1) return failure("model_ambiguous", `Several available models match "${model}".`, "Pass an exact provider/id or narrow the pattern with provider.", { candidates: matches.slice(0, 10).map(modelLabel) }) as Failure
  return { kind: "ok", entry: matches[0] }
}

/** The profile ladder's first connected rung, else the first connected model; undefined when nothing is connected. */
export function chooseAutoModel(catalog: readonly ModelCatalogEntry[], profile: ModelProfileChoice): { readonly entry: ModelCatalogEntry; readonly thinking?: string } | undefined {
  const resolved = resolveModelProfile({ profiles: profile.profiles, active: profile.active, availableModels: catalog.map(modelLabel) })
  if (resolved.kind === "resolved") {
    const entry = catalog.find((candidate) => candidate.provider === resolved.provider && candidate.id === resolved.modelId)
    const thinking = profileThinking(resolved.reasoning)
    if (entry !== undefined) return { entry, ...(thinking === undefined || !supports(entry, thinking) ? {} : { thinking }) }
  }
  const first = catalog[0]
  return first === undefined ? undefined : { entry: first }
}

function supports(entry: ModelCatalogEntry, level: string): boolean {
  return entry.thinking_levels === undefined || entry.thinking_levels.includes(level)
}

function unsupportedThinking(level: string, supported: readonly string[]): Failure {
  return failure("thinking_level_unsupported", `Thinking level "${level}" is not supported by the model.`, "Choose a level from the supported list and retry.", { supported }) as Failure
}

function badSetter(value: unknown): Failure {
  return failure("invalid_arguments", `set_by must be one of ${MODEL_SETTERS.join(", ")}, got ${JSON.stringify(value)}.`, "Pass config, user or lead.") as Failure
}

function stateThinking(state: unknown): string | null {
  const level = (state as { readonly thinkingLevel?: unknown } | null | undefined)?.thinkingLevel
  return typeof level === "string" ? level : null
}

function stateModel(state: unknown): { readonly provider: string; readonly id: string } | null {
  const { provider, id } = ((state as { readonly model?: unknown } | null | undefined)?.model ?? {}) as { readonly provider?: unknown; readonly id?: unknown }
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : null
}

/**
 * `thread_create` / `omo thread create`. Everything that can be refused is refused before the host
 * opens anything: a bad setter or level, a name in use, a model no connected provider serves, a level
 * the chosen model cannot run.
 */
export async function createThread(options: ThreadToolSurfaceOptions, current: ThreadHostView, input: CreateThreadInput, defaults: { readonly set_by: ModelSetter; readonly cwd?: string }): Promise<ThreadToolResult> {
  if (input.set_by !== undefined && !isModelSetter(input.set_by)) return badSetter(input.set_by)
  if (input.set_by !== undefined && input.model === undefined) return failure("invalid_arguments", "set_by names who chose a model, and no model was given.", "Pass model with set_by, or drop set_by.")
  if (input.thinking !== undefined && !isThinkingLevel(input.thinking)) return failure("invalid_arguments", `The thinking level must be one of ${THINKING_LEVELS.join(", ")}.`, "Pass one of the listed levels.")
  if (input.name !== undefined) {
    const existing = resolveEntries(options, current).find((entry) => entry.name.toLowerCase() === input.name?.trim().toLowerCase())
    if (existing !== undefined) return failure("name_conflict", `A thread named "${existing.name}" already exists.`, "Call thread_list and choose another name.")
  }
  const cwd = input.cwd ?? defaults.cwd
  const opening = { ...(cwd === undefined ? {} : { cwd }), ...(input.fork_from === undefined ? {} : { forkFrom: input.fork_from }), ...(input.name === undefined ? {} : { name: input.name }) }
  const wanted = providerFilter(input.provider)
  const listCatalog = options.host.availableModels
  if (listCatalog === undefined) {
    // Without a catalog nothing can be chosen for the caller, so an explicit choice is refused rather than left to the host's default.
    if (input.model !== undefined || input.thinking !== undefined || wanted !== undefined) return failure("unsupported", "This host cannot list the models a new session could use.", "Create the thread without a provider, model or thinking level, then use thread_set_model.")
    const session = await options.host.openSession(opening)
    return { kind: "ok", thread: summary(session), deduplicated: false }
  }
  const catalog = await listCatalog()
  let entry: ModelCatalogEntry
  let thinking = input.thinking
  if (input.model !== undefined) {
    const separator = input.model.indexOf("/")
    const scoped = wanted === undefined && separator > 0 && separator < input.model.length - 1
    const matched = matchModel(catalog, input.model, scoped ? input.model.slice(0, separator) : wanted)
    if (matched.kind === "error") return matched
    entry = matched.entry
  } else {
    // An explicit provider with no model narrows auto to that provider: the caller's choice wins.
    const candidates = wanted === undefined ? catalog : catalog.filter((candidate) => candidate.provider.toLowerCase() === wanted)
    const auto = chooseAutoModel(candidates, options.modelProfile?.() ?? modelProfileChoice({}))
    if (auto === undefined && wanted !== undefined) return failure("model_not_found", `No connected model is served by provider "${input.provider?.trim()}".`, "Choose a provider from the available list, or connect that provider, then retry.", { available: catalog.slice(0, 20).map(modelLabel) })
    if (auto === undefined) return failure("model_not_found", "No connected provider serves a model.", "Connect a provider (omo setup, or /login in a session), then retry.", { available: [] })
    entry = auto.entry
    thinking ??= auto.thinking
  }
  if (thinking !== undefined && !supports(entry, thinking)) return unsupportedThinking(thinking, entry.thinking_levels ?? [])
  const session = await options.host.openSession({ ...opening, provider: entry.provider, modelId: entry.id, ...(thinking === undefined ? {} : { thinkingLevel: thinking }) })
  const thread = summary(session)
  const explicit = input.model !== undefined
  const model: ThreadModel = { provider: entry.provider, id: entry.id, thinking_level: stateThinking(session) ?? thinking ?? null, provenance: explicit ? "set" : "auto", set_by: explicit ? (input.set_by ?? defaults.set_by) : null, reason: null }
  await options.store.recordSessionModel({ now: (options.now ?? options.store.now)(), durable_id: thread.thread_id, model })
  return { kind: "ok", thread: { ...thread, model }, deduplicated: false }
}

/**
 * `thread_set_model` / `omo thread set-model`: the switch the engine applies from the next turn, recorded
 * as set by `setBy`. The record follows the model the engine reports in force afterwards, never the
 * `set_model` reply alone: senpi answers success for a switch it only HOLDS until a compaction makes the
 * context fit (`_setModel` / `_switchActiveModel` deferral). A held switch answers `held: true` and is
 * recorded by the session itself (`component.ts`) once it lands. A switch senpi refuses (a context the
 * model cannot hold, a provider with no key) is `unsupported` with the engine's reason, nothing recorded.
 */
export async function setThreadModel(options: ThreadToolSurfaceOptions, current: ThreadHostView, input: { readonly thread: string; readonly model: string; readonly provider?: string; readonly all_scope?: boolean }, callerId: string, setBy: unknown): Promise<{ readonly kind: "ok"; readonly thread_id: string; readonly model: ThreadModel; readonly held?: true } | Failure> {
  if (!isModelSetter(setBy)) return badSetter(setBy)
  const resolved = resolution(options, resolveEntries(options, current), input.thread, callerId, input.all_scope)
  if (resolved.kind === "error") return { kind: "error", error: resolved }
  const session = targetSession(current, resolved.entry.thread_id)
  if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.") as Failure
  if (input.model.trim().length === 0) return failure("invalid_arguments", "The model pattern is empty.", "Pass a model id or display-name fragment.") as Failure
  const port = sessionPort(options, session)
  const matched = matchModel(await port.getAvailableModels(routingId(session)), input.model, input.provider)
  if (matched.kind === "error") return matched
  let selected: Awaited<ReturnType<typeof port.setModel>>
  try {
    selected = await port.setModel(routingId(session), matched.entry.provider, matched.entry.id)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("model_refused:")) throw error
    const reason = error.message.slice("model_refused:".length)
    return failure("unsupported", `The session refused to switch to ${modelLabel(matched.entry)}: ${reason}`, "Choose another model from the available list, or compact the session first when its context does not fit.", { model: modelLabel(matched.entry), reason }) as Failure
  }
  const state = await port.getState(routingId(session))
  const model: ThreadModel = { provider: selected.provider, id: selected.id, thinking_level: stateThinking(state), provenance: "set", set_by: setBy, reason: null }
  const active = stateModel(state)
  if (active !== null && (active.provider !== selected.provider || active.id !== selected.id)) return { kind: "ok", thread_id: resolved.entry.thread_id, model, held: true }
  await options.store.recordSessionModel({ now: (options.now ?? options.store.now)(), durable_id: resolved.entry.thread_id, model })
  return { kind: "ok", thread_id: resolved.entry.thread_id, model }
}

/**
 * `thread_set_reasoning` / `omo thread set-reasoning`. With `checkFirst` the level is checked against
 * the active model before anything changes: senpi clamps an unsupported session-scope level silently
 * instead of refusing it. Without it the engine's own refusal is classified, as the agent tool always did.
 * Either way the result and the record name the level the engine reports after the change - the clamped
 * one when it clamped - never the level asked for.
 */
export async function setThreadReasoning(options: ThreadToolSurfaceOptions, current: ThreadHostView, input: { readonly thread: string; readonly level: string; readonly scope?: string; readonly all_scope?: boolean }, callerId: string, checkFirst: boolean): Promise<ThreadToolResult> {
  if (!isThinkingLevel(input.level)) return failure("invalid_arguments", `The thinking level must be one of ${THINKING_LEVELS.join(", ")}.`, "Pass one of the listed levels.")
  if (input.scope !== undefined && !(REASONING_SCOPES as readonly string[]).includes(input.scope)) return failure("invalid_arguments", "The scope must be session or turn.", "Pass session (the default) or turn.")
  const resolved = resolution(options, resolveEntries(options, current), input.thread, callerId, input.all_scope)
  if (resolved.kind === "error") return { kind: "error", error: resolved }
  const session = targetSession(current, resolved.entry.thread_id)
  if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
  const port = sessionPort(options, session)
  if (checkFirst) {
    const supported = await port.getAvailableThinkingLevels(routingId(session))
    if (!supported.includes(input.level)) return unsupportedThinking(input.level, supported)
  }
  try {
    await port.setThinkingLevel(routingId(session), input.level, input.scope === "turn" ? "turn" : undefined)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("thinking_level_unsupported:")) throw error
    return unsupportedThinking(input.level, await port.getAvailableThinkingLevels(routingId(session)))
  }
  const reported = stateThinking(await port.getState(routingId(session)))
  // A host whose state names no level gives nothing true to record; the request is echoed and the record left as it was.
  const effective = reported !== null && isThinkingLevel(reported) ? reported : undefined
  if (effective !== undefined) await options.store.updateSessionThinking({ now: (options.now ?? options.store.now)(), durable_id: resolved.entry.thread_id, thinking_level: effective })
  return { kind: "ok", thread_id: resolved.entry.thread_id, level: (effective ?? input.level) as (typeof THINKING_LEVELS)[number], scope: input.scope === "turn" ? "turn" : "session" }
}

export type ModelsResult = {
  readonly kind: "ok"
  readonly thread_id: string | null
  readonly current: ThreadModel | null
  readonly available: readonly { readonly provider: string; readonly id: string; readonly name: string; readonly thinking_levels: readonly string[] }[]
}

/** `omo thread models`: what a new session could use (no thread), or what the thread's live session could switch to. */
export async function listThreadModels(options: ThreadToolSurfaceOptions, current: ThreadHostView, input: { readonly thread?: string; readonly provider?: string; readonly all_scope?: boolean }, callerId: string): Promise<ModelsResult | Failure> {
  let threadId: string | null = null
  let catalog: readonly ModelCatalogEntry[]
  if (input.thread === undefined) {
    if (options.host.availableModels === undefined) return failure("unsupported", "This host cannot list the models a new session could use.", "Pass a live thread to list what it can switch to.") as Failure
    catalog = await options.host.availableModels()
  } else {
    const resolved = resolution(options, resolveEntries(options, current), input.thread, callerId, input.all_scope)
    if (resolved.kind === "error") return { kind: "error", error: resolved }
    const session = targetSession(current, resolved.entry.thread_id)
    if (session === undefined) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.") as Failure
    threadId = resolved.entry.thread_id
    catalog = await sessionPort(options, session).getAvailableModels(routingId(session))
  }
  const wanted = providerFilter(input.provider)
  const available = (wanted === undefined ? catalog : catalog.filter((entry) => entry.provider.toLowerCase() === wanted))
    .map((entry) => ({ provider: entry.provider, id: entry.id, name: entry.name ?? entry.id, thinking_levels: [...(entry.thinking_levels ?? [])] }))
  const recorded = threadId === null ? null : ((await options.store.sessionModels([threadId]))[threadId] ?? null)
  return { kind: "ok", thread_id: threadId, current: recorded, available }
}

export async function withModels<T extends { readonly thread_id: string }>(options: ThreadToolSurfaceOptions, threads: readonly T[]): Promise<(T & { readonly model: ThreadModel | null })[]> {
  const models = threads.length === 0 ? {} : await options.store.sessionModels(threads.map((thread) => thread.thread_id))
  return threads.map((thread) => ({ ...thread, model: models[thread.thread_id] ?? null }))
}
