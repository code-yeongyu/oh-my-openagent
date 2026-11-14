import { normalizeThreadName } from "../addressing"
import type { ThreadRenameInput, ThreadSetReasoningInput, ThreadToolResult } from "../contracts"
import type { LocalAliasReason } from "../remote/cross-device"
import { renameAlias } from "../remote/lazy-ops"
import { failure } from "../tools/internals"
import { exactModel, matchModel, modelPatternFailure } from "../tools/model-match"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { locateControl } from "./locate"
import { controlIdentity, controlRefusalOf, type SessionControl } from "./port"

/** A control's answer for a thread no engine holds live, on this device or another. */
export const NOT_LIVE: ThreadToolResult = failure(
  "not_resumable",
  "The thread has no live owner.",
  "Retry when the target is live.",
)

/** Runs one control body and answers its typed refusal as data; every other throw stays the leg's transport failure. */
export async function answered(body: () => Promise<ThreadToolResult>): Promise<ThreadToolResult> {
  try {
    return await body()
  } catch (error) {
    const refusal = controlRefusalOf(error)
    if (refusal === undefined) throw error
    return { kind: "error", error: refusal }
  }
}

/**
 * The one body of each control tool, over the control `locateControl` found: the thread tools and the `omo remote`
 * verbs run exactly these. A control's typed refusal propagates as thrown; the caller answers it as data.
 */

export async function interruptThread(control: SessionControl, turnId: string | undefined): Promise<ThreadToolResult> {
  const result = await control.interrupt(turnId)
  return {
    kind: "ok",
    ...controlIdentity(control),
    ...(result.turn_id === undefined ? {} : { turn_id: result.turn_id }),
    interrupted: result.interrupted,
  }
}

export async function closeThread(control: SessionControl): Promise<ThreadToolResult> {
  const outcome = await control.close()
  if (outcome === "held_elsewhere")
    return failure(
      "foreign_live_owner",
      `Thread ${control.thread_id} has no session file yet and another client still holds it, so only this tool's hold was released.`,
      "Close it from the client that holds it, or send it a message first so it can be closed for every holder.",
      control.device === undefined ? undefined : { device: control.device },
    )
  return { kind: "ok", ...controlIdentity(control), closed: outcome === "closed" }
}

/**
 * One matching rule on the thread's own catalog. A catalog the control holds (bounded in age) decides only an exact
 * provider/id, at once; any other pattern is matched against a fresh catalog. A set the engine refuses (the held
 * catalog may predate the model leaving that device) is answered as a fresh catalog answers it: its own miss, the
 * model it matches set, or the set's refusal when it matches the same model.
 */
export async function setModelOn(
  control: SessionControl,
  model: string,
  provider: string | undefined,
): Promise<ThreadToolResult> {
  const empty = modelPatternFailure(model)
  if (empty !== undefined) return empty
  const fresh = async () => matchModel((await control.getAvailableModels({ fresh: true })).models, model, provider)
  const first = await control.getAvailableModels()
  const held = first.held ? exactModel(first.models, model, provider) : undefined
  const matched =
    held !== undefined
      ? { kind: "match" as const, model: held }
      : first.held
        ? await fresh()
        : matchModel(first.models, model, provider)
  if (matched.kind !== "match") return matched
  let selected: { readonly provider: string; readonly id: string }
  try {
    selected = await control.setModel(matched.model.provider, matched.model.id)
  } catch (error) {
    const refusal = controlRefusalOf(error)
    if (refusal === undefined || refusal.code === "idempotency_uncertain") throw error
    let rematched: Awaited<ReturnType<typeof fresh>>
    try {
      rematched = await fresh()
    } catch {
      throw error
    }
    if (rematched.kind !== "match") return rematched
    if (rematched.model.provider === matched.model.provider && rematched.model.id === matched.model.id) throw error
    selected = await control.setModel(rematched.model.provider, rematched.model.id)
  }
  return { kind: "ok", ...controlIdentity(control), model: { provider: selected.provider, id: selected.id } }
}

export async function setThinkingLevelOn(
  control: SessionControl,
  level: ThreadSetReasoningInput["level"],
  scope: ThreadSetReasoningInput["scope"],
): Promise<ThreadToolResult> {
  try {
    await control.setThinkingLevel(level, scope === "turn" ? "turn" : undefined)
  } catch (error) {
    if (controlRefusalOf(error)?.code !== "thinking_level_unsupported") throw error
    const supported = await control.getAvailableThinkingLevels()
    return failure(
      "thinking_level_unsupported",
      `Thinking level "${level}" is not supported by the active model.`,
      "Choose a level from the supported list and retry.",
      { supported },
    )
  }
  return { kind: "ok", ...controlIdentity(control), level, scope: scope ?? "session" }
}

/**
 * The one rename body (thread_rename and the SDK): every refusal runs before the alias or the name changes anywhere - the
 * target's own liveness first (a thread with no live owner, a device that is offline), then the name checks - and only
 * then the alias, then the name. `key` is the alias registry's idempotency key.
 */
export async function renameThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadRenameInput,
  key: string,
  callerId: string,
): Promise<ThreadToolResult> {
  if (value.name === undefined && value.alias === undefined)
    return failure("invalid_arguments", "Pass a new name, a new alias, or both.", "Retry with name or alias.")
  const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
  if (located.kind === "error") return located.result
  const thread = located.kind === "control" ? located.control : located
  // #13066: the name is checked on the target device's own listing, and only when a live owner holds the thread.
  const nameRefusal = async (name: string): Promise<ThreadToolResult | undefined> => {
    if (located.kind === "not_live") return NOT_LIVE
    if (located.kind !== "control") return undefined
    if (name.length === 0)
      return failure("invalid_arguments", "The new thread name is empty.", "Pass a non-empty name.")
    const visible = await located.control.visible()
    const existing = visible.find(
      (entry) => entry.thread_id !== thread.thread_id && normalizeThreadName(entry.name) === normalizeThreadName(name),
    )
    return existing === undefined
      ? undefined
      : failure(
          "name_conflict",
          `A thread named "${existing.name}" already exists.`,
          "Call thread_list and choose another name.",
        )
  }
  let name = value.name?.trim()
  const refusedName = name === undefined ? undefined : await nameRefusal(name)
  if (refusedName !== undefined) return refusedName
  let localAlias: LocalAliasReason | undefined
  if (value.alias !== undefined) {
    const refused = await renameAlias(options.remote, thread.thread_id, thread.device, value.alias, key)
    if (refused !== undefined && "local" in refused) {
      // No account holds the alias and nothing changed (#13104): it becomes the thread's name unless one was given.
      localAlias = refused.local
      if (name === undefined) {
        name = value.alias.trim()
        const refusedAlias = await nameRefusal(name)
        if (refusedAlias !== undefined) return refusedAlias
      }
    } else if (refused !== undefined) return refused
  }
  if (name !== undefined && located.kind === "control") await located.control.setName(name)
  const aliasFields =
    value.alias === undefined
      ? {}
      : localAlias === undefined
        ? { alias: value.alias }
        : { alias_scope: "local" as const, alias_unavailable: localAlias }
  return { kind: "ok", ...controlIdentity(thread), name: name ?? thread.title, ...aliasFields }
}
