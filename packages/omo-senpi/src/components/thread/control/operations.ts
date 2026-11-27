import type { ThreadCloseInput, ThreadModel, ThreadSetReasoningInput, ThreadToolResult } from "../contracts"
import { retireThread } from "../retired"
import { retirementHere } from "../wake/session-target"
import type { LocatedControl } from "./locate"
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
 * `thread_close` of a located thread (the tools and the SDK): a close retires the thread (`retired.ts`), live or not, so
 * no later delivery, wake or reopen for a read or a send resumes it (2026-11-27). A thread nothing runs is retired
 * without a record to the engine (`retired`); one already retired answers `already_retired`. `sessions` absent (a
 * surface with no session directory) closes as before, retiring nothing.
 */
export async function closeLocated(
  located: Exclude<LocatedControl, { readonly kind: "error" }>,
  value: Pick<ThreadCloseInput, "force" | "graceful" | "wait_ms" | "role" | "successor">,
  retirement: { readonly sessions: string | undefined; readonly now: () => number },
): Promise<ThreadToolResult> {
  const { sessions } = retirement
  const retire = (thread: string): void => {
    if (sessions === undefined) return
    retireThread(sessions, thread, {
      retired_at: retirement.now(),
      ...(value.role === undefined ? {} : { role: value.role }),
      ...(value.successor === undefined ? {} : { successor: value.successor }),
    })
  }
  if (located.kind === "not_live") {
    const answer = { kind: "ok" as const, ...controlIdentity(located), dropped_deliveries: [] }
    if (sessions === undefined) return { ...answer, closed: false, reason: "not_live" }
    if (retirementHere(sessions, located.thread_id) !== undefined)
      return { ...answer, closed: false, reason: "already_retired" }
    retire(located.thread_id)
    return { ...answer, closed: true, reason: "retired" }
  }
  const closed = await closeThread(located.control, closeOptions(value))
  if (closed.kind !== "ok" || sessions === undefined) return closed
  retire(located.control.thread_id)
  return "reason" in closed && closed.reason === "not_live" ? { ...closed, closed: true, reason: "retired" } : closed
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
    // The engine's refusal is the more specific answer when the target also cannot report its model state now; any other
    // failure (a transport error reading that state) is its own answer.
    try {
      previous = await modelBeforeSwitch(control, rematched.thinkingLevel)
    } catch (stateError) {
      if (controlRefusalOf(stateError)?.details?.reason === "model_state_unavailable") throw error
      throw stateError
    }
    selected = await control.setModel(rematched.model.provider, rematched.model.id)
    matched = rematched
  }
  if (previous !== undefined && matched.thinkingLevel !== undefined) {
    const refusal = await applyModelThinking(control, selected, previous, matched.thinkingLevel)
    if (refusal !== undefined) return refusal
  }
  return { kind: "ok", ...controlIdentity(control), model: { provider: selected.provider, id: selected.id } }
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

async function applyModelThinking(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
): Promise<ThreadToolResult | undefined> {
  // A set_model receipt can acknowledge a switch held for compaction. Never apply the level to the old model.
  try {
    const active = await control.getModelState()
    if (active === undefined || !sameModel(active.model, selected))
      return partialModelSwitch(control, selected, previous, level, "model_switch_unconfirmed")
  } catch (error) {
    return partialModelSwitch(control, selected, previous, level, "model_switch_unconfirmed", error)
  }
  let refusal: ThreadToolResult | undefined
  try {
    refusal = await applyThinkingLevel(control, level)
  } catch (error) {
    const partial = await restoreModelState(control, selected, previous, level)
    if (partial !== undefined) return partial
    throw error
  }
  if (refusal !== undefined) return (await restoreModelState(control, selected, previous, level)) ?? refusal
}

function sameModel(left: ThreadModel, right: ThreadModel): boolean {
  return left.provider === right.provider && left.id === right.id
}

function partialModelSwitch(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
  reason: "model_switch_unconfirmed" | "model_restore_failed",
  error?: unknown,
): ThreadToolResult {
  return failure(
    "partial_commit",
    "The model and thinking change did not complete and the prior state could not be confirmed.",
    "Read the target's current model and thinking level before retrying.",
    {
      ...controlIdentity(control),
      reason,
      previous_model: previous.model,
      previous_thinking_level: previous.thinkingLevel,
      selected_model: selected,
      requested_thinking_level: level,
      ...(error === undefined
        ? {}
        : { detail: controlRefusalOf(error)?.code ?? (error instanceof Error ? error.message : String(error)) }),
    },
  )
}

async function restoreModelState(
  control: SessionControl,
  selected: ThreadModel,
  previous: SessionModelState,
  level: string,
): Promise<ThreadToolResult | undefined> {
  const partial = (error: unknown) =>
    partialModelSwitch(control, selected, previous, level, "model_restore_failed", error)
  try {
    let current = await control.getModelState()
    if (current === undefined) return partial("model_state_unavailable")
    if (!sameModel(current.model, previous.model)) {
      if (!sameModel(current.model, selected)) return partial("active_model_changed")
      await control.setModel(previous.model.provider, previous.model.id)
      current = await control.getModelState()
      if (current === undefined || !sameModel(current.model, previous.model)) return partial("restore_unconfirmed")
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
