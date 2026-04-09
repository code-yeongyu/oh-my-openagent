import { log } from "../../shared"
import type { OpenfangAgentEntry, OpenfangSendMessageResponse } from "./types"

export class OpenfangClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "OpenfangClientError"
  }
}

export class OpenfangClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  async healthCheck(): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
    } catch (cause) {
      throw new OpenfangClientError(
        `openfang daemon unreachable at ${this.baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!response.ok) {
      throw new OpenfangClientError(
        `openfang daemon health check failed (${response.status})`,
        response.status,
      )
    }
  }

  async findAgentByName(name: string): Promise<OpenfangAgentEntry> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/agents`, {
        signal: AbortSignal.timeout(5000),
      })
    } catch (cause) {
      throw new OpenfangClientError(
        `Failed to list openfang agents: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }

    if (!response.ok) {
      throw new OpenfangClientError(
        `GET /api/agents failed (${response.status})`,
        response.status,
      )
    }

    const data = await response.json()
    const agents: OpenfangAgentEntry[] = Array.isArray(data) ? data : ((data as { agents?: OpenfangAgentEntry[] }).agents ?? [])

    const match = agents.find(
      (a) => a.name.toLowerCase() === name.toLowerCase(),
    )
    if (!match) {
      const available = agents.map((a) => a.name).join(", ") || "(none)"
      throw new OpenfangClientError(
        `No openfang agent named "${name}". Available: ${available}`,
      )
    }

    return match
  }

  async sendMessage(agentId: string, message: string, abort?: AbortSignal): Promise<string> {
    const abortController = new AbortController()
    const combinedSignal = abortController.signal

    if (abort) {
      abort.addEventListener("abort", () => {
        this.stopAgent(agentId)
        abortController.abort(abort.reason)
      })
      if (abort.aborted) {
        this.stopAgent(agentId)
        throw new OpenfangClientError(`Request cancelled by caller`)
      }
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/agents/${agentId}/message/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: combinedSignal,
      })
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new OpenfangClientError(`Request cancelled by caller`)
      }
      throw new OpenfangClientError(
        `Failed to send message to agent ${agentId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new OpenfangClientError(
        `POST /api/agents/${agentId}/message/stream failed (${response.status}): ${text}`,
        response.status,
      )
    }

    return this.consumeSseStream(response, agentId)
  }

  private async consumeSseStream(response: Response, agentId: string): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new OpenfangClientError(`No response body from agent ${agentId}`)
    }

    const decoder = new TextDecoder()
    const textParts: string[] = []
    const toolLog: string[] = []
    let buffer = ""
    let currentEvent = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim()
            continue
          }
          if (!line.startsWith("data: ")) {
            if (line === "") currentEvent = ""
            continue
          }

          const raw = line.slice(6).trim()
          if (!raw || raw === "[DONE]") continue

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>
          } catch {
            continue
          }

          if (currentEvent === "chunk" && parsed.content !== undefined) {
            textParts.push(String(parsed.content))
          } else if (currentEvent === "tool_use" && parsed.tool) {
            toolLog.push(`[tool: ${parsed.tool}]`)
          } else if (currentEvent === "tool_result" && parsed.tool) {
            toolLog.push(`[tool_result: ${parsed.tool}]`)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const fullText = textParts.join("")
    if (toolLog.length > 0) {
      log("[a2a-delegate] agent tool calls", { agentId, tools: toolLog })
    }
    return fullText
  }

  async stopAgent(agentId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/agents/${agentId}/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      })
    } catch (cause) {
      log("[a2a-delegate] stopAgent failed (non-fatal)", {
        agentId,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
}
