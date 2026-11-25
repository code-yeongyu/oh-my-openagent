import type { ThreadModel, ThreadModelInEffect, ThreadSetReasoningInput, ThreadToolResult } from "../contracts"
import { createHash } from "node:crypto"
import { threadToolFailure } from "../errors"
import { failure } from "../tools/internals"
import { exactModel, matchModel, modelPatternFailure } from "../tools/model-match"
import type { ThreadCloseOptions } from "../tools/ports"
import { controlIdentity, controlRefusalOf, refuse, type SessionControl, type SessionModelState } from "./port"

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
    background: result.background,
  }
}

/** The close options a `thread_close` input names, absent ones left out. */
export function closeOptions(value: {
  readonly force?: boolean | undefined
  readonly graceful?: boolean | undefined
  readonly wait_ms?: number | undefined
}): ThreadCloseOptions {
  return {
    ...(value.force === undefined ? {} : { force: value.force }),
    ...(value.graceful === undefined ? {} : { graceful: value.graceful }),
    ...(value.wait_ms === undefined ? {} : { wait_ms: value.wait_ms }),
  }
}

export async function closeThread(
  control: SessionControl,
  options: ThreadCloseOptions = {},
): Promise<ThreadToolResult> {
  if (options.graceful === true && options.force === true)
    return failure(
      "invalid_arguments",
      "graceful and force exclude each other: a graceful close lets the turn end, a forced one stops it.",
      "Pass one of them.",
    )
  if (options.wait_ms !== undefined && options.graceful !== true)
    return failure(
      "invalid_arguments",
      "wait_ms only bounds a graceful close: a close without graceful does not wait for the turn.",
      "Pass graceful: true with wait_ms, or drop wait_ms.",
    )
  const { outcome, dropped_deliveries, graceful } = await control.close(options)
  if (outcome === "held_elsewhere")
    return failure(
      "foreign_live_owner",
      `Thread ${control.thread_id} has no session file yet and another client still holds it, so only this tool's hold was released.`,
      "Close it from the client that holds it, or send it a message first so it can be closed for every holder.",
      control.device === undefined ? undefined : { device: control.device },
    )
  const closed = outcome === "closed"
  return {
    kind: "ok",
    ...controlIdentity(control),
    closed,
    reason: closed ? "closed" : "not_live",
    dropped_deliveries: [...dropped_deliveries],
    ...(graceful === undefined ? {} : { graceful }),
  }
}

/**
 * One matching rule on the thread's own catalog. A catalog the control holds (bounded in age) decides only an exact
 * provider/id, at once; any other pattern is matched against a fresh catalog. A set the engine refuses (the held
 * catalog may predate the model leaving that device) is answered as a fresh catalog answers it: its own miss, the
 * model it matches set, or the set's refusal when it matches the same model.
 */
/**
 * The effect id a model switch carries for an idempotency key (#14939): one per caller and key, within the engine's
 * 256-character bound, so a repeat under the key is answered from the holder's effect ledger and never switches again.
 */
export function modelSwitchEffectId(principal: string, key: string): string {
  return `set_model:${createHash("sha256").update(`${principal}\n${key}`).digest("hex").slice(0, 40)}`
}

export async function setModelOn(
  control: SessionControl,
  model: string,
  provider: string | undefined,
  options: { readonly effectId?: string } = {},
): Promise<ThreadToolResult> {
  const empty = modelPatternFailure(model)
  if (empty !== undefined) return empty
  const fresh = async () => matchModel((await control.getAvailableModels({ fresh: true })).models, model, provider)
  const first = await control.getAvailableModels()
  const held = first.held ? exactModel(first.models, model, provider) : undefined
  let matched: Awaited<ReturnType<typeof fresh>> =
    held !== undefined
      ? { kind: "match" as const, model: held }
      : first.held
        ? await fresh()
        : matchModel(first.models, model, provider)
  if (matched.kind !== "match") return matched
  let previous = await modelBeforeSwitch(control, matched.thinkingLevel)
  let selected: ThreadModel
  try {
    selected = await control.setModel(matched.model.provider, matched.model.id, options)
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
    // The engine's refusal is the more specific answer when the target also cannot report its model state now; any other
    // failure (a transport error reading that state) is its own answer.
    try {
      previous = await modelBeforeSwitch(control, rematched.thinkingLevel)
    } catch (stateError) {
      if (controlRefusalOf(stateError)?.details?.reason === "model_state_unavailable") throw error
      throw stateError
    }
    // The refused first switch is recorded under its effect id with its own model, so the rematch needs an id of its own.
    selected = await control.setModel(
      rematched.model.provider,
      rematched.model.id,
      options.effectId === undefined ? {} : { effectId: `${options.effectId}:rematch` },
    )
    matched = rematched
  }
  return await settleModelSwitch(
    control,
    { provider: selected.provider, id: selected.id },
    previous,
    matched.thinkingLevel,
  )
}

/**
 * #14939: a `set_model` reply acknowledges a switch the holder keeps until its next compaction exactly as one it applied,
 * so only the holder's state read after the reply tells them apart. The level goes onto the selected model only once that
 * model is in effect (never onto the old one), and the outcome is decided on the state read after both settled.
 */
async function settleModelSwitch(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState | undefined,
  level: string | undefined,
): Promise<ThreadToolResult> {
  const after = await stateAfterSwitch(control)
  if (!("model" in after)) return switchUncertain(control, selected, level, after.unread)
  if (!sameModel(after.model, selected)) {
    if (after.pendingModel !== undefined && sameModel(after.pendingModel, selected))
      return {
        kind: "ok",
        ...controlIdentity(control),
        model: selected,
        model_switch: "after_compaction",
        in_effect: inEffect(after),
        pending: {
          model: selected,
          ...(level === undefined ? {} : { thinking_level: level, thinking_level_sent: false }),
        },
      }
    return switchNotApplied(control, selected, level, after)
  }
  if (level === undefined || previous === undefined) return switchApplied(control, selected, after)
  const refusal = await applyModelThinking(control, selected, previous, level, after)
  if (refusal !== undefined) return refusal
  const confirmed = await stateAfterSwitch(control)
  if (!("model" in confirmed)) return switchUncertain(control, selected, level, confirmed.unread)
  if (!sameModel(confirmed.model, selected)) return switchUncertain(control, selected, level, "active_model_changed")
  if (confirmed.thinkingLevel !== level)
    return partialModelSwitch(control, selected, previous, level, "thinking_level_unconfirmed", confirmed)
  return switchApplied(control, selected, confirmed)
}

async function stateAfterSwitch(control: SessionControl): Promise<SessionModelState | { readonly unread: unknown }> {
  try {
    return (await control.getModelState()) ?? { unread: "model_state_unavailable" }
  } catch (error) {
    return { unread: error }
  }
}

function inEffect(state: SessionModelState): ThreadModelInEffect {
  return { model: state.model, thinking_level: state.thinkingLevel }
}

function switchApplied(control: SessionControl, selected: ThreadModel, state: SessionModelState): ThreadToolResult {
  return {
    kind: "ok",
    ...controlIdentity(control),
    model: selected,
    model_switch: "applied",
    in_effect: inEffect(state),
  }
}

function failureDetail(error: unknown): string {
  return controlRefusalOf(error)?.code ?? (error instanceof Error ? error.message : String(error))
}

/** The holder's state could not be read after `set_model`: the switch may or may not have happened. */
function switchUncertain(
  control: SessionControl,
  selected: ThreadModel,
  level: string | undefined,
  cause: unknown,
): ThreadToolResult {
  return {
    kind: "error",
    error: {
      ...threadToolFailure(
        "idempotency_uncertain",
        "The model switch was sent, but the target's model state could not be read back, so whether it took effect is unknown.",
        "Read the target's current model and thinking level before repeating; repeating the same switch is safe.",
        {
          ...controlIdentity(control),
          reason: "model_switch_unconfirmed",
          selected_model: selected,
          ...(level === undefined ? {} : { requested_thinking_level: level }),
          detail: failureDetail(cause),
        },
      ),
      uncertain: true,
    },
  }
}

/** The holder answered the switch and its state shows neither the selected model in effect nor a switch to it held. */
function switchNotApplied(
  control: SessionControl,
  selected: ThreadModel,
  level: string | undefined,
  state: SessionModelState,
): ThreadToolResult {
  return failure(
    "not_applied",
    `The target answered the switch to ${selected.provider}/${selected.id}, but its state shows the model unchanged and no switch held.`,
    "Nothing changed; it is safe to repeat the call, or pick another model.",
    {
      ...controlIdentity(control),
      reason: "model_switch_not_applied",
      selected_model: selected,
      ...(level === undefined ? {} : { requested_thinking_level: level }),
      in_effect: inEffect(state),
    },
  )
}

async function modelBeforeSwitch(
  control: SessionControl,
  level: string | undefined,
): Promise<SessionModelState | undefined> {
  if (level === undefined) return undefined
  const previous = await control.getModelState()
  if (previous !== undefined) return previous
  throw refuse(
    "unsupported",
    "The target did not report a current model and thinking level to restore if the suffix fails.",
    "Retry when the target reports its active model and level, or switch the model without a thinking suffix.",
    { reason: "model_state_unavailable" },
  )
}

/** The level onto the selected model, now in effect (`switched`); a refused level restores the previous state. */
async function applyModelThinking(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
  switched: SessionModelState,
): Promise<ThreadToolResult | undefined> {
  let refusal: ThreadToolResult | undefined
  try {
    refusal = await applyThinkingLevel(control, level)
  } catch (error) {
    const partial = await restoreModelState(control, selected, previous, level, switched)
    if (partial !== undefined) return partial
    throw error
  }
  if (refusal !== undefined) return (await restoreModelState(control, selected, previous, level, switched)) ?? refusal
}

function sameModel(left: ThreadModel, right: ThreadModel): boolean {
  return left.provider === right.provider && left.id === right.id
}

/**
 * The selected model took effect and the level did not: `details.partial` names which part was applied and the state
 * last read (`lastSeen`). Only answered once the model was read in effect, so something really changed.
 */
function partialModelSwitch(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
  reason: "model_restore_failed" | "thinking_level_unconfirmed",
  lastSeen: SessionModelState,
  error?: unknown,
): ThreadToolResult {
  return failure(
    "partial_commit",
    `The switch to ${selected.provider}/${selected.id} took effect; thinking level ${level} did not.`,
    "Read details.partial for what is in effect, then set the thinking level again with thread_set_reasoning (tool.thread_set_reasoning() in an eval cell).",
    {
      ...controlIdentity(control),
      reason,
      partial: { applied: ["model"], not_applied: ["thinking_level"], in_effect: inEffect(lastSeen) },
      previous_model: previous.model,
      previous_thinking_level: previous.thinkingLevel,
      selected_model: selected,
      requested_thinking_level: level,
      ...(error === undefined ? {} : { detail: failureDetail(error) }),
    },
  )
}

async function restoreModelState(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
  switched: SessionModelState,
): Promise<ThreadToolResult | undefined> {
  let lastSeen = switched
  const partial = (error: unknown) =>
    partialModelSwitch(control, selected, previous, level, "model_restore_failed", lastSeen, error)
  try {
    let current = await control.getModelState()
    if (current === undefined) return partial("model_state_unavailable")
    lastSeen = current
    if (!sameModel(current.model, previous.model)) {
      if (!sameModel(current.model, selected)) return partial("active_model_changed")
      await control.setModel(previous.model.provider, previous.model.id)
      current = await control.getModelState()
      if (current === undefined || !sameModel(current.model, previous.model)) return partial("restore_unconfirmed")
      lastSeen = current
    }
    if (current.thinkingLevel !== previous.thinkingLevel) {
      await control.setThinkingLevel(previous.thinkingLevel)
      const restored = await control.getModelState()
      if (
        restored === undefined ||
        !sameModel(restored.model, previous.model) ||
        restored.thinkingLevel !== previous.thinkingLevel
      )
        return partial("restore_unconfirmed")
    }
  } catch (error) {
    return partial(error)
  }
}

export async function setThinkingLevelOn(
  control: SessionControl,
  level: ThreadSetReasoningInput["level"],
  scope: ThreadSetReasoningInput["scope"],
): Promise<ThreadToolResult> {
  const refusal = await applyThinkingLevel(control, level)
  return refusal ?? { kind: "ok", ...controlIdentity(control), level, scope: scope ?? "session" }
}

async function applyThinkingLevel(control: SessionControl, level: string): Promise<ThreadToolResult | undefined> {
  try {
    await control.setThinkingLevel(level)
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
}
