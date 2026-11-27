import { threadToolFailure } from "../errors"
import { authenticateRpcHost, withRpcSocket, type RpcObject } from "@oh-my-opencode/senpi-task/rpc-socket-client"
import { fencedCommand } from "../attachment-fence"
import type { ThreadCreateInput, ThreadToolResult } from "../contracts"
import type { DeliveryTarget } from "../gateway/transport"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { sessionPort, targetSession } from "../tools/internals"
import { UNKNOWN_CALLER } from "../tools/ports"
import { holdFamily } from "../tools/row-liveness"

type RecordData = Readonly<Record<string, unknown>>
type Refusal =
  | "unsupported"
  | "identity_mismatch"
  | "stopped"
  | "resume_through_parent"
  | "not_paused"
  | "stale"
  | "engine_turn_cap"
  | "unrecognized_hold"
export type ResumeAnswer =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly resumed: true
      readonly turn_started: boolean
      readonly held_deliveries?: number | null
    }
  | { readonly kind: "error"; readonly error: ReturnType<typeof threadToolFailure> }

export async function resumeLocalSocket(
  socket: string,
  routing: string,
  durable: string,
  dial: Parameters<typeof withRpcSocket>[1]["connect"],
  secret: Uint8Array | undefined,
  keyRoot: () => string,
): Promise<ResumeAnswer> {
  return withRpcSocket(
    socket,
    { connect: dial, secret, timeoutMs: 10_000, readCommand: "resume_session" },
    async (request) => {
      const hello =
        secret === undefined
          ? await authenticateRpcHost(request, socket, keyRoot)
          : await request({ type: "get_protocol_info", observe: true })
      const info =
        hello.success === true && hello.data && typeof hello.data === "object" ? (hello.data as RpcObject) : {}
      if (!Array.isArray(info.capabilities) || !info.capabilities.includes("attach_session"))
        return denied(durable, "unsupported")
      return guardedResume(durable, info, async (command) => {
        const frame = { ...command, sessionId: routing }
        const reply = await fencedCommand(
          request,
          socket,
          frame,
          new Set(info.capabilities as unknown[]),
          durable,
          () => request(frame),
          { attached: true },
        )
        if (reply.success !== true || !reply.data || typeof reply.data !== "object")
          throw new Error("thread RPC request refused")
        return reply.data as RecordData
      })
    },
  )
}

function denied(thread: string, reason: Refusal): ResumeAnswer {
  const standing =
    reason === "stopped"
      ? { hold: "session_hold", release_by: "person" }
      : reason === "resume_through_parent"
        ? { hold: "inherited_hold", release_by: "parent" }
        : reason === "engine_turn_cap"
          ? { hold: "engine_turn_cap", release_by: "person" }
          : reason === "unrecognized_hold"
            ? { hold: "other", release_by: "owner" }
            : {}
  const next =
    reason === "stopped"
      ? "The person who stopped this session must resume it."
      : reason === "resume_through_parent"
        ? "Resume the owning run from its parent."
        : reason === "unsupported"
          ? "Update the holding engine to one that proves guarded resume support."
          : reason === "engine_turn_cap"
            ? "A person must resume this engine-turn cap."
            : reason === "unrecognized_hold"
              ? "Inspect the hold in the session; its owner must release it."
              : "Read the current session state before trying again."
  return {
    kind: "error",
    error: threadToolFailure(
      reason === "unsupported" ? "unsupported" : "not_resumable",
      `The session was not resumed (${reason}).`,
      next,
      { thread, reason, ...standing },
    ),
  }
}

/** Called after send authority and the live target have been resolved. All commands must use the same authenticated attachment. */
export async function guardedResume(
  thread: string,
  protocol: RecordData,
  request: (command: RecordData) => Promise<RecordData>,
): Promise<ResumeAnswer> {
  // `resume_session` alone predates unlessStopped. The newer row capability is sufficient proof;
  // never fall back to a bare resume or trust the version from a cached listing.
  const caps = protocol.capabilities
  if (!Array.isArray(caps) || !["session_row_hold", "resume_session"].every((cap) => caps.includes(cap)))
    return denied(thread, "unsupported")
  const state = await request({ type: "get_state" })
  if (state.sessionId !== thread) return denied(thread, "identity_mismatch")
  const pause = state.pause
  if (
    !pause ||
    typeof pause !== "object" ||
    !("records" in pause) ||
    !Array.isArray(pause.records) ||
    !("pauseSeq" in pause) ||
    typeof pause.pauseSeq !== "number" ||
    !Number.isSafeInteger(pause.pauseSeq) ||
    pause.pauseSeq < 0
  )
    return denied(thread, "unsupported")
  const holds = pause.records.map(holdFamily)
  if (holds.some((h) => h?.kind === "inherited_hold")) return denied(thread, "resume_through_parent")
  if (holds.some((h) => h?.key === "session_hold")) return denied(thread, "stopped")
  if (!holds.length) return denied(thread, state.engineTurnCap ? "engine_turn_cap" : "not_paused")
  const interrupted = holds.filter((h) => h?.key === "interrupted-run").length
  const unattended = holds.filter((h) => h?.key === "unattended").length
  if (state.paused !== true || interrupted !== 1 || unattended > 1 || holds.length !== interrupted + unattended)
    return denied(thread, "unrecognized_hold")
  let response: RecordData
  try {
    response = await request({ type: "resume_session", expectedSeq: pause.pauseSeq, unlessStopped: true })
  } catch {
    return {
      kind: "error",
      error: threadToolFailure(
        "idempotency_uncertain",
        "The host did not confirm the resume request.",
        "Read the session before retrying.",
        { thread },
      ),
    }
  }
  if (response.resumed === true && typeof response.turnStarted === "boolean")
    return { kind: "ok", thread, resumed: true, turn_started: response.turnStarted }
  switch (response.reason) {
    case "stale":
    case "stopped":
    case "not_paused":
    case "engine_turn_cap":
    case "resume_through_parent":
      return denied(thread, response.reason)
    default:
      return {
        kind: "error",
        error: threadToolFailure(
          "idempotency_uncertain",
          "The resume request did not return a recognized receipt.",
          "Read the session before retrying.",
          { thread },
        ),
      }
  }
}

export async function resumeAddress(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  input: ThreadCreateInput,
  caller: string,
  locate: () => Promise<DeliveryTarget | { kind: "error"; result: ThreadToolResult }>,
): Promise<ThreadToolResult> {
  if (
    typeof input.thread !== "string" ||
    !input.thread.trim() ||
    Object.keys(input).some((k) => !["thread", "all_scope", "resume", "idempotency_key"].includes(k))
  )
    return {
      kind: "error",
      error: threadToolFailure(
        "invalid_arguments",
        "Resume requires one existing thread and no creation options.",
        "Pass thread and resume: true.",
      ),
    }
  if (caller === UNKNOWN_CALLER)
    return {
      kind: "error",
      error: threadToolFailure(
        "caller_context_missing",
        "Resume needs the calling principal.",
        "Retry with the caller's session context.",
      ),
    }
  const target = await locate()
  if (target.kind === "error") return target.result
  const id = target.kind === "local" ? target.thread_id : target.row.durable_id
  if (!id) return denied(input.thread, "identity_mismatch")
  if (id === caller)
    return {
      kind: "error",
      error: threadToolFailure(
        "loop_detected",
        "A session cannot resume itself through a peer operation.",
        "Use the session's local resume action.",
      ),
    }
  if (target.kind === "remote")
    return {
      kind: "error",
      error: threadToolFailure(
        "unsupported",
        "Guard support for the target cannot be proven on this remote route.",
        "Resume on the holding device; no remote resume was sent.",
        { thread: id, reason: "guard_support_unproven", device: target.row.device },
      ),
    }
  const session = targetSession(current, id)
  if (!session || session.status === "closed") return denied(id, "not_paused")
  const port = sessionPort(options, session)
  if (!port.resumeGuarded) return denied(id, "unsupported")
  const result = await port.resumeGuarded(session.sessionId, id)
  return result.kind === "ok"
    ? {
        ...result,
        held_deliveries: session.row_evidence?.kind === "held" ? session.row_evidence.hold.queue_depth : null,
      }
    : result
}
