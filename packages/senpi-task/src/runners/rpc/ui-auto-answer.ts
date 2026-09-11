import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@code-yeongyu/senpi"

type QuestionUiRequest = {
  readonly type: "extension_ui_request"
  readonly id: string
  readonly method: "question"
}

/**
 * Auto-answer an extension UI request with a safe deny/cancel default so a
 * headless child never blocks waiting for human input. Display-only requests
 * (notify/setStatus/setWidget/setTitle/set_editor_text/custom_unsupported) do
 * not expect a response and return null.
 */
export function buildAutoUiResponse(
  request: RpcExtensionUIRequest | QuestionUiRequest,
): RpcExtensionUIResponse | null {
  switch (request.method) {
    case "confirm":
      return { type: "extension_ui_response", id: request.id, confirmed: false }
    case "select":
    case "input":
    case "editor":
    case "question":
      return { type: "extension_ui_response", id: request.id, cancelled: true }
    default:
      return null
  }
}
