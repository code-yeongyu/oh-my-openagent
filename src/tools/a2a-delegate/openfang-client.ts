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

  async sendMessage(agentId: string, message: string): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/agents/${agentId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
    } catch (cause) {
      throw new OpenfangClientError(
        `Failed to send message to agent ${agentId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new OpenfangClientError(
        `POST /api/agents/${agentId}/message failed (${response.status}): ${text}`,
        response.status,
      )
    }

    const body = (await response.json()) as OpenfangSendMessageResponse
    return body.response ?? ""
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
