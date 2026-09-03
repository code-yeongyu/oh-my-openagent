import { normalizeSDKResponse, patchPart } from "../../shared"
import { log } from "../../shared/logger"
import {
  getToolCallID,
  getToolStatus,
  isTerminalToolStatus,
  toRecord,
} from "./tool-part-ids"
import { INTERRUPTED_TOOL_ERROR } from "./tool-result-repair"

interface SanitizerPart {
  id?: unknown
  [key: string]: unknown
}

interface SanitizerMessage {
  info?: { id?: unknown; role?: unknown }
  parts?: SanitizerPart[]
}

interface MessagesClient {
  session: {
    messages?: (input: {
      path: { id: string }
      query?: { directory: string }
    }) => Promise<unknown>
  }
}

export interface SanitizeOrphanedToolPartsArgs {
  client: unknown
  sessionID: string
  directory?: string
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Mirrors the in-flight settlement of `settleToolPart` for a PERSISTED part:
 * non-terminal state becomes a terminal error so the harness conversion emits
 * a paired `tool_result` instead of an orphaned `tool_use`.
 */
function buildSettledToolPart(part: Record<string, unknown>): Record<string, unknown> | null {
  const state = toRecord(part["state"])
  if (!state) {
    return null
  }

  const input = toRecord(state["input"])
  const time = toRecord(state["time"])
  const start = time?.["start"]
  const now = Date.now()

  const settledState: Record<string, unknown> = { ...state }
  settledState["status"] = "error"
  settledState["error"] = INTERRUPTED_TOOL_ERROR
  settledState["input"] = input ?? {}
  settledState["time"] = {
    start: typeof start === "number" ? start : now,
    end: now,
  }
  delete settledState["raw"]

  return { ...part, state: settledState }
}

/**
 * The compaction summarization request is built by the OpenCode harness directly
 * from the persisted session messages, so the transform-tier tool-pair-validator
 * cannot repair it. This settles every persisted orphaned (non-terminal) tool part
 * into a terminal error BEFORE `client.session.summarize` is called, mirroring
 * `sanitizeEmptyMessagesBeforeSummarize`. Best-effort and fully defensive: any
 * failure logs and resolves 0 so compaction is never blocked.
 */
export async function sanitizeOrphanedToolPartsBeforeSummarize(
  args: SanitizeOrphanedToolPartsArgs,
): Promise<number> {
  const { client, sessionID, directory } = args

  try {
    const messagesClient = client as MessagesClient | null
    const fetchMessages = messagesClient?.session.messages
    if (!messagesClient || typeof fetchMessages !== "function") {
      return 0
    }

    const response = await fetchMessages.call(messagesClient.session, {
      path: { id: sessionID },
      ...(directory ? { query: { directory } } : {}),
    })
    const messages = normalizeSDKResponse(response, [] as SanitizerMessage[], {
      preferResponseOnMissingData: true,
    })

    let repairedCount = 0
    for (const message of messages) {
      const info = toRecord(message?.info)
      if (!info || info["role"] !== "assistant") {
        continue
      }
      const messageID = readString(info["id"])
      if (!messageID) {
        continue
      }

      const parts = Array.isArray(message?.parts) ? message.parts : []
      for (const part of parts) {
        const record = toRecord(part)
        if (!record || record["type"] !== "tool") {
          continue
        }

        const previousStatus = getToolStatus(record)
        if (isTerminalToolStatus(previousStatus)) {
          continue
        }

        const callID = getToolCallID(record)
        const partID = readString(record["id"])
        if (!callID || !partID) {
          continue
        }

        const settled = buildSettledToolPart(record)
        if (!settled) {
          continue
        }

        const patched = await patchPart(client, sessionID, messageID, partID, settled)
        if (patched) {
          repairedCount++
          log("[tool-pair-validator] Settled persisted orphaned tool part before summarize", {
            sessionID,
            messageID,
            callID,
            previousStatus,
          })
        }
      }
    }

    return repairedCount
  } catch (error) {
    log("[tool-pair-validator] Pre-summarize orphaned tool part sanitization failed", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}
