import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"

export const protocolHttpFetch: FetchLike = async (input, init) => {
  if (typeof init?.body !== "string") return fetch(input, init)
  const message: { method?: string; params?: { name?: string; uri?: string; _meta?: Record<string, unknown> } } = JSON.parse(init.body)
  if (!message.params?._meta?.["io.modelcontextprotocol/protocolVersion"]) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set("Mcp-Method", String(message.method))
  const name = message.method === "resources/read" ? message.params.uri
    : message.method === "tools/call" || message.method === "prompts/get" ? message.params.name : undefined
  if (name !== undefined) {
    headers.set("Mcp-Name", /^[\x21-\x7e]+$/.test(name) && !name.startsWith("=?base64?")
      ? name : `=?base64?${Buffer.from(name).toString("base64")}?=`)
  }
  const response = await fetch(input, { ...init, headers })
  if (response.status === 400 && response.headers.get("content-type")?.includes("application/json")) {
    const body: unknown = await response.clone().json()
    if (typeof body === "object" && body !== null && "error" in body
      && typeof body.error === "object" && body.error !== null && "code" in body.error
      && body.error.code === -32022) {
      return new Response(response.body, { status: 200, headers: response.headers })
    }
  }
  return response
}
