import { readFile } from "node:fs/promises"

import type { ToolkitGrant } from "./index"

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid desktop toolkit response")
  return value as Record<string, unknown>
}

async function responseMessage(response: Response, id: number): Promise<Record<string, unknown>> {
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim()
  if (mediaType === "application/json") {
    const message = object(await response.json())
    if (message.jsonrpc !== "2.0" || message.id !== id) throw new Error("invalid desktop toolkit response id")
    return message
  }
  if (mediaType !== "text/event-stream" || response.body === null) throw new Error("invalid desktop toolkit response type")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let data: string[] = []
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("desktop toolkit stream ended without a response")
      buffer += decoder.decode(chunk.value, { stream: true })
      for (;;) {
        const end = buffer.search(/[\r\n]/)
        if (end < 0 || (buffer[end] === "\r" && end === buffer.length - 1)) break
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + (buffer.slice(end, end + 2) === "\r\n" ? 2 : 1))
        if (line === "") {
          if (data.length === 0) continue
          const message = object(JSON.parse(data.join("\n")))
          data = []
          if (message.jsonrpc === "2.0" && message.id === id) return message
        } else if (line === "data" || line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""))
        }
      }
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

type Request = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>

async function withClient<T>(
  grant: ToolkitGrant,
  timeoutMs: number,
  operation: (request: Request) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal === undefined ? deadline : AbortSignal.any([deadline, callerSignal])
  const token = (await readFile(grant.tokenFile, { encoding: "utf8", signal })).trim()
  if (token.length === 0) throw new Error("desktop toolkit credential unavailable")
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  })
  let nextId = 0
  async function request(method: string, params?: Record<string, unknown>, notification = false): Promise<Record<string, unknown>> {
    const id = nextId++
    const response = await fetch(grant.endpoint, {
      method: "POST", headers, redirect: "error", signal,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error("desktop toolkit HTTP request failed")
    }
    if (method === "initialize") {
      const sessionId = response.headers.get("mcp-session-id")
      if (sessionId !== null) headers.set("Mcp-Session-Id", sessionId)
    }
    if (notification) {
      await response.body?.cancel()
      return {}
    }
    const message = await responseMessage(response, id)
    if ("error" in message) throw new Error("desktop toolkit RPC request failed")
    const result = object(message.result)
    // This guard catches only the exact bearer substring in JSON, not encoded or transformed secrets.
    if (JSON.stringify(result).includes(token)) throw new Error("desktop toolkit response contains a credential")
    return result
  }
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: { extensions: { "senpi/host-tools": {} } },
      clientInfo: { name: "omo-desktop-thread", version: "1" },
    })
    if (typeof initialized.protocolVersion !== "string") throw new Error("missing desktop toolkit protocol version")
    headers.set("MCP-Protocol-Version", initialized.protocolVersion)
    await request("notifications/initialized", undefined, true)
    return await operation(request)
  } finally {
    if (headers.has("Mcp-Session-Id")) {
      try {
        const response = await fetch(grant.endpoint, { method: "DELETE", headers, redirect: "error", signal: AbortSignal.timeout(2_000) })
        await response.body?.cancel()
      } catch {
        // Best-effort session cleanup must not replace the operation's outcome.
      }
    }
  }
}

interface DesktopTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema: Record<string, unknown>
  readonly attachment?: {
    readonly name: string
    readonly label: string
    readonly exposure?: "direct" | "search" | "eval" | "model-only" | "hidden"
    readonly allowLazyActivation?: boolean
    readonly searchKeywords?: string[]
  }
}

function hostAttachment(value: unknown): DesktopTool["attachment"] {
  const meta = object(value)
  const { name, label, exposure, allowLazyActivation, searchKeywords } = object(meta["senpi/host-tool"])
  if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(name) || typeof label !== "string") {
    throw new Error("invalid host tool identity")
  }
  if (exposure !== undefined && exposure !== "direct" && exposure !== "search" && exposure !== "eval" && exposure !== "model-only" && exposure !== "hidden") {
    throw new Error("invalid host tool exposure")
  }
  if (allowLazyActivation !== undefined && typeof allowLazyActivation !== "boolean") throw new Error("invalid host tool activation")
  if (searchKeywords !== undefined && (!Array.isArray(searchKeywords) || !searchKeywords.every((word): word is string => typeof word === "string"))) {
    throw new Error("invalid host tool search keywords")
  }
  return {
    name, label,
    ...(exposure === undefined ? {} : { exposure }),
    ...(allowLazyActivation === undefined ? {} : { allowLazyActivation }),
    ...(searchKeywords === undefined ? {} : { searchKeywords }),
  }
}

export function listThreadTools(
  grant: ToolkitGrant,
  timeoutMs: number,
  signal?: AbortSignal,
  onInvalid?: (reason: "invalid_descriptor" | "invalid_name" | "invalid_schema") => void,
) {
  return withClient(grant, timeoutMs, async (request) => {
    const tools: DesktopTool[] = []
    let cursor: string | undefined
    do {
      const page = await request("tools/list", cursor === undefined ? undefined : { cursor })
      if (!Array.isArray(page.tools)) throw new Error("invalid desktop toolkit tools")
      for (const value of page.tools) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          onInvalid?.("invalid_descriptor")
          continue
        }
        const tool = object(value)
        let attachment: DesktopTool["attachment"]
        try {
          attachment = typeof tool._meta === "object" && tool._meta !== null && "senpi/host-tool" in tool._meta
            ? hostAttachment(tool._meta)
            : undefined
        } catch {
          onInvalid?.("invalid_descriptor")
          continue
        }
        if (typeof tool.name !== "string" || tool.name.length === 0 || !/^[a-zA-Z0-9_-]{1,64}$/.test(attachment === undefined ? `desktop_${tool.name}` : tool.name)) {
          onInvalid?.("invalid_name")
          continue
        }
        if (typeof tool.inputSchema !== "object" || tool.inputSchema === null || Array.isArray(tool.inputSchema) ||
          !("type" in tool.inputSchema) || tool.inputSchema.type !== "object") {
          onInvalid?.("invalid_schema")
          continue
        }
        if (tool.description !== undefined && typeof tool.description !== "string") {
          onInvalid?.("invalid_descriptor")
          continue
        }
        const inputSchema = object(tool.inputSchema)
        tools.push({ name: tool.name, inputSchema, ...(tool.description === undefined ? {} : { description: tool.description }), ...(attachment === undefined ? {} : { attachment }) })
      }
      if (page.nextCursor !== undefined && typeof page.nextCursor !== "string") throw new Error("invalid desktop toolkit cursor")
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return tools
  }, signal)
}

/** senpi's event-bus channel that routes one host tool (`{ name, execute? }`). */
export const HOST_TOOL_ROUTE_CHANNEL = "senpi:host-tool-route"
/** The `Error.name` senpi's host tool wrapper reads as "run this call on the standalone tool and drop the route". */
const HOST_TOOL_ROUTE_UNAVAILABLE = "HostToolRouteUnavailable"

function routeUnavailable(): Error {
  return Object.assign(new Error("The host could not serve this call."), { name: HOST_TOOL_ROUTE_UNAVAILABLE })
}

export async function callThreadTool(
  grant: ToolkitGrant | undefined,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
  attachment = false,
) {
  if (attachment && signal?.aborted) throw new DOMException("Desktop toolkit call aborted.", "AbortError")
  if (grant === undefined) {
    if (attachment) throw routeUnavailable()
    return { isError: true, content: [{ type: "text", text: "Desktop thread toolkit is not granted to the calling session." }], details: { reason: "no_session_grant" } }
  }
  const deadline = AbortSignal.timeout(timeoutMs)
  const callSignal = signal === undefined ? deadline : AbortSignal.any([deadline, signal])
  try {
    const result = await withClient(grant, timeoutMs, (request) =>
      request("tools/call", { name, arguments: args }), callSignal)
    if (!Array.isArray(result.content) || (result.isError !== undefined && typeof result.isError !== "boolean")) {
      throw new Error("invalid desktop toolkit content")
    }
    if (attachment) {
      // A tool-level refusal (the SDK writer's own error) is the call's answer; only a lost host falls back.
      if (result.isError === true) return { isError: true, content: result.content, details: {} }
      const details = object(object(result._meta)["senpi/tool-result-details"])
      return { content: result.content, details }
    }
    return { ...result, details: {} }
  } catch {
    // Neither transport errors nor server replies may disclose the file's bearer.
    if (attachment && callSignal.aborted) throw new DOMException("Desktop toolkit call aborted.", "AbortError")
    if (attachment) throw routeUnavailable()
    return { isError: true, content: [{ type: "text", text: "Desktop thread toolkit call failed." }], details: { reason: "call_failed" } }
  }
}
