import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { callMcbTool, createDefaultArgs, parseMcbToolResponse } from "./mcb-client-helper"
import type { McbCallToolResult, McbToolName } from "./types"

const DEFAULT_AGENT_TYPE_CANDIDATES = ["claude", "assistant", "agent", "default", "ai", "bot", "system", "human"]
const READY_KEYWORDS = ["complete", "completed", "ready", "done"]

type CallToolFn = (
  client: Client,
  name: McbToolName,
  args: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<McbCallToolResult>

interface DiscoverAgentTypeOptions {
  candidates?: readonly string[]
  callTool?: CallToolFn
  timeoutMs?: number
}

interface WaitForIndexReadyOptions {
  callTool?: CallToolFn
  maxWaitMs?: number
  intervalMs?: number
  minIdleReadyMs?: number
  timeoutMs?: number
}

export async function discoverValidAgentType(client: Client, options: DiscoverAgentTypeOptions = {}): Promise<string | null> {
  const candidates = options.candidates ?? DEFAULT_AGENT_TYPE_CANDIDATES
  const callTool = options.callTool ?? callMcbTool
  const timeoutMs = options.timeoutMs ?? 5_000

  for (const candidate of candidates) {
    const args = {
      ...createDefaultArgs("session"),
      action: "create",
      agent_type: candidate,
      data: { name: `mcb-roundtrip-${Date.now()}` },
    }
    try {
      const result = await callTool(client, "session", args, timeoutMs)
      if (result.isError !== true) {
        return candidate
      }
    } catch {}
  }

  return null
}

export async function waitForIndexReady(
  client: Client,
  collection: string,
  options: WaitForIndexReadyOptions = {},
): Promise<boolean> {
  const callTool = options.callTool ?? callMcbTool
  const maxWaitMs = options.maxWaitMs ?? 5_000
  const intervalMs = options.intervalMs ?? 200
  const minIdleReadyMs = options.minIdleReadyMs ?? 400
  const timeoutMs = options.timeoutMs ?? 5_000
  const startTime = Date.now()
  let sawActiveState = false

  while (Date.now() - startTime < maxWaitMs) {
    const args = {
      ...createDefaultArgs("index"),
      action: "status",
      collection,
    }
    try {
      const result = await callTool(client, "index", args, timeoutMs)
      if (result.isError !== true) {
        const parsed = parseMcbToolResponse(result)
        const text = typeof parsed === "object" && parsed !== null && "text" in parsed ? String(parsed.text ?? "") : ""
        const normalizedText = text.toLowerCase()
        if (READY_KEYWORDS.some((keyword) => normalizedText.includes(keyword))) {
          return true
        }
        if (normalizedText.includes("indexing") || normalizedText.includes("running")) {
          sawActiveState = true
        }
        if (normalizedText.includes("idle")) {
          if (sawActiveState || Date.now() - startTime >= minIdleReadyMs) {
            return true
          }
        }
      }
    } catch {}

    await Bun.sleep(intervalMs)
  }

  return false
}
