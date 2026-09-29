import type { GatewayEndpointRef, UiAnswer, UiAnswerReply } from "./gateway/adapter"

type FrameCall = (socket: string, type: string, data: Record<string, unknown>) => Promise<{ readonly success?: boolean; readonly error?: unknown }>

/**
 * The `extension_ui_response` a relayed answer becomes (senpi#2372): `uiRequestId` names the request,
 * and the frame keeps its own correlation `id` for the reply. The relay holds only the answer's text,
 * not which dialog asked, so the frame carries it in both shapes senpi reads: `value` for a host
 * dialog, and `answers: {}` with the text as `comment` for a `question` (the only kind a terminal
 * asks). Each surface reads the fields of its own request and ignores the rest.
 */
export async function answerUiRequest(call: FrameCall, endpoint: GatewayEndpointRef, answer: UiAnswer): Promise<UiAnswerReply> {
  const target = endpoint.kind === "rpc_host" && endpoint.routing_id !== null ? { sessionId: endpoint.routing_id } : {}
  const reply = await call(endpoint.socket, "extension_ui_response", { ...target, uiRequestId: answer.ui_request_id, value: answer.text, answers: {}, comment: answer.text })
  if (reply.success === true) return { delivered: true }
  return { delivered: false, error: typeof reply.error === "string" ? reply.error : "refused" }
}
