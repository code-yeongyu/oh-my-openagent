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
  let previous = await stateBeforeSwitch(control, matched.thinkingLevel)
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
      previous = await stateBeforeSwitch(control, rematched.thinkingLevel)
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
 * model is in effect (never onto the old one); a refused or failed level rolls the switch back. The outcome is then
 * classified from the state read after all of that settled (`classifySwitch`), never from what was attempted.
 */
async function settleModelSwitch(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState | undefined,
  level: string | undefined,
): Promise<ThreadToolResult> {
  const after = await stateAfterSwitch(control)
  if (!("model" in after)) return switchUncertain(control, selected, level, after.unread)
  if (level === undefined || previous === undefined || !sameModel(after.model, selected))
    return classifySwitch(control, { selected, level, previous, final: after })
  const attempt = await applyLevelOrRollBack(control, selected, previous, level)
  const final = await stateAfterSwitch(control)
  if (!("model" in final)) return switchUncertain(control, selected, level, final.unread)
  return classifySwitch(control, { selected, level, previous, final, ...attempt })
}

/** What the level step left: the holder's typed refusal of the level, or the failure that started the rollback. */
type LevelAttempt = { readonly refusal?: ThreadToolResult; readonly cause?: unknown; readonly rolledBack?: boolean }

/**
 * The level onto the selected model, now in effect. A refused or failed level rolls the switch back toward `previous`:
 * the model, unless something other than this call changed it meanwhile, then the level. A rollback step that fails is
 * not answered here: the state read after it decides the outcome, and its cause travels in `details.detail`.
 */
async function applyLevelOrRollBack(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
): Promise<LevelAttempt> {
  let refusal: ThreadToolResult | undefined
  try {
    refusal = await applyThinkingLevel(control, level)
  } catch (error) {
    return { cause: error, rolledBack: true, ...(await rollBack(control, selected, previous)) }
  }
  if (refusal === undefined) return {}
  return { refusal, rolledBack: true, ...(await rollBack(control, selected, previous)) }
}

async function rollBack(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
): Promise<{ readonly rollbackCause?: unknown }> {
  try {
    const current = await control.getModelState()
    if (current === undefined) return { rollbackCause: "model_state_unavailable" }
    if (!sameModel(current.model, previous.model)) {
      if (!sameModel(current.model, selected)) return { rollbackCause: "active_model_changed" }
      await control.setModel(previous.model.provider, previous.model.id)
    }
    const restored = await control.getModelState()
    if (restored !== undefined && restored.thinkingLevel !== previous.thinkingLevel)
      await control.setThinkingLevel(previous.thinkingLevel)
    return {}
  } catch (error) {
    return { rollbackCause: error }
  }
}

type SwitchPart = "model" | "thinking_level"

/**
 * #14939 review: the outcome of a switch, from the state observed after it settled. Each part the call asked to change
 * (the model; the level with a suffix) is compared with its value before the call and the value asked for: every
 * changing part at the asked value is `applied`; the asked model held for compaction is `after_compaction`; some parts
 * at the asked value and some not is `partial_commit`, listing only the parts observed at the asked value; none at the
 * asked value is `not_applied`, `unchanged` when every part still has its value from before the call and no other switch
 * is held, `changed_elsewhere` otherwise. A part asked at the value it already had is listed in neither list.
 */
function classifySwitch(
  control: SessionControl,
  facts: {
    readonly selected: ThreadModel
    readonly level: string | undefined
    readonly previous: SessionModelState | undefined
    readonly final: SessionModelState
  } & LevelAttempt & { readonly rollbackCause?: unknown },
): ThreadToolResult {
  const { selected, level, previous, final } = facts
  const parts: readonly {
    readonly part: SwitchPart
    readonly asked: boolean
    readonly before: boolean | undefined
    readonly changing: boolean
  }[] = [
    {
      part: "model",
      asked: sameModel(final.model, selected),
      before: previous === undefined ? undefined : sameModel(final.model, previous.model),
      changing: previous === undefined || !sameModel(selected, previous.model),
    },
    ...(level === undefined
      ? []
      : [
          {
            part: "thinking_level" as const,
            asked: final.thinkingLevel === level,
            before: previous === undefined ? undefined : final.thinkingLevel === previous.thinkingLevel,
            changing: previous === undefined || level !== previous.thinkingLevel,
          },
        ]),
  ]
  const changing = parts.filter((part) => part.changing)
  const applied = changing.filter((part) => part.asked)
  if (changing.length === 0 ? parts.every((part) => part.asked) : applied.length === changing.length)
    return switchApplied(control, selected, final)
  const heldSelected = final.pendingModel !== undefined && sameModel(final.pendingModel, selected)
  if (heldSelected && !parts[0]?.asked && parts.every((part) => part.before !== false))
    return {
      kind: "ok",
      ...controlIdentity(control),
      model: selected,
      model_switch: "after_compaction",
      in_effect: inEffect(final),
      pending: {
        model: selected,
        ...(level === undefined ? {} : { thinking_level: level, thinking_level_sent: false }),
      },
    }
  const cause = facts.cause ?? facts.rollbackCause
  // A plain switch reads no state before it (a relay round trip it cannot afford): the confirmation read proves the
  // request is not in effect, not whether anything else moved.
  if (previous === undefined)
    return switchNotApplied(control, { selected, level, final, reason: "not_compared", cause })
  if (applied.length > 0)
    return partialModelSwitch(control, {
      selected,
      previous,
      level,
      final,
      applied: applied.map((part) => part.part),
      notApplied: changing.filter((part) => !part.asked).map((part) => part.part),
      reason: facts.rolledBack === true ? "rollback_incomplete" : "thinking_level_unconfirmed",
      cause,
    })
  const unchanged = parts.every((part) => part.before === true) && final.pendingModel === undefined
  // The holder's typed refusal of the level, its rollback complete, stays that refusal: nothing changed and it says why.
  if (unchanged && facts.refusal !== undefined && facts.refusal.kind === "error")
    return {
      kind: "error",
      error: { ...facts.refusal.error, details: { ...facts.refusal.error.details, in_effect: inEffect(final) } },
    }
  return switchNotApplied(control, {
    selected,
    level,
    final,
    reason: unchanged ? "unchanged" : "changed_elsewhere",
    cause,
  })
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

const NOT_APPLIED_MESSAGES = {
  unchanged: "its state is the one it had before the call",
  changed_elsewhere: "its state changed in a way this call did not ask for",
  not_compared: "no switch to it is held",
} as const

/**
 * The holder answered the switch and its state shows none of the asked parts in effect and no switch to the asked model
 * held. Where the state before the call was read (a suffix): `unchanged` when it is that state, `changed_elsewhere` when
 * something else moved it; a plain switch reads none, so it is `not_compared` and claims nothing about the rest.
 */
function switchNotApplied(
  control: SessionControl,
  facts: {
    readonly selected: ThreadModel
    readonly level: string | undefined
    readonly final: SessionModelState
    readonly reason: keyof typeof NOT_APPLIED_MESSAGES
    readonly cause?: unknown
  },
): ThreadToolResult {
  const { selected, level, final, reason, cause } = facts
  return failure(
    "not_applied",
    `The switch to ${selected.provider}/${selected.id} is not in effect: ${NOT_APPLIED_MESSAGES[reason]}.`,
    "The request is not in effect; it is safe to repeat the call, or pick another model.",
    {
      ...controlIdentity(control),
      reason,
      selected_model: selected,
      ...(level === undefined ? {} : { requested_thinking_level: level }),
      in_effect: inEffect(final),
      ...(final.pendingModel === undefined ? {} : { pending: { model: final.pendingModel } }),
      ...(cause === undefined ? {} : { detail: failureDetail(cause) }),
    },
  )
}

/**
 * The holder's state before a switch with a suffix, which a refused level rolls back to and the outcome compares with. A
 * plain switch reads none. A read that fails throws its own failure and a target that reports none is refused, both
 * before any write.
 */
async function stateBeforeSwitch(
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

function sameModel(left: ThreadModel, right: ThreadModel): boolean {
  return left.provider === right.provider && left.id === right.id
}

/**
 * Some asked parts are in effect and some are not, as observed after the switch (and any rollback) settled:
 * `details.partial` lists only the parts observed at the asked value, and `in_effect` the observed state.
 */
function partialModelSwitch(
  control: SessionControl,
  facts: {
    readonly selected: ThreadModel
    readonly previous: SessionModelState
    readonly level: string | undefined
    readonly final: SessionModelState
    readonly applied: readonly SwitchPart[]
    readonly notApplied: readonly SwitchPart[]
    readonly reason: "rollback_incomplete" | "thinking_level_unconfirmed"
    readonly cause?: unknown
  },
): ThreadToolResult {
  const { selected, previous, level, final, applied, notApplied, reason, cause } = facts
  return failure(
    "partial_commit",
    `The switch did not complete: ${applied.join(" and ")} took effect, ${notApplied.join(" and ")} did not.`,
    "Read details.partial for what is in effect, then set what did not take effect again: the model with thread_set_model, the level with thread_set_reasoning (tool.thread_set_model() and tool.thread_set_reasoning() in an eval cell).",
    {
      ...controlIdentity(control),
      reason,
      partial: { applied, not_applied: notApplied, in_effect: inEffect(final) },
      previous_model: previous.model,
      previous_thinking_level: previous.thinkingLevel,
      selected_model: selected,
      ...(level === undefined ? {} : { requested_thinking_level: level }),
      ...(cause === undefined ? {} : { detail: failureDetail(cause) }),
    },
  )
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
