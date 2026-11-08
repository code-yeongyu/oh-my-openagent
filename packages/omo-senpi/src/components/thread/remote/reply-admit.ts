import { THREAD_MESSAGE_MAX_BYTES } from "../contracts/fields"
import type { Provenance } from "../gateway/types"
import { peerText, type RemotePeer } from "./peer-text"
import type { JsonObject, RemoteThreadSurface } from "./ports"
import { remoteAvailable, replyData } from "./remote-ops"
import type { ReplyRoute, SentTarget } from "./reply-route"

// The refusals that mean the other side has no `admit_external_message` record (senpi#6233): the reply cannot be
// admitted as a delivery there, and it is never downgraded to a user prompt. The device service refuses a record the engine's method classes do not name before it leaves the device
// (`method_unclassified`, device-service-core local-api vocabulary), and senpi's delegated connection refuses an
// unclassified type (`delegation_unclassified`); the others are an older engine's own refusal of an unknown command.
/** The line a reply carries when another input (a user message, another peer's prompt or delivery) landed in the same run. */
export const OTHER_INPUT_LABEL = "This answer may include content from other input in the same turn."

const ADMIT_UNSUPPORTED: ReadonlySet<string> = new Set(["method_unclassified", "delegation_unclassified", "unknown_command", "engine_capability_missing", "unsupported_command", "method_unknown"])

export type ReplyAdmission =
  | { readonly kind: "admitted"; readonly disposition: string }
  /** The run already reached the sender's session with a thread_send of its own; that message was the reply. */
  | { readonly kind: "answered" }
  | { readonly kind: "unavailable"; readonly code: "remote_reply_unavailable"; readonly reason: string }
  /** The sender's user is composing in that terminal, so nothing was delivered; the same delivery id can be retried. */
  | { readonly kind: "held" }
  | { readonly kind: "failed"; readonly reason: string }

export type ReplyFrom = { readonly session_id: string; readonly name?: string; readonly provenance: Provenance }

/**
 * A session's answer to a peer send, delivered back into the sending session as a peer delivery (senpi#6233
 * `admit_external_message`): the sender label is the receiving engine's to stamp from the authenticated peer, so only an
 * `agent` claim is sent; the chain continues (`chainCount`); the delivery id is derived from the delivery it answers, so a
 * repeated reply is the same delivery and the receiver admits it once. The body names the delivery it answers and, when
 * another input landed in the same run, says the answer may cover it too.
 */
export async function admitReplyRemote(remote: RemoteThreadSurface, route: ReplyRoute, from: ReplyFrom, answer: string | undefined, answered: readonly SentTarget[] = [], otherInput = false): Promise<ReplyAdmission> {
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "failed", reason: unavailable.error.code }
  const located = await remote.sessions.locate(route.device, route.session)
  if (located.kind !== "ok") return { kind: "failed", reason: located.reason }
  // A send resolves any address form (id, name, alias) to the listing key it reached; the route names the durable id.
  if (answered.some((sent) => sent.device === route.device && (sent.thread === route.session || sent.thread === located.sessionId))) return { kind: "answered" }
  const here = await remote.sessions.thisDevice()
  const named = from.name === undefined || from.name.trim() === "" ? undefined : from.name.trim()
  const peer: RemotePeer = {
    session_id: from.session_id,
    ...(named === undefined ? {} : { name: named }),
    provenance: named === undefined ? from.provenance : { ...from.provenance, session: named },
    delivery_id: `reply-${route.delivery}`,
    root_id: route.root,
    hop: route.hop + 1,
  }
  const lines = [`Reply to delivery ${route.delivery}.`]
  if (otherInput) lines.push(OTHER_INPUT_LABEL)
  lines.push(answer === undefined ? "(The run ended without a text answer.)" : answer)
  const body = capBytes(lines.join("\n"), THREAD_MESSAGE_MAX_BYTES)
  const record: JsonObject = {
    type: "admit_external_message",
    sessionId: located.sessionId,
    deliveryId: peer.delivery_id,
    text: peerText(peer, here, { message: body }, "follow_up"),
    displayText: body,
    sender: { kind: "agent", session_id: peer.session_id, ...(named === undefined ? {} : { name: named }) },
    deliverAs: "followUp",
    chainCount: peer.hop,
  }
  const outcome = await remote.sessions.sessionCommand(route.device, located.sessionId, record)
  if (outcome.kind === "refused" && (ADMIT_UNSUPPORTED.has(outcome.reason) || outcome.reason.startsWith("Unknown command"))) return { kind: "unavailable", code: "remote_reply_unavailable", reason: outcome.reason }
  if (outcome.kind === "refused" && outcome.reason === "held_draft") return { kind: "held" }
  if (outcome.kind !== "ok") return { kind: "failed", reason: outcome.reason }
  const disposition = replyData(outcome.response)["kind"]
  if (disposition === "held_draft") return { kind: "held" }
  return typeof disposition === "string" ? { kind: "admitted", disposition } : { kind: "failed", reason: "no_disposition" }
}

function capBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= maxBytes) return text
  return `${bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD+$/, "")}\n[Answer truncated to ${maxBytes} bytes; thread_read the answering thread for the rest.]`
}
