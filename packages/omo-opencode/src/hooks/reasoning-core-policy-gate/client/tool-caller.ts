import type { ReasoningCoreTransport } from "./transport-interface"
import type { JsonRpcRequest } from "./json-rpc-message"
import { ReasoningCoreInfrastructureError } from "./infrastructure-error"
import { extractToolPayload } from "./mcp-payload-extractor"

export async function callTool(
  transport: ReasoningCoreTransport,
  name: string,
  toolArguments: Record<string, unknown>,
  sessionKey?: string,
): Promise<unknown> {
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: 0,
    method: "tools/call",
    params: { name, arguments: toolArguments },
  }
  const response = await transport.sendRequest(request, sessionKey ? { sessionKey } : undefined)
  const payload = extractToolPayload(response)
  if (payload == null) {
    throw new ReasoningCoreInfrastructureError("empty", "reasoning-core returned an empty response")
  }
  return payload
}
