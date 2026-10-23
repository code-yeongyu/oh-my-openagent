/**
 * The layer-2 toolkit replay identity (engine side; ships as `runtime/dori/replay.js`). The engine
 * derives every part of it from its own data - the stamped caller, the assistant entry on its branch,
 * the tool call that is the calling cell - and the op's receipt is committed with the op in the
 * gateway store, so a committed effect is recorded at the point of effect and a retry whose response
 * was lost returns the recorded result instead of running again.
 */
import { createHash } from "node:crypto"

import { DORI_REPLAY_CONTEXT_ARG } from "../../ulw-loop/sdk/dori-gate"
import { toolkitReplayKey } from "../../ulw-loop/sdk/dori/replay-key"
import type { StoreExtensionResult, ToolkitReplayRequest } from "../gateway/store-extensions"

export const REPLAY_CONTEXT_ARG = DORI_REPLAY_CONTEXT_ARG

export type ReplayStopCode = "toolkit_replay_divergence" | "toolkit_replay_expired" | "toolkit_replay_turn_unknown"

export type ReplayStop = {
  readonly kind: "replay_stopped"
  readonly code: ReplayStopCode
  readonly message: string
  readonly key?: string
  readonly differs?: readonly ("op" | "args")[]
  readonly recorded_op?: string
  readonly attempted_op?: string
}

/** One call's place: the turn the calling cell started in, when that turn was written, and the call's index in the cell. */
export type ReplayTurn = { readonly turnId: string; readonly turnAt: number; readonly callIndex: number }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

/** sha256 of the arguments as JSON with every object's keys sorted, so key order never makes a call look different. */
export function argsHash(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(args ?? null))).digest("hex")
}

/** The SDK's carried context, and the arguments the op sees without it. Only that one argument is taken; key-shaped op arguments stay arguments. */
export function splitReplayContext(args: unknown): { readonly carried: unknown; readonly args: unknown } {
  if (!isRecord(args) || !Object.hasOwn(args, REPLAY_CONTEXT_ARG)) return { carried: undefined, args }
  const { [REPLAY_CONTEXT_ARG]: carried, ...rest } = args
  return { carried, args: rest }
}

type BranchEntry = { readonly type?: unknown; readonly id?: unknown; readonly timestamp?: unknown; readonly message?: { readonly role?: unknown; readonly content?: unknown } }

/**
 * The turn a call belongs to, issued only from the calling session's own branch: the assistant entry
 * holding the tool call that is the calling cell (the carried eval cell, or the tool call itself when
 * the model called the tool directly). A cell that outlives its turn keeps that turn; a cell id that
 * is not a tool call on the caller's branch, or a malformed index, is refused.
 */
export function resolveReplayTurn(callerDurableId: string, ectx: unknown, carried: unknown, toolCallId: string): ReplayTurn | ReplayStop {
  let cell = toolCallId
  let callIndex = 0
  if (carried !== undefined) {
    if (!isRecord(carried) || typeof carried.cell !== "string" || carried.cell.length === 0 || !Number.isSafeInteger(carried.index) || (carried.index as number) < 0) {
      return stop("toolkit_replay_turn_unknown", "The carried replay context is malformed; the call was not run.")
    }
    cell = carried.cell
    callIndex = carried.index as number
  }
  const manager = (ectx as { readonly sessionManager?: { readonly getBranch?: () => readonly unknown[] } } | undefined)?.sessionManager
  const branch = typeof manager?.getBranch === "function" ? manager.getBranch() : []
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as BranchEntry | undefined
    if (entry?.type !== "message" || entry.message?.role !== "assistant" || typeof entry.id !== "string") continue
    const content = Array.isArray(entry.message.content) ? entry.message.content : []
    if (!content.some((part) => isRecord(part) && part.type === "toolCall" && part.id === cell)) continue
    const turnAt = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN
    if (!Number.isFinite(turnAt)) break
    return { turnId: `${callerDurableId}:${entry.id}/${cell}`, turnAt, callIndex }
  }
  return stop("toolkit_replay_turn_unknown", `Cell ${cell} is not a tool call on the calling session's branch, so this engine did not issue its turn; the call was not run.`)
}

/** The durable request the store commits with the op: key, op, canonical arguments hash, and the turn's time. */
export function replayRequestFor(turn: ReplayTurn, op: string, args: unknown): ToolkitReplayRequest {
  return { key: toolkitReplayKey(turn.turnId, turn.callIndex), op, args_sha256: argsHash(args), turn_at: turn.turnAt }
}

function stop(code: ReplayStopCode, message: string, fields: Omit<ReplayStop, "kind" | "code" | "message"> = {}): ReplayStop {
  return { kind: "replay_stopped", code, message, ...fields }
}

/** The store's refusal carries the structured stop in a stable machine-readable tail; both sides are pinned by tests. */
const DIFFERENCE_MATCH = /^Replayed call (\["turn".*?\]) differs from what its key recorded; it was not run again\. replay_differs=([a-z,]+) recorded_op=(\S+) attempted_op=(\S+)/

/**
 * A store refusal from the replay path, as the layer-2 tool's answer: the typed stop carries the key,
 * what differed and the recorded op. Anything else returns the store's own result unchanged.
 */
export function replayResultOf(result: StoreExtensionResult<unknown>): StoreExtensionResult<unknown> | ReplayStop {
  if (result.kind !== "refused") return result
  if (result.code === "toolkit_replay_expired") return stop("toolkit_replay_expired", result.message)
  if (result.code !== "toolkit_replay_divergence") return result
  const match = DIFFERENCE_MATCH.exec(result.message)
  if (match === null) return result
  const differs = match[2].split(",").filter((part) => part === "op" || part === "args") as ("op" | "args")[]
  return stop("toolkit_replay_divergence", result.message, { key: match[1], differs, recorded_op: match[3], attempted_op: match[4] })
}
