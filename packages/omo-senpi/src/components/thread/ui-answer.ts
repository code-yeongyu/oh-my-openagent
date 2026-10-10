import type { GatewayEndpointRef, UiAnswer, UiAnswerReply } from "./gateway/adapter"

type FrameCall = (socket: string, type: string, data: Record<string, unknown>) => Promise<{ readonly success?: boolean; readonly error?: unknown }>

/**
 * The `extension_ui_response` a relayed answer becomes (senpi#2372): `uiRequestId` names the request,
 * and the frame keeps its own correlation `id` for the reply. The answer travels in the fields its
 * request kind reads (`gateway/answer-shape.ts`): `value`, `confirmed`, or `answers` + `comment`.
 */
export async function answerUiRequest(call: FrameCall, endpoint: GatewayEndpointRef, answer: UiAnswer): Promise<UiAnswerReply> {
  const target = endpoint.kind === "rpc_host" && endpoint.routing_id !== null ? { sessionId: endpoint.routing_id } : {}
  const reply = await call(endpoint.socket, "extension_ui_response", { ...target, uiRequestId: answer.ui_request_id, ...answer.fields })
  if (reply.success === true) return { delivered: true }
  return { delivered: false, error: typeof reply.error === "string" ? reply.error : "refused" }
}
