import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@code-yeongyu/senpi"

/**
 * Auto-answer an extension UI request with a safe deny/cancel default so a
 * headless child never blocks waiting for human input. Display-only requests
 * (notify/setStatus/setWidget/setTitle/set_editor_text/custom_unsupported) do
 * not expect a response and return null.
 */
export function buildAutoUiResponse(request: RpcExtensionUIRequest): RpcExtensionUIResponse | null {
  switch (request.method) {
    case "confirm":
      return { type: "extension_ui_response", id: request.id, confirmed: false }
    case "select":
    case "input":
    case "editor":
      return { type: "extension_ui_response", id: request.id, cancelled: true }
    default:
      return null
  }
}
