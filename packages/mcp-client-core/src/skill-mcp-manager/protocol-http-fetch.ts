import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"

type OutgoingMessage = { method?: string; params?: { name?: string; uri?: string; _meta?: Record<string, unknown> } }

// A body this layer cannot read is not a modern request; the server answers it as it is (omo#11406).
function parseOutgoing(body: string): OutgoingMessage | undefined {
  try {
    const message: unknown = JSON.parse(body)
    return typeof message === "object" && message !== null ? (message as OutgoingMessage) : undefined
  } catch {
    return undefined
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json()
  } catch {
    return undefined
  }
}

export const protocolHttpFetch: FetchLike = async (input, init) => {
  if (typeof init?.body !== "string") return fetch(input, init)
  const message = parseOutgoing(init.body)
  if (!message?.params?._meta?.["io.modelcontextprotocol/protocolVersion"]) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set("Mcp-Method", String(message.method))
  const name =
    message.method === "resources/read"
      ? message.params.uri
      : message.method === "tools/call" || message.method === "prompts/get"
        ? message.params.name
        : undefined
  if (name !== undefined) {
    headers.set(
      "Mcp-Name",
      /^[\x21-\x7e]+$/.test(name) && !name.startsWith("=?base64?")
        ? name
        : `=?base64?${Buffer.from(name).toString("base64")}?=`,
    )
  }
  const response = await fetch(input, { ...init, headers })
  if (response.status === 400 && response.headers.get("content-type")?.includes("application/json")) {
    // A malformed error body stays the server's HTTP error instead of becoming a parse exception.
    const body = await readJson(response)
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      body.error.code === -32022
    ) {
      return new Response(response.body, { status: 200, headers: response.headers })
    }
  }
  return response
}
