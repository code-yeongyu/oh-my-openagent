import type { ExternalAdmissionKind, GatewayWakeReply, ReleaseSessionReply } from "./gateway/adapter"

type ReplyFrame = { readonly success?: boolean; readonly data?: unknown; readonly error?: unknown; readonly errorData?: unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }

/** senpi's `release_session` frame as the adapter's union: the success payload, or the refusal code with its `errorData`. */
export function releaseReply(frame: ReplyFrame): ReleaseSessionReply {
  if (frame.success === true && record(frame.data) && frame.data.released === true && typeof frame.data.session_path === "string") {
    return { success: true, data: frame.data as Extract<ReleaseSessionReply, { success: true }>["data"] }
  }
  const error = typeof frame.error === "string" ? frame.error : "release_failed"
  return record(frame.errorData)
    ? { success: false, error, errorData: frame.errorData as NonNullable<Extract<ReleaseSessionReply, { success: false }>["errorData"]> }
    : { success: false, error }
}

const EXTERNAL_ADMISSION_KINDS: ReadonlySet<string> = new Set<ExternalAdmissionKind>(["started", "queued", "steered", "turn_conflict", "held_draft", "already_admitted"])

export function wakeReply(data: { readonly admitted?: unknown }): GatewayWakeReply {
  if (!Array.isArray(data.admitted)) return { admitted: [] }
  return {
    admitted: data.admitted.flatMap((entry: unknown) =>
      record(entry) && typeof entry.delivery_id === "string" && typeof entry.kind === "string" && EXTERNAL_ADMISSION_KINDS.has(entry.kind)
        ? [{ delivery_id: entry.delivery_id, kind: entry.kind as ExternalAdmissionKind }]
        : [],
    ),
  }
}
